import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, push, onChildAdded, onChildRemoved, remove, onDisconnect, runTransaction, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

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
let AM_I_HOST = false;
const peers = {}; // Stores active connections

// --- EXPORTED FUNCTIONS ---

export function startNetwork(roomId, myId, myName) {
    ROOM_ID = roomId;
    MY_ID = myId;
    MY_NAME = myName;

    // 1. Determine Role
    runTransaction(ref(db, `rooms/${ROOM_ID}/hostID`), (current) => {
        if (current === null) return MY_ID;
        if (current === MY_ID) return MY_ID;
        return undefined; 
    }).then((result) => {
        AM_I_HOST = result.committed;
        
        if (AM_I_HOST) {
            updateUI("HOST", "blue", "WAITING FOR CLIENT...");
            const hostRef = ref(db, `rooms/${ROOM_ID}/hostID`);
            set(hostRef, MY_ID);
            onDisconnect(hostRef).remove();
        } else {
            updateUI("CLIENT", "yellow", "SEARCHING FOR HOST...");
            // Auto-Connect Listener
            onValue(ref(db, `rooms/${ROOM_ID}/hostID`), (snap) => {
                const targetHostId = snap.val();
                if (targetHostId) {
                    console.log(`Host Found: ${targetHostId}. Auto-Calling...`);
                    startWebRTC(targetHostId, true);
                }
            });
        }
        
        // 2. Start Signaling Listener
        initSignaling();
    });
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
    console.log("Signaling Active.");
    remove(ref(db, `rooms/${ROOM_ID}/signals/${MY_ID}`)); // Clean start

    // Presence
    const myRef = ref(db, `rooms/${ROOM_ID}/players/${MY_ID}`);
    set(myRef, { online: true, name: MY_NAME });
    onDisconnect(myRef).remove();

    // Incoming Signals
    onChildAdded(ref(db, `rooms/${ROOM_ID}/signals/${MY_ID}`), (snapshot) => {
        const data = snapshot.val();
        if (data) handleSignal(data.sender, data.payload);
    });

    // Instant Disconnect Listener
    onChildRemoved(ref(db, `rooms/${ROOM_ID}/players`), (snapshot) => {
        if (snapshot.key !== MY_ID) cleanupPeer(snapshot.key);
    });
}

function sendSignal(targetId, payload) {
    push(ref(db, `rooms/${ROOM_ID}/signals/${targetId}`), {
        sender: MY_ID,
        payload: payload
    });
}

async function startWebRTC(targetId, isInitiator) {
    if (peers[targetId]) return;

    const pc = new RTCPeerConnection(rtcConfig);
    peers[targetId] = { conn: pc, channel: null };

    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        updateStatus(state.toUpperCase());

        if(state === 'disconnected' || state === 'failed' || state === 'closed') {
            cleanupPeer(targetId);
        }
    };

    if (isInitiator) {
        const channel = pc.createDataChannel("game");
        setupChannel(channel, targetId);
    } else {
        pc.ondatachannel = (e) => setupChannel(e.channel, targetId);
    }

    pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal(targetId, { type: 'candidate', candidate: e.candidate.toJSON() });
    };

    if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal(targetId, { type: 'offer', sdp: offer });
    }
}

async function handleSignal(senderId, signal) {
    if (!peers[senderId]) await startWebRTC(senderId, false);
    const pc = peers[senderId].conn;

    if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(senderId, { type: 'answer', sdp: answer });
    } else if (signal.type === 'answer') {
        if (!pc.currentRemoteDescription) await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } else if (signal.type === 'candidate') {
        try { 
            if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            else await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch(e) {}
    }
}

function setupChannel(channel, id) {
    channel.onopen = () => {
        updateStatus("SYNC ACTIVE", "green");
        // Trigger global hook for initial spawn
        if (window.onNetworkConnect) window.onNetworkConnect();
    };
    peers[id].channel = channel;
    
    channel.onmessage = (e) => {
        const data = JSON.parse(e.data);
        // Call global hook defined in game.html
        if (window.onNetworkData) window.onNetworkData(id, data);
    };
}

function cleanupPeer(id) {
    if (peers[id]) {
        peers[id].conn.close();
        delete peers[id];
    }
    // Call global hook to remove sprite
    if (window.onPeerDisconnect) window.onPeerDisconnect(id);
    
    if (AM_I_HOST) updateStatus("WAITING...", "red");
    else updateStatus("DISCONNECTED", "red");
}

// --- HELPER TO UPDATE HTML UI ---
function updateUI(role, color, status) {
    document.getElementById('disp-role').innerText = role;
    document.getElementById('disp-role').className = color;
    document.getElementById('disp-status').innerText = status;
}

function updateStatus(text, color) {
    const el = document.getElementById('disp-status');
    el.innerText = text;
    if (color) el.className = color;
    else if (text === "CONNECTED") el.className = "green";
    else if (text === "CHECKING") el.className = "orange";
    else el.className = "red";
}
