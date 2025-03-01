import os
import json
import asyncio
import time
import threading
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from fastrtc import ReplyOnPause, Stream, get_stt_model, get_tts_model
import anthropic

# Store the main event loop for use with run_coroutine_threadsafe
main_event_loop = asyncio.get_event_loop()

client = anthropic.Anthropic()

stt_model = get_stt_model()
tts_model = get_tts_model()

# Store active WebSocket connections and track sessions
active_connections = {}
active_sessions = {}

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
class HandlerWithSession:
    def __init__(self, handler_func):
        self.handler_func = handler_func
        
    def __call__(self, audio):
        # Set thread-local session ID at the beginning of each handler call
        session_local.session_id = self._get_active_session_id()
        
        # Call the original handler with the audio
        return self.handler_func(audio)
    
    def _get_active_session_id(self):
        # If there are active sessions, use the most recent one
        if active_sessions:
            session_id, _ = max(active_sessions.items(), key=lambda x: x[1])
            print(f"Using session ID: {session_id}")
            return session_id
        return None
        
    def _get_all_active_sessions(self):
        # Returns all active session IDs
        return list(active_sessions.keys())

# The actual handler function
def echo_handler(audio):
    # Get current session ID
    session_id = get_current_session_id()
    print(f"Processing audio for session: {session_id}")
    
    # Transcribe speech
    prompt = stt_model.stt(audio)
    print(f"Transcribed: {prompt}")
    
    # Helper function to broadcast message to sessions
    def broadcast_message(message, log_prefix=""):
        message_json = json.dumps(message)
        print(f"{log_prefix}: {message_json}")
        
        # First try the current session
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
                
    # Send user message
    user_message = {
        "role": "user", 
        "content": prompt,
        "type": "text"
    }
    broadcast_message(user_message, "Sending user message")
    
    # Process with Claude
    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=100,
        messages=[{"role": "user", "content": prompt}]
    )
    reply_text = response.content[0].text
    print(f"Assistant response: {reply_text}")

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

# Create the wrapped handler
echo = HandlerWithSession(echo_handler)

# WebSocket endpoint for text messages
async def websocket_endpoint(websocket: WebSocket, webrtc_id: str):
    # Check if a connection for this session already exists
    if webrtc_id in active_connections:
        print(f"Closing existing WebSocket for session {webrtc_id}")
        try:
            # Close the existing connection gracefully
            old_websocket = active_connections[webrtc_id]
            await old_websocket.close(code=1000, reason="Replaced by new connection")
        except Exception as e:
            print(f"Error closing existing WebSocket: {e}")
    
    await websocket.accept()
    print(f"WebSocket connection established for session: {webrtc_id}")
    
    # Store the connection
    active_connections[webrtc_id] = websocket
    
    # Update session timestamp
    active_sessions[webrtc_id] = time.time()
    
    try:
        # Send a welcome message
        await websocket.send_text(
            json.dumps({
                "role": "system", 
                "content": "Connected to voice agent. Your conversation will appear here.",
                "type": "text"  # Add type field explicitly
            })
        )
        
        # Keep the connection open
        while True:
            # Wait for messages from the client (not needed for our use case, but keeps the connection alive)
            data = await websocket.receive_text()
            print(f"Received message from client (webrtc_id={webrtc_id}): {data}")
            
            # Don't echo back confirmations to avoid "log" noise
            # Just log the message to server console instead
            print(f"Processing client message: {data[:100]}{'...' if len(data) > 100 else ''}")
    except WebSocketDisconnect:
        print(f"WebSocket disconnected for session: {webrtc_id}")
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        # Clean up when the connection closes
        if webrtc_id in active_connections:
            del active_connections[webrtc_id]
        # Keep the session active for a while in case of reconnects
        # It will be cleaned up by the cleanup task

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

# Create the FastAPI app
app = FastAPI()

# Add middleware for tracking WebRTC sessions
app.add_middleware(WebRTCSessionMiddleware)

# Add lifespan event to start background tasks
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(cleanup_expired_sessions())

# Create the Stream instance with our echo handler
stream = Stream(
    ReplyOnPause(echo),
    modality="audio",
    mode="send-receive"
)

# Debug FastRTC's stream object to understand its structure
print("FastRTC Stream object:")
print(f"Mode: {stream.mode}")
print(f"Modality: {stream.modality}")
try:
    # Check if we can access any internal configuration that might help us understand 
    # where 'log' messages are coming from
    print(f"Stream attributes: {dir(stream)}")
except Exception as e:
    print(f"Error inspecting stream object: {e}")

stream.mount(app)

# Add WebSocket endpoint
@app.websocket("/ws/chat")
async def websocket_endpoint(websocket: WebSocket, webrtc_id: str):
    await websocket.accept()
    print(f"WebSocket connection established for session: {webrtc_id}")
    
    # Store the connection
    active_connections[webrtc_id] = websocket
    
    # Update session timestamp
    active_sessions[webrtc_id] = time.time()
    
    try:
        # Send a welcome message
        await websocket.send_text(
            json.dumps({
                "role": "system", 
                "content": "Connected to voice agent. Your conversation will appear here."
            })
        )
        
        # Keep the connection open
        while True:
            # Wait for messages from the client (not needed for our use case, but keeps the connection alive)
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
