// Get DOM elements.
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const chatLog = document.getElementById("chat-log");
const remoteAudio = document.getElementById("remote-audio");

let peerConnection;
let localStream;
let webrtcId;
let eventSource;

startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    // Generate a unique session id.
    webrtcId = "session_" + Date.now();

    // Get microphone audio.
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        console.error("Error accessing microphone", err);
        return;
    }

    // Create a new RTCPeerConnection (using a public STUN server).
    const config = {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    };
    peerConnection = new RTCPeerConnection(config);

    // Add local audio tracks.
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Handle incoming remote audio tracks.
    peerConnection.ontrack = (event) => {
        console.log("Received remote track");
        remoteAudio.srcObject = event.streams[0];
    };

    // Create a data channel (optional) for receiving chat messages.
    const dataChannel = peerConnection.createDataChannel("chat");
    dataChannel.onmessage = (event) => {
        console.log("------ WebRTC Data Channel Message Received ------");
        console.log("Raw data channel message:", event.data);
        
        try {
            // Try to parse as JSON
            const msg = JSON.parse(event.data);
            
            // Log the parsed data
            console.log("Parsed data channel message:", msg);
            
            // Skip messages with type "log"
            if (msg.type === "log") {
                console.log("Skipping log message:", msg);
                return;
            }
            
            // If it has role and content, display it
            if (msg.role && msg.content) {
                console.log(`Displaying WebRTC message from ${msg.role}`);
                appendMessage(msg.role, msg.content);
            } else {
                // Try to determine if it's a complete message or fragment
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
            appendMessage("system", event.data);
        }
        
        console.log("------ End WebRTC Data Channel Message ------");
    };

    // Handle ICE candidates (for debugging or if you want to send them manually).
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("New ICE candidate", event.candidate);
        }
    };

    // Create an SDP offer.
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // Send the offer to the FastRTC backend.
    // const response = await fetch("/webrtc/offer?webrtc_id=" + webrtcId, {
    //     method: "POST",
    //     headers: { "Content-Type": "application/json" },
    //     //body: JSON.stringify({ sdp: offer.sdp, type: offer.type })
    //     body: JSON.stringify({ offer: { sdp: offer.sdp, type: offer.type } })

    // });
    const response = await fetch("/webrtc/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
	//body: JSON.stringify({ sdp: offer.sdp, type: offer.type })
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

    // Connect to WebSocket for text messages
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/chat?webrtc_id=${webrtcId}`;
    
    console.log("Connecting to WebSocket:", wsUrl);
    const chatWebSocket = new WebSocket(wsUrl);
    window.chatWebSocket = chatWebSocket;
    
    // Set a flag to track if we've shown a connection error
    let hasShownConnectionError = false;
    
    // Setup event handlers for WebSocket
    chatWebSocket.onopen = () => {
        console.log("WebSocket connection established");
        appendMessage("system", "Text chat connection established");
        hasShownConnectionError = false;
        
        // Implement a ping mechanism to keep the connection alive
        window.wsKeepAliveInterval = setInterval(() => {
            if (chatWebSocket && chatWebSocket.readyState === WebSocket.OPEN) {
                try {
                    chatWebSocket.send(JSON.stringify({ type: "ping" }));
                } catch (err) {
                    console.error("Error sending ping:", err);
                }
            }
        }, 30000); // Send ping every 30 seconds
    };
    
    // Message counter to debug message order
    let messageCounter = 0;
    
    chatWebSocket.onmessage = (event) => {
        messageCounter++;
        console.log(`------ WebSocket Message #${messageCounter} Received ------`);
        console.log("Raw message data:", event.data);
        
        try {
            // Parse the message
            const data = JSON.parse(event.data);
            
            // Create a deep copy to prevent log mutation issues
            const dataCopy = JSON.parse(JSON.stringify(data));
            
            // Extra debug logging to find the source of "log" messages
            if (typeof data === 'object' && Object.keys(data).includes('log')) {
                console.warn("Found 'log' key in message data:", data);
                // If it contains a message, extract it
                if (typeof data.log === 'string') {
                    console.log("Converting 'log' message to system message");
                    // Convert to proper format
                    dataCopy.role = "system";
                    dataCopy.content = data.log;
                    dataCopy.type = "text";
                }
            }
            
            // Log as structured data for better readability
            console.log({
                messageId: messageCounter,
                messageType: dataCopy.type || "unknown",
                role: dataCopy.role || "missing",
                contentPreview: dataCopy.content ? 
                    (dataCopy.content.length > 50 ? 
                        dataCopy.content.substring(0, 50) + "..." : dataCopy.content) 
                    : "missing",
                fullObject: dataCopy
            });
            
            // Ignore ping messages
            if (dataCopy.type === "ping") {
                console.log("Ignoring ping message");
                return;
            }
            
            // Handle different message formats
            
            // Case 1: Standard format with role and content
            if (dataCopy.role && dataCopy.content) {
                console.log(`Displaying message from ${dataCopy.role}`);
                appendMessage(dataCopy.role, dataCopy.content);
                return;
            }
            
            // Case 1.5: Special handling for 'log' messages - only log to console, don't display
            if (dataCopy.log && typeof dataCopy.log === 'string') {
                console.log("Found log message (not displaying):", dataCopy.log);
                // Don't show log messages to the user
                return;
            }
            
            // Case 2: Old format or alternative format
            if (typeof dataCopy === 'object') {
                // Try to extract role and content from any fields that might contain them
                const possibleRoles = ['role', 'speaker', 'sender', 'from'];
                const possibleContents = ['content', 'message', 'text', 'body'];
                
                // Find first valid role
                let role = null;
                for (const field of possibleRoles) {
                    if (dataCopy[field] && typeof dataCopy[field] === 'string') {
                        role = dataCopy[field];
                        break;
                    }
                }
                
                // Find first valid content
                let content = null;
                for (const field of possibleContents) {
                    if (dataCopy[field] && typeof dataCopy[field] === 'string') {
                        content = dataCopy[field];
                        break;
                    }
                }
                
                // If we found both role and content, display the message
                if (role && content) {
                    console.log(`Displaying message using extracted values - Role: ${role}`);
                    appendMessage(role, content);
                    return;
                }
                
                // Case 3: Try using top-level fields as role/content if object has only two fields
                const keys = Object.keys(dataCopy);
                if (keys.length === 2) {
                    const firstVal = dataCopy[keys[0]];
                    const secondVal = dataCopy[keys[1]];
                    
                    if (typeof firstVal === 'string' && typeof secondVal === 'string') {
                        console.log(`Displaying message using field names - Role: ${keys[0]}`);
                        appendMessage(keys[0], secondVal);
                        return;
                    }
                }
            }
            
            // If we get here, we couldn't extract role and content
            console.error("Invalid message format. Couldn't extract role or content:", dataCopy);
            
        } catch (error) {
            console.error("Error parsing WebSocket message:", error);
        }
        
        console.log(`------ End WebSocket Message #${messageCounter} ------`);
    };
    
    chatWebSocket.onerror = (error) => {
        console.error("WebSocket error:", error);
        if (!hasShownConnectionError) {
            appendMessage("system", "Text chat connection error. Some messages may not appear.");
            hasShownConnectionError = true;
        }
        
        // Try to reconnect after a delay
        setTimeout(() => {
            if (peerConnection && peerConnection.connectionState === "connected" && 
                (!window.chatWebSocket || window.chatWebSocket.readyState !== WebSocket.OPEN)) {
                console.log("Attempting to reconnect WebSocket...");
                const newWebSocket = new WebSocket(wsUrl);
                window.chatWebSocket = newWebSocket;
                
                // Set up the same event handlers for the new connection
                newWebSocket.onopen = chatWebSocket.onopen;
                newWebSocket.onmessage = chatWebSocket.onmessage;
                newWebSocket.onerror = chatWebSocket.onerror;
                newWebSocket.onclose = chatWebSocket.onclose;
            }
        }, 5000); // Wait 5 seconds before reconnecting
    };
    
    chatWebSocket.onclose = (event) => {
        console.log("WebSocket connection closed:", event);
        
        // Clear the keep-alive interval
        if (window.wsKeepAliveInterval) {
            clearInterval(window.wsKeepAliveInterval);
            window.wsKeepAliveInterval = null;
        }
        
        // Only show a message if this wasn't intentionally closed
        if (peerConnection && peerConnection.connectionState === "connected") {
            appendMessage("system", "Text chat connection closed. Voice connection still active. Attempting to reconnect...");
            
            // Try to reconnect after a delay
            setTimeout(() => {
                if (peerConnection && peerConnection.connectionState === "connected") {
                    console.log("Attempting to reconnect WebSocket after close...");
                    const newWebSocket = new WebSocket(wsUrl);
                    window.chatWebSocket = newWebSocket;
                    
                    // Set up the same event handlers for the new connection
                    newWebSocket.onopen = chatWebSocket.onopen;
                    newWebSocket.onmessage = chatWebSocket.onmessage;
                    newWebSocket.onerror = chatWebSocket.onerror;
                    newWebSocket.onclose = chatWebSocket.onclose;
                }
            }, 2000); // Wait 2 seconds before reconnecting
        }
    };
    
    // Also try to use EventSource for text updates as a fallback
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
    
    // Clear any WebSocket keep-alive interval
    if (window.wsKeepAliveInterval) {
        clearInterval(window.wsKeepAliveInterval);
        window.wsKeepAliveInterval = null;
    }
    
    // Close WebSocket
    if (window.chatWebSocket) {
        // Remove event handlers to prevent reconnection attempts
        window.chatWebSocket.onclose = null;
        window.chatWebSocket.onerror = null;
        window.chatWebSocket.close();
        window.chatWebSocket = null;
    }
    
    // Add a system message to indicate the conversation has ended
    appendMessage("system", "Conversation ended");
});

// Utility to append chat messages.
function appendMessage(role, content) {
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
        (role === 'system' && content.toLowerCase().includes('connection')) ||
        // Skip any messages that look like debugging or internal logs
        content.toLowerCase().includes('log:') ||
        content.toLowerCase().includes('debug:') ||
        content.toLowerCase().includes('info:')
    )) {
        console.log("Skipping filtered message:", content);
        return;
    }
    
    // Safety check for undefined or null values
    if (!role) role = "system";
    if (!content) {
        console.error("Attempted to display message with empty content");
        content = "(Empty message)";
    }
    
    // Log the message being displayed
    console.log(`Displaying message - Role: ${role}, Content: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
    
    const messageDiv = document.createElement("div");
    messageDiv.className = "message " + role;
    
    // Special styling for system messages
    if (role === "system") {
        messageDiv.style.backgroundColor = "#f8f9fa";
        messageDiv.style.color = "#6c757d";
        messageDiv.style.border = "1px solid #dee2e6";
        messageDiv.style.padding = "10px 15px";
        messageDiv.style.margin = "10px auto";
        messageDiv.style.textAlign = "center";
        messageDiv.style.fontStyle = "italic";
        messageDiv.style.fontSize = "0.9em";
    }
    
    messageDiv.innerText = content;
    chatLog.appendChild(messageDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}
