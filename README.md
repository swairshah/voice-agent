# FastRTC Electron App 

An Electron desktop application wrapper for the LLM Voice app, built with Fastrtc[https://github.com/freddyaboulton/fastrtc].
This is mainly a proof of concept of using Fastrtc with an Electron app. Using local STT and TTS.

No real "agentic" stuff yet but you can checkout CompUse[https://github.com/swairshah/CompUse] 
to see how to make your app do "agentic" stuff. Just replace the LLMHandler call with
your own agentic handler.


## Prerequisites

- Node.js (v14+)
- npm 
- Python 3.11+
- Fastrtc library (`pip install fastrtc`)
- Anthropic API key for Claude (again, replace with whatever llm provider)

## Setup

1. Set up Python virtual environment:

```bash
# Create a virtual environment
uv venv
# or 
# python -m venv .venv

# Activate the virtual environment
# On Windows
# .venv\Scripts\activate
# On macOS/Linux
source .venv/bin/activate

# Install Python dependencies
uv pip install fastapi fastrtc anthropic uvicorn
```

2. Install Node.js dependencies:

```bash
npm install
```

3. Configure environment variables:

```bash
# Set your Anthropic API key
export ANTHROPIC_API_KEY=your_api_key
```

## Running the app

1. First, start the FastAPI server:

```bash
# Make sure your virtual environment is activated
# On macOS/Linux
source .venv/bin/activate
# On Windows
# .venv\Scripts\activate

# Run the server
python main.py
```

2. In a separate terminal, start the Electron app:

```bash
npm run dev
```

The Electron app will connect to the locally running server at http://localhost:8000.

We can change this to use any openport but i wanted to keep it simple.

## How it works

This Electron app connects to a local FastAPI server that uses Fastrtc for voice processing. The app:

1. Opens an Electron window pointing to your locally running FastAPI server
2. Uses dual communication channels:
   - WebRTC for real-time audio streaming (microphone input and TTS output)
   - WebSocket for text communication (chat transcript and session management)
3. Processes voice through a pipeline of:
   - Speech-to-Text (STT) to transcribe user input
   - LLM processing via Claude to generate responses
   - Text-to-Speech (TTS) to convert responses to audio

Fastrtc simplifies WebRTC implementation, which is traditionally complex. Fastrtc handles all the complex WebRTC setup with a simple `Stream` class that can be mounted on a FastAPI app. We get built-in functionality that would otherwise require custom implementation. This is done by the `ReplyOnPause`, check out the `main.py` file to see how it works.

Without Fastrtc, implementing this voice interface would require:
- Custom WebRTC signaling server implementation
- Complex peer connection and media stream handling
- Manual audio processing and turn detection
- Separate STT/TTS integration

The server and Electron app run as separate processes, giving you flexibility to:
- Debug the server independently
- Make server-side changes without restarting the Electron app
- Connect other clients to the same server

## Building for distribution

```bash
# Build the app
npm run build
```

This will create distributables in the `dist` folder.
