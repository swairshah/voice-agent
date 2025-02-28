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
        const msg = JSON.parse(event.data);
        appendMessage(msg.role, msg.content);
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

    // Open an EventSource to listen for text messages (chat updates).
    eventSource = new EventSource(`/outputs?webrtc_id=${webrtcId}`);
    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        appendMessage(data.role, data.content);
    };
});

stopBtn.addEventListener("click", () => {
    stopBtn.disabled = true;
    startBtn.disabled = false;
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (eventSource) {
        eventSource.close();
    }
});

// Utility to append chat messages.
function appendMessage(role, content) {
    const messageDiv = document.createElement("div");
    messageDiv.className = "message " + role;
    messageDiv.innerText = content;
    chatLog.appendChild(messageDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}
