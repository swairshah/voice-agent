# Voice Agent Electron App

An Electron desktop application wrapper for the Voice Agent, built with FastRTC.

## Prerequisites

- Node.js (v14+)
- npm or yarn
- Python 3.8+
- FastRTC library (`pip install fastrtc`)
- Anthropic API key for Claude

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

## How it works

This Electron app connects to a local FastAPI server that uses FastRTC for voice processing. The app:

1. Opens an Electron window pointing to your locally running FastAPI server
2. Provides a native desktop experience with system tray functionality
3. Uses the same WebRTC connections and microphone permissions as the web interface

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
