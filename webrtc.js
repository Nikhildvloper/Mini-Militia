import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, push, onChildAdded, onChildRemoved, remove, onDisconnect, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// --- CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyBv36GemaSD-sMRUKjNdwkMiLyPv8-kOMI",
    authDomain: "mini-militia-online.firebaseapp.com",
    databaseURL: "https://mini-militia-online-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "mini-militia-online",
    storageBucket: "mini-militia-online.firebasestorage.app",
    messagingSenderId: "1042367396622",
    appId: "1:1042367396622:web:271681c7160b559807b55f"
};

const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- STATE ---
let ROOM_ID, MY_ID, MY_NAME;
const peers = {}; // Active WebRTC connections
let knownPlayers = []; // List of all players in DB

// --- EXPORTED FUNCTIONS ---

export function startNetwork(roomId, myId, myName) {
    ROOM_ID = roomId;
    MY_ID = myId;
    MY_NAME = myName;

    updateStatus("CONNECTING...", "yellow");
    initSignaling();
    
    // --- THE FIX: SELF-HEALING LOOP ---
    // Every 3 seconds, check if we are missing any connections
    setInterval(checkConnectivity, 3000);
}

export function broadcastData(data) {
    const packet = JSON.stringify(data);
    Object.values(peers).forEach(p => {
        if(p.channel && p.channel.readyState === 'open') {
            p.channel.send(packet);
        }
    });
}

// --- INTERNAL LOGIC ---

function initSignaling() {
    console.log("Initializing Mesh Signaling...");
    
    // 1. Clean my mailbox
    remove(ref(db, `rooms/${ROOM_ID}/signals/${MY_ID}`)); 

    // 2. Register Presence
    const myRef = ref(db, `rooms/${ROOM_ID}/players/${MY_ID}`);
    set(myRef, { online: true, name: MY_NAME });
    onDisconnect(myRef).remove();

    // 3. LISTEN FOR PLAYERS (Maintain a list of who SHOULD be here)
    const playersRef = ref(db, `rooms/${ROOM_ID}/players`);
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val() || {};
        knownPlayers = Object.keys(data).filter(id => id !== MY_ID);
        
        // Instant check upon list update
        checkConnectivity();
    });

    // 4. LISTEN FOR SIGNALS
    onChildAdded(ref(db, `rooms/${ROOM_ID}/signals/${MY_ID}`), (snapshot) => {
        const data = snapshot.val();
        if (data) handleSignal(data.sender, data.payload);
        remove(snapshot.ref); // Keep mailbox clean
    });
}

// --- THE SELF-HEALING FUNCTION ---
function checkConnectivity() {
    knownPlayers.forEach(peerId => {
        // If we are NOT connected to this known player...
        if (!peers[peerId] || peers[peerId].conn.connectionState === 'failed') {
            
            console.log(`Missing connection to ${peerId}. Attempting repair...`);
            
            // Apply Golden Rule (Higher ID Calls)
            if (MY_ID > peerId) {
                console.log(`-> RE-INITIATING CALL to ${peerId}`);
                // Force restart
                if (peers[peerId]) peers[peerId].conn.close();
                delete peers[peerId];
                startWebRTC(peerId, true);
            } else {
                console.log(`-> WAITING for ${peerId} to call (I am smaller ID)`);
                // If they failed to call us for a long time, we might need to nudge them
                // But usually, they will run their own checkConnectivity() and call us.
            }
        }
    });
    updatePeerCount();
}

function sendSignal(targetId, payload) {
    push(ref(db, `rooms/${ROOM_ID}/signals/${targetId}`), {
        sender: MY_ID,
        payload: payload
    });
}

async function startWebRTC(targetId, isInitiator) {
    if (peers[targetId]) return; 

    console.log(`Starting WebRTC with ${targetId}`);
    const pc = new RTCPeerConnection(rtcConfig);
    peers[targetId] = { conn: pc, channel: null };

    // Monitor Connection State
    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if(state === 'disconnected' || state === 'failed' || state === 'closed') {
            console.log(`Connection lost with ${targetId}`);
            // We don't delete immediately here; we let the checkConnectivity() loop handle the retry
            // to avoid race conditions.
            cleanupPeerUI(targetId);
        }
        updatePeerCount();
    };

    // Data Channel Setup
    if (isInitiator) {
        const channel = pc.createDataChannel("game");
        setupChannel(channel, targetId);
    } else {
        pc.ondatachannel = (e) => setupChannel(e.channel, targetId);
    }

    // ICE Candidates
    pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal(targetId, { type: 'candidate', candidate: e.candidate.toJSON() });
    };

    // Negotiation
    if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal(targetId, { type: 'offer', sdp: offer });
    }
}

async function handleSignal(senderId, signal) {
    // If we receive a signal from someone we thought was dead, revive the connection logic
    if (!peers[senderId]) await startWebRTC(senderId, false);
    
    const pc = peers[senderId].conn;

    try {
        if (signal.type === 'offer') {
            // Collision handling: If I already made an offer (glare), but theirs is valid
            if (pc.signalingState !== "stable") {
                // If I am the "smaller" ID, I yield and accept their offer
                if (MY_ID < senderId) {
                    await Promise.all([
                        pc.setLocalDescription({type: "rollback"}),
                        pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
                    ]);
                } else {
                    return; // I am the boss, ignore their conflicting offer
                }
            } else {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            }
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal(senderId, { type: 'answer', sdp: answer });
        } 
        else if (signal.type === 'answer') {
            if (pc.signalingState === "have-local-offer") {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            }
        } 
        else if (signal.type === 'candidate') {
            // Robust candidate handling
            if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            else {
                // Buffer
                setTimeout(async () => {
                    if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                }, 1000);
            }
        }
    } catch(e) { console.error("Signal Error:", e); }
}

function setupChannel(channel, id) {
    channel.onopen = () => {
        console.log(`Channel OPEN with ${id}`);
        updatePeerCount();
        if (window.onNetworkConnect) window.onNetworkConnect();
    };
    peers[id].channel = channel;
    
    channel.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (window.onNetworkData) window.onNetworkData(id, data);
    };
}

function cleanupPeerUI(id) {
    // This only cleans up the UI/Game sprite, doesn't delete the peer object 
    // immediately to allow for graceful re-connection attempts logic
    if (window.onPeerDisconnect) window.onPeerDisconnect(id);
    updatePeerCount();
}

// --- UI HELPERS ---
function updateStatus(text, color) {
    const el = document.getElementById('disp-status');
    if(el) {
        el.innerText = text;
        el.className = color || "white";
    }
}

function updatePeerCount() {
    // Count only OPEN channels
    const count = Object.values(peers).filter(p => p.channel && p.channel.readyState === 'open').length;
    const el = document.getElementById('disp-status');
    if(el) {
        if(count === 0) {
            el.innerText = "SEARCHING...";
            el.className = "red";
        } else {
            el.innerText = `CONNECTED (${count} PEERS)`;
            el.className = "green";
        }
    }
}
