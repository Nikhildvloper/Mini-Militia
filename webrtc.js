import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, push, onChildAdded, onChildRemoved, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

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
const peers = {}; // Stores active connections: { "player_id": { conn, channel } }

// --- EXPORTED FUNCTIONS ---

export function startNetwork(roomId, myId, myName) {
    ROOM_ID = roomId;
    MY_ID = myId;
    MY_NAME = myName;

    updateStatus("CONNECTING TO SQUAD...", "yellow");
    initSignaling();
}

export function broadcastData(data) {
    const packet = JSON.stringify(data);
    // Send to ALL connected peers
    Object.values(peers).forEach(p => {
        if(p.channel && p.channel.readyState === 'open') {
            p.channel.send(packet);
        }
    });
}

// --- INTERNAL LOGIC ---

function initSignaling() {
    console.log("Initializing Mesh Signaling...");
    
    // 1. Clean my mailbox (Remove old signals intended for me)
    remove(ref(db, `rooms/${ROOM_ID}/signals/${MY_ID}`)); 

    // 2. Register Presence (I am here!)
    const myRef = ref(db, `rooms/${ROOM_ID}/players/${MY_ID}`);
    set(myRef, { online: true, name: MY_NAME });
    onDisconnect(myRef).remove();

    // 3. LISTEN FOR PLAYERS (Mesh Discovery)
    const playersRef = ref(db, `rooms/${ROOM_ID}/players`);
    onChildAdded(playersRef, (snapshot) => {
        const peerId = snapshot.key;
        if (peerId === MY_ID) return; // Ignore myself

        console.log(`Discovered Peer: ${peerId}`);

        // --- THE GOLDEN RULE ---
        // Prevents collision. Only the player with the "Alphabetically Higher" ID calls.
        if (MY_ID > peerId) {
            console.log(`I am initiating call to ${peerId} (My ID > Theirs)`);
            startWebRTC(peerId, true);
        } else {
            console.log(`Waiting for ${peerId} to call me (My ID < Theirs)`);
        }
    });

    // 4. LISTEN FOR SIGNALS (Offers/Answers/Candidates)
    onChildAdded(ref(db, `rooms/${ROOM_ID}/signals/${MY_ID}`), (snapshot) => {
        const data = snapshot.val();
        if (data) handleSignal(data.sender, data.payload);
        
        // Remove signal after reading to keep DB clean
        remove(snapshot.ref); 
    });

    // 5. LISTEN FOR DISCONNECTS
    onChildRemoved(playersRef, (snapshot) => {
        const peerId = snapshot.key;
        if (peerId !== MY_ID) cleanupPeer(peerId);
    });
}

function sendSignal(targetId, payload) {
    push(ref(db, `rooms/${ROOM_ID}/signals/${targetId}`), {
        sender: MY_ID,
        payload: payload
    });
}

async function startWebRTC(targetId, isInitiator) {
    if (peers[targetId]) return; // Already connected

    console.log(`Starting WebRTC with ${targetId}`);
    const pc = new RTCPeerConnection(rtcConfig);
    peers[targetId] = { conn: pc, channel: null };

    // Monitor Connection State
    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if(state === 'disconnected' || state === 'failed' || state === 'closed') {
            cleanupPeer(targetId);
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
    // If we receive an offer but don't have a PC yet, create one (we are the receiver)
    if (!peers[senderId]) await startWebRTC(senderId, false);
    
    const pc = peers[senderId].conn;

    try {
        if (signal.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal(senderId, { type: 'answer', sdp: answer });
        } 
        else if (signal.type === 'answer') {
            if (!pc.currentRemoteDescription) await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } 
        else if (signal.type === 'candidate') {
            if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            else {
                // Buffer candidate if remote desc isn't ready
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

function cleanupPeer(id) {
    if (peers[id]) {
        peers[id].conn.close();
        delete peers[id];
    }
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
    const count = Object.keys(peers).length;
    const el = document.getElementById('disp-status');
    if(el) {
        if(count === 0) {
            el.innerText = "SEARCHING FOR SQUAD...";
            el.className = "red";
        } else {
            el.innerText = `CONNECTED (${count} PEERS)`;
            el.className = "green";
        }
    }
}
