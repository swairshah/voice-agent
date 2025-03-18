# FastRTC Voice Agent

A voice-based chat application for interacting with an LLM, built with Fastrtc[https://github.com/freddyaboulton/fastrtc].
This is mainly a proof of concept of using Fastrtc in backend. We have an electron app and a standard issue webapp as frontend. 
Using local STT and TTS models in backend. Though works well on my 2017 Intel chip macbook pro.

No real "agentic" stuff yet but you can checkout CompUse[https://github.com/swairshah/CompUse] 
to see how to make your app do "agentic" stuff. Just replace the LLMHandler call with
your own agentic handler.

## Client Applications

This repository contains two client applications that connect to the same backend:

1. **Electron App** - A desktop application built with Electron.
2. **Webapp** - See the [webapp directory](./webapp) for more details.


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

## Running the apps

### Starting the Backend Server

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

The backend server will run at http://localhost:8000.

### Running the Electron App

In a separate terminal, start the Electron app:

```bash
npm run dev
```

The Electron app will connect to the locally running server.

### Running the Web App

To run the TypeScript web application:

```bash
# Navigate to the webapp directory
cd webapp

# Install dependencies (first time only)
npm install

# Start the development server
npm start
```

The web app will be available at http://localhost:3000 and will connect to the same backend server.

Note: You can use either the Electron app or the web app with the same backend. Both provide similar functionality.

## How it works

Both client applications (Electron and web) connect to a local FastAPI server that uses Fastrtc for voice processing. The system:

1. Uses dual communication channels:
   - WebRTC for real-time audio streaming (microphone input and TTS output)
   - WebSocket for text communication (chat transcript and session management)
2. Processes voice through a pipeline of:
   - Speech-to-Text (STT) to transcribe user input
   - LLM processing via Claude to generate responses
   - Text-to-Speech (TTS) to convert responses to audio

### Backend

Fastrtc simplifies WebRTC implementation, which is traditionally complex. Fastrtc handles all the complex WebRTC setup with a simple `Stream` class that can be mounted on a FastAPI app. We get built-in functionality that would otherwise require custom implementation. This is done by the `ReplyOnPause`, check out the `main.py` file to see how it works.

Without Fastrtc, implementing this voice interface would require:
- Custom WebRTC signaling server implementation
- Complex peer connection and media stream handling
- Manual audio processing and turn detection
- Separate STT/TTS integration

### Architecture

The backend server and client applications run as separate processes, giving you flexibility to:
- Debug the server independently
- Make server-side changes without restarting the client applications
- Connect different clients to the same server
- Choose between desktop (Electron) or browser (TypeScript web app) interfaces

## Building for distribution

### Building the Electron App

```bash
# From the root directory
npm run build
```

This will create desktop application distributables in the `dist` folder.

### Building the Web App

```bash
# Navigate to the webapp directory
cd webapp

# Build for production
npm run build
```

This will create production web files in the `webapp/dist` folder, which can be deployed to any web server.
