import './styles.css';

interface ChatMessage {
  role: string;
  content: string;
  type?: string;
}

const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const chatLog = document.getElementById('chat-log') as HTMLDivElement;
const remoteAudio = document.getElementById('remote-audio') as HTMLAudioElement;

let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let webrtcId: string | null = null;
let eventSource: EventSource | null = null;

class ChatWebSocket {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private hasShownConnectionError: boolean = false;
  private messageCounter: number = 0;
  private keepAliveInterval: number | null = null;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
    this.connect();
  }

  connect(): void {
    this.ws = new WebSocket(this.wsUrl);
    this.setupEventHandlers();
    this.startKeepAlive();
  }

  setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log("WebSocket connection established");
      appendMessage("infolog", "Text chat connection established");
      this.hasShownConnectionError = false;
    };

    this.ws.onmessage = this.handleMessage.bind(this);
    this.ws.onerror = this.handleError.bind(this);
    this.ws.onclose = this.handleClose.bind(this);
  }

  startKeepAlive(): void {
    this.keepAliveInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch (err) {
          console.error("Error sending ping:", err);
        }
      }
    }, 30000);
  }

  handleMessage(event: MessageEvent): void {
    this.messageCounter++;
    console.log(`------ WebSocket Message #${this.messageCounter} Received ------`);
    
    try {
      const data = JSON.parse(event.data);
      const dataCopy = JSON.parse(JSON.stringify(data));
      const parsedMessage = parseMessage(dataCopy);
      
      if (parsedMessage) {
        appendMessage(parsedMessage.role, parsedMessage.content);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
    }
  }

  handleError(error: Event): void {
    console.error("WebSocket error:", error);
    if (!this.hasShownConnectionError) {
      appendMessage("infolog", "Text chat connection error. Some messages may not appear.");
      this.hasShownConnectionError = true;
    }
    this.scheduleReconnect(5000);
  }

  handleClose(event: CloseEvent): void {
    console.log("WebSocket connection closed:", event);
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
    
    if (peerConnection && peerConnection.connectionState === "connected") {
      appendMessage("infolog", "Text chat connection closed. Voice connection still active. Attempting to reconnect...");
      this.scheduleReconnect(2000);
    }
  }

  scheduleReconnect(delay: number): void {
    setTimeout(() => {
      if (peerConnection && peerConnection.connectionState === "connected" &&
        (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
        console.log("Attempting to reconnect WebSocket...");
        this.connect();
      }
    }, delay);
  }

  close(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
    }
  }
}

// Initialize window.chatWebSocket as an optional property
declare global {
  interface Window {
    chatWebSocket?: ChatWebSocket;
  }
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  stopBtn.disabled = false;
  // unique session id.
  webrtcId = "session_" + Date.now();

  // Get microphone audio.
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error("Error accessing microphone", err);
    return;
  }

  // Create a new RTCPeerConnection
  const config = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  };
  peerConnection = new RTCPeerConnection(config);

  // Add local audio tracks.
  localStream.getTracks().forEach(track => {
    if (peerConnection) {
      peerConnection.addTrack(track, localStream!);
    }
  });

  // Handle incoming remote audio tracks.
  peerConnection.ontrack = (event) => {
    console.log("Received remote track");
    remoteAudio.srcObject = event.streams[0];
  };

  // data channel for receiving chat messages.
  const dataChannel = peerConnection.createDataChannel("chat");
  dataChannel.onmessage = (event) => {
    console.log("------ WebRTC Data Channel Message Received ------");
    console.log("Raw data channel message:", event.data);
    
    try {
      const msg = JSON.parse(event.data);
      
      console.log("Parsed data channel message:", msg);
      
      if (msg.type === "log") {
        console.log("Skipping log message:", msg);
        return;
      }
      
      if (msg.role && msg.content) {
        console.log(`Displaying WebRTC message from ${msg.role}`);
        appendMessage(msg.role, msg.content);
      } else {
        // determine if it's a complete message or fragment
        if (typeof msg === 'object') {
          // Get first key that might be a role
          const keys = Object.keys(msg);
          if (keys.length > 0 && typeof msg[keys[0]] === 'string') {
            const possibleRole = keys[0];
            const possibleContent = msg[keys[0]];
            console.log(`Using ${possibleRole} as role and its value as content`);
            appendMessage(possibleRole, possibleContent);
          } else {
            console.error("Unable to extract role/content from WebRTC message:", msg);
          }
        }
      }
    } catch (error) {
      // Not JSON, try to use as plain text
      console.log("Data channel message is not JSON, using as plain text");
      appendMessage("infolog", event.data);
    }
    
    console.log("------ End WebRTC Data Channel Message ------");
  };

  // DEBUG Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("New ICE candidate", event.candidate);
    }
  };

  // Create an SDP offer.
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  
  const response = await fetch("/webrtc/offer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      webrtc_id: webrtcId,
      sdp: offer.sdp,
      type: offer.type
    })
  });

  const result = await response.json();
  if (!response.ok) {
    console.error("Offer error:", result);
    return;
  }

  const answer = result.answer || result;
  console.log("Answer:", answer);
  
  if (!answer || !answer.type) {
    console.error("Answer missing 'type' field:", answer);
    return;
  }
  
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));

  // Close any existing event sources or WebSockets
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  
  if (window.chatWebSocket) {
    window.chatWebSocket.close();
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws/chat?webrtc_id=${webrtcId}`;
  window.chatWebSocket = new ChatWebSocket(wsUrl);
  
  // try to use EventSource for text updates as a fallback
  try {
    eventSource = new EventSource(`/outputs?webrtc_id=${webrtcId}`);
    console.log("EventSource connection attempted to:", `/outputs?webrtc_id=${webrtcId}`);
    
    eventSource.onopen = () => {
      console.log("EventSource connection opened");
    };
    
    eventSource.onmessage = (event) => {
      console.log("EventSource message received:", event.data);
      try {
        const data = JSON.parse(event.data);
        
        // Make sure this is a text message
        if (data.type === "text") {
          appendMessage(data.role, data.content);
        }
      } catch (e) {
        console.error("Error parsing EventSource message:", e);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error("EventSource error:", error);
      // No need to show an error message as we have WebSockets as primary
    };
  } catch (error) {
    console.error("Error setting up EventSource:", error);
  }
});

stopBtn.addEventListener("click", () => {
  stopBtn.disabled = true;
  startBtn.disabled = false;
  
  // Close WebRTC connection
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  // Stop local audio tracks
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  // Close EventSource
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  
  // Close WebSocket
  if (window.chatWebSocket) {
    window.chatWebSocket.close();
    window.chatWebSocket = undefined;
  }
  
  appendMessage("infolog", "Conversation ended");
});

function appendMessage(role: string, content: string): void {
  // Skip messages with role "log"
  if (role === "log") {
    console.log("Skipping message with role 'log'");
    return;
  }
  
  // Skip confirmation/echo messages and other unwanted message types
  if (typeof content === 'string' && (
    // Skip confirmation messages
    content.toLowerCase().includes('message received') || 
    content.toLowerCase().includes('received message') ||
    // Skip connection status messages that might be duplicates
    (role === 'infolog' && content.toLowerCase().includes('connection')) ||
    // Skip any messages that look like debugging or internal logs
    content.toLowerCase().includes('log:') ||
    content.toLowerCase().includes('debug:') ||
    content.toLowerCase().includes('info:')
  )) {
    console.log("Skipping filtered message:", content);
    return;
  }
  
  // Safety check for undefined or null values
  if (!role) role = "infolog";
  if (!content) {
    console.error("Attempted to display message with empty content");
    content = "(Empty message)";
  }
  
  // Log the message being displayed
  console.log(`Displaying message - Role: ${role}, Content: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
  
  const messageDiv = document.createElement("div");
  messageDiv.className = "message " + role;
  
  if (role === "infolog") {
    messageDiv.classList.add("infolog");
  }
  
  messageDiv.innerText = content;
  chatLog.appendChild(messageDiv);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function parseMessage(data: any): ChatMessage | null {
  // skip certain message types
  if (data.type === "ping") {
    return null;
  }

  // handle log messages
  if (data.log && typeof data.log === 'string') {
    return {
      role: 'infolog',
      content: data.log
    };
  }

  // standard format
  if (data.role && data.content) {
    return { role: data.role, content: data.content };
  }

  // try to extract role and content from various fields
  const possibleRoles = ['role', 'speaker', 'sender', 'from'];
  const possibleContents = ['content', 'message', 'text', 'body'];
  
  let role: string | null = null;
  for (const field of possibleRoles) {
    if (data[field] && typeof data[field] === 'string') {
      role = data[field];
      break;
    }
  }
  
  let content: string | null = null;
  for (const field of possibleContents) {
    if (data[field] && typeof data[field] === 'string') {
      content = data[field];
      break;
    }
  }
  
  if (role && content) {
    return { role, content };
  }

  // Try using top-level fields if object has only two fields
  const keys = Object.keys(data);
  if (keys.length === 2) {
    const [firstKey, secondKey] = keys;
    if (typeof data[firstKey] === 'string' && typeof data[secondKey] === 'string') {
      return {
        role: firstKey,
        content: data[secondKey]
      };
    }
  }

  return null;
}
