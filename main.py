import json
import asyncio
from logging import info
import time
import threading
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from fastrtc import ReplyOnPause, Stream, get_stt_model, get_tts_model
import anthropic

# Store the main event loop for use with run_coroutine_threadsafe
main_event_loop = asyncio.get_event_loop()


stt_model = get_stt_model()
tts_model = get_tts_model()

# Store active WebSocket connections and track sessions
active_connections = {}
active_sessions = {}
session_message_history = {} 

# Use thread-local storage to track the current session
# This is more reliable than global variables
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

# Custom middleware to track WebRTC sessions
class WebRTCSessionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Check if this is a WebRTC offer request
        if request.url.path == "/webrtc/offer" and request.method == "POST":
            # Clone the request body for reading
            body_bytes = await request.body()
            
            # Create a new request with the same body
            request._receive = _receive_factory(body_bytes)
            
            try:
                # Parse the body as JSON
                data = json.loads(body_bytes)
                webrtc_id = data.get("webrtc_id")
                
                if webrtc_id:
                    print(f"Tracked WebRTC session: {webrtc_id}")
                    active_sessions[webrtc_id] = time.time()
            except Exception as e:
                print(f"Error tracking WebRTC session: {e}")
        
        # Process the request normally
        response = await call_next(request)
        return response

# Helper function to create a new receive function that returns the cloned body
async def _receive_factory(body_bytes):
    async def receive():
        return {"type": "http.request", "body": body_bytes, "more_body": False}
    return receive

# Handler wrapper to capture session ID from thread-local storage
class AgentHandler:
    def __init__(self):
        self.client = anthropic.Anthropic()
        pass
        
    def __call__(self, audio):
        # Set thread-local session ID at the beginning of each handler call
        session_local.session_id = self._get_active_session_id()
        
        # Call the original handler with the audio
        session_id = get_current_session_id()
        print(f"Processing audio for session: {session_id}")
   
        prompt = stt_model.stt(audio)
        print(f"Transcribed: {prompt}")
        
        # Skip empty transcriptions
        if not prompt or prompt.strip() == "":
            print("Empty transcription detected, skipping processing")
            # Return an empty audio chunk to maintain the generator protocol
            yield b""
            return
        
        if session_id not in session_message_history:
            session_message_history[session_id] = []
        
        # broadcast message to sessions
        def broadcast_message(message, log_prefix=""):
            message_json = json.dumps(message)
            print(f"{log_prefix}: {message_json}")
            
            if session_id and session_id in active_connections:
                try:
                    # Queue message for the current session
                    asyncio.run_coroutine_threadsafe(
                        active_connections[session_id].send_text(message_json),
                        main_event_loop
                    )
                    print(f"Queued message for session {session_id}")
                except Exception as e:
                    print(f"Error sending message to session {session_id}: {e}")
        
        try:            
            user_message = {
                "role": "user", 
                "content": prompt,
                "type": "text"
            }
            broadcast_message(user_message, "Sending user message")
            
            # Add user message to history
            session_message_history[session_id].append({"role": "user", "content": prompt})
            
            # Process with Claude using full conversation history
            response = self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=100,
                messages=session_message_history[session_id]
            )
            reply_text = response.content[0].text
            print(f"Assistant response: {reply_text}")

            # Add assistant message to history
            session_message_history[session_id].append({"role": "assistant", "content": reply_text})

            # Send assistant message
            assistant_message = {
                "role": "assistant", 
                "content": reply_text,
                "type": "text"
            }
            broadcast_message(assistant_message, "Sending assistant message")

            # Stream TTS audio for the reply
            for audio_chunk in tts_model.stream_tts_sync(reply_text):
                yield audio_chunk
                
        except Exception as e:
            print(f"Error in agent_handler: {e}")
            # Send error message that won't be displayed as user/assistant message
            error_message = {
                "role": "system", 
                "content": "Sorry, there was an error processing your request. Please try again.",
                "type": "error_internal"  # Special type that won't be displayed as a chat message
            }
            broadcast_message(error_message, "Sending error message")
            # Return empty audio so the function completes
            yield b""

        
    def _get_active_session_id(self):
       # If there are active sessions, use the most recent one
       if active_sessions:
           session_id, _ = max(active_sessions.items(), key=lambda x: x[1])
           print(f"Using session ID: {session_id}")
           return session_id
       return None
            
    def _get_all_active_sessions(self):
        return list(active_sessions.keys())

# Cleanup task for expired sessions
async def cleanup_expired_sessions():
    """Clean up expired sessions (older than 30 minutes)"""
    while True:
        await asyncio.sleep(60)  # Check once per minute
        current_time = time.time()
        expired = []
        
        for session_id, timestamp in active_sessions.items():
            # If session is older than 30 minutes
            if current_time - timestamp > 1800:
                expired.append(session_id)
        
        # Remove expired sessions
        for session_id in expired:
            print(f"Cleaning up expired session: {session_id}")
            active_sessions.pop(session_id, None)
            # Also clean up message history for expired sessions
            if session_id in session_message_history:
                del session_message_history[session_id]
                print(f"Cleaned up message history for session: {session_id}")


# FastAPI APP:
app = FastAPI()
app.add_middleware(WebRTCSessionMiddleware)

# lifespan event to start background tasks
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(cleanup_expired_sessions())

handler = AgentHandler()
stream = Stream(
    ReplyOnPause(handler),
    modality="audio",
    mode="send-receive"
)

# Debug FastRTC's stream object to understand its structure
print("FastRTC Stream object:")
print(f"Mode: {stream.mode}")
print(f"Modality: {stream.modality}")
try:
    print(f"Stream attributes: {dir(stream)}")
except Exception as e:
    print(f"Error inspecting stream object: {e}")

stream.mount(app)

@app.websocket("/ws/chat")
async def websocket_endpoint(websocket: WebSocket, webrtc_id: str):
    await websocket.accept()
    print(f"WebSocket connection established for session: {webrtc_id}")
    
    # Store the connection
    active_connections[webrtc_id] = websocket

    active_sessions[webrtc_id] = time.time()
    
    # Initialize message history if not exists
    if webrtc_id not in session_message_history:
        session_message_history[webrtc_id] = []
    
    try:
        await websocket.send_text(
            json.dumps({
                "role": "system", 
                "content": "Connected to voice agent. Your conversation will appear here.",
                "type": "info"  
            })
        )
        
        # Keep the connection open
        while True:
            # Wait for messages from the client 
            data = await websocket.receive_text()
            print(f"Received message from client: {data}")

    except WebSocketDisconnect:
        print(f"WebSocket disconnected for session: {webrtc_id}")

    except Exception as e:
        print(f"WebSocket error: {e}")

    finally:
        # Clean up when the connection closes
        if webrtc_id in active_connections:
            del active_connections[webrtc_id]

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    with open("static/index.html", "r") as f:
        return HTMLResponse(content=f.read(), status_code=200)
