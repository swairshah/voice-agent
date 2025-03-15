import json
import asyncio
import time
import threading
from typing import Dict, List
from datetime import timedelta

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

import logging
import anthropic
from fastrtc import ReplyOnPause, Stream, get_stt_model, get_tts_model

logger = logging.getLogger(__name__)
# Main event loop for async operations from non-async contexts
main_event_loop = asyncio.get_event_loop()
stt_model = get_stt_model()
tts_model = get_tts_model()

# Session storage with type hints
active_connections: Dict[str, WebSocket] = {}
active_sessions: Dict[str, float] = {}
session_message_history: Dict[str, List[Dict[str, str]]] = {} 

# Session management constants
SESSION_TIMEOUT = timedelta(minutes=30)
CLEANUP_INTERVAL = 60  # seconds

# Thread-local storage to track the current session across threads
session_local = threading.local()

def get_current_session_id():
    """Get the current WebRTC session ID from thread-local storage"""
    if hasattr(session_local, "session_id"):
        return session_local.session_id
    elif active_sessions:
        # Fall back to most recent session
        session_id, _ = max(active_sessions.items(), key=lambda x: x[1])
        return session_id
    return None

async def cleanup_expired_sessions():
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL)
            current_time = time.time()
            expired = []
            
            # Find expired sessions
            for session_id, timestamp in active_sessions.items():
                if current_time - timestamp > SESSION_TIMEOUT.total_seconds():
                    expired.append(session_id)
            
            # Clean up expired sessions and resources
            for session_id in expired:
                logger.info(f"Cleaning up expired session: {session_id}")
                active_sessions.pop(session_id, None)
                session_message_history.pop(session_id, None)
                
                # Close WebSocket connections for expired sessions
                if session_id in active_connections:
                    ws = active_connections[session_id]
                    try:
                        await ws.close(code=1000, reason="Session expired")
                    except Exception as e:
                        logger.error(f"Error closing WebSocket for expired session {session_id}: {e}")
                    active_connections.pop(session_id, None)
        except Exception as e:
            logger.error(f"Error in cleanup task: {e}")


# Middleware to track WebRTC sessions from offer requests
class WebRTCSessionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/webrtc/offer" and request.method == "POST":
            body_bytes = await request.body()
            request._receive = _receive_factory(body_bytes)
            
            try:
                data = json.loads(body_bytes)
                webrtc_id = data.get("webrtc_id")
                
                if webrtc_id:
                    logger.info(f"Tracked WebRTC session: {webrtc_id}")
                    active_sessions[webrtc_id] = time.time()
            except Exception as e:
                logger.error(f"Error tracking WebRTC session: {e}")
        
        return await call_next(request)

# Helper function to create a new receive function for cloned request body
async def _receive_factory(body_bytes):
    async def receive():
        return {"type": "http.request", "body": body_bytes, "more_body": False}
    return receive

class LLMHandler:
    def __init__(self):
        self.client = anthropic.Anthropic()
        
    def __call__(self, audio):
        # Set thread-local session ID at the beginning of each handler call
        session_local.session_id = self._get_active_session_id()
        session_id = get_current_session_id()
        logger.info(f"Processing audio for session: {session_id}")

        # STT
        prompt = stt_model.stt(audio)
        logger.info(f"Transcribed: {prompt}")
        
        # Skip empty transcriptions
        if not prompt or prompt.strip() == "":
            yield b""
            return
        
        if session_id not in session_message_history:
            session_message_history[session_id] = []
        
        # Function to broadcast messages to the WebSocket client
        def broadcast_message(message, log_prefix=""):
            message_json = json.dumps(message)
            logger.info(f"{log_prefix}: {message_json}")
            
            if session_id and session_id in active_connections:
                try:
                    # Queue message for the current session
                    asyncio.run_coroutine_threadsafe(
                        active_connections[session_id].send_text(message_json),
                        main_event_loop
                    )
                except Exception as e:
                    logger.error(f"Error sending message to session {session_id}: {e}")
        
        try:            
            user_message = {
                "role": "user", 
                "content": prompt,
                "type": "text"
            }
            broadcast_message(user_message, "Sending user message")
            
            session_message_history[session_id].append({"role": "user", "content": prompt})
            
            response = self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=100,
                messages=session_message_history[session_id]
            )
            reply_text = response.content[0].text
            logger.info(f"Assistant response: {reply_text}")

            session_message_history[session_id].append({"role": "assistant", "content": reply_text})

            assistant_message = {
                "role": "assistant", 
                "content": reply_text,
                "type": "text"
            }
            broadcast_message(assistant_message, "Sending assistant message")

            # Stream TTS audio 
            for audio_chunk in tts_model.stream_tts_sync(reply_text):
                yield audio_chunk
                
        except Exception as e:
            logger.error(f"Error in agent_handler: {e}")
            error_message = {
                "role": "infolog", 
                "content": "Sorry, there was an error processing your request. Please try again.",
                "type": "error_internal"
            }
            broadcast_message(error_message, "Sending error message")
            yield b""
        
    def _get_active_session_id(self):
       # Get the most recent active session
       if active_sessions:
           session_id, _ = max(active_sessions.items(), key=lambda x: x[1])
           return session_id
       return None
            
    def _get_all_active_sessions(self):
        return list(active_sessions.keys())

# FastAPI app 
app = FastAPI()
app.add_middleware(WebRTCSessionMiddleware)

# Start background cleanup task
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(cleanup_expired_sessions())

handler = LLMHandler()
stream = Stream(
    ReplyOnPause(handler),
    modality="audio",
    mode="send-receive"
)

stream.mount(app)

# WebSocket endpoint for chat interface
@app.websocket("/ws/chat")
async def websocket_endpoint(websocket: WebSocket, webrtc_id: str):
    try:
        await websocket.accept()
        logger.info(f"WebSocket connection established for session: {webrtc_id}")
        
        # Register connection and update session timestamp
        active_connections[webrtc_id] = websocket
        active_sessions[webrtc_id] = time.time()
        
        if webrtc_id not in session_message_history:
            session_message_history[webrtc_id] = []
        
        # Send welcome message
        await websocket.send_text(
            json.dumps({
                "role": "infolog", 
                "content": "Connected to voice agent. Your conversation will appear here.",
                "type": "info"  
            })
        )
        
        # Keep connection open and listen for messages
        while True:
            data = await websocket.receive_text()
            logger.info(f"Received message from client: {data}")

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for session: {webrtc_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        # Clean up connection when closed
        active_connections.pop(webrtc_id, None)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    try:
        with open("static/index.html", "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read(), status_code=200)
    except FileNotFoundError:
        logger.error("index.html file not found")
        return HTMLResponse(content="File not found", status_code=404)
    except Exception as e:
        logger.error(f"Error reading index.html: {e}")
        return HTMLResponse(content="Internal server error", status_code=500)