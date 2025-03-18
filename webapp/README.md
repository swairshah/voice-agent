# Voice Agent Web App

Same as the electron app but running on browser. 

## Prerequisites

- Node.js (v16+)
- npm or yarn
- Python 3.11+ (for backend)

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Start the development server:
   ```
   npm start
   ```

3. In a separate terminal, start the backend:
   ```
   npm run backend
   ```

## Build for Production

```
npm run build
```

This will generate production files in the `dist` directory.

## Development

The webapp uses:
- TypeScript
- WebRTC for real-time audio communication
- WebSockets for chat messaging
- The same backend as the Electron app version

## Notes

This webapp connects to the same Python backend as the Electron app. 
Make sure the backend is running on port 8000 when using this app.
