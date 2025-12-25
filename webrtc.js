import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, push, onChildAdded, onChildRemoved, remove, onDisconnect, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyBv36GemaSD-sMRUKjNdwkMiLyPv8-kOMI",
    authDomain: "mini-militia-online.firebaseapp.com",
    databaseURL: "https://mini-militia-online-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "mini-militia-online",
    storageBucket: "mini-militia-online.firebasestorage.app",
    messagingSenderId: "1042367396622",
    appId: "1:1042367396622:web:271681c7160b559807b55f"
};

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let ROOM_ID, MY_ID, MY_NAME;
const peers = {}; 
let knownPlayers = [];

// --- EXPORTED FUNCTIONS ---

export function startNetwork(roomId, myId, myName) {
    ROOM_ID = roomId;
    MY_ID = myId;
    MY_NAME = myName;

    updateStatus("CONNECTING...", "yellow");
    initSignaling();
    setInterval(checkConnectivity, 3000); // Self-Healing
    setInterval(sendPing, 1000); // PING LOOP (Every 1s)
}

export function broadcastData(data) {
    const packet = JSON.stringify(data);
    Object.values(peers).forEach(p => {
        if(p.channel && p.channel.readyState === 'open') p.channel.send(packet);
    });
}

// --- INTERNAL LOGIC ---

function initSignaling() {
    console.log("Initializing Mesh Signaling...");
    remove(ref(db, `rooms/${ROOM_ID}/signals/${MY_ID}`)); 
    const myRef = ref(db, `rooms/${ROOM_ID}/players/${MY_ID}`);
    set(myRef, { online: true, name: MY_NAME });
    onDisconnect(myRef).remove();

    onValue(ref(db, `rooms/${ROOM_ID}/players`), (snap) => {
        const data = snap.val() || {};
        knownPlayers = Object.keys(data).filter(id => id !== MY_ID);
        checkConnectivity();
    });

    onChildAdded(ref(db, `rooms/${ROOM_ID}/signals/${MY_ID}`), (snapshot) => {
        const data = snapshot.val();
        if (data) handleSignal(data.sender, data.payload);
        remove(snapshot.ref); 
    });
}

function checkConnectivity() {
    knownPlayers.forEach(peerId => {
        if (!peers[peerId] || peers[peerId].conn.connectionState === 'failed') {
            if (MY_ID > peerId) {
                if (peers[peerId]) peers[peerId].conn.close();
                delete peers[peerId];
                startWebRTC(peerId, true);
            }
        }
    });
    updatePeerCount();
}

// --- PING LOGIC ---
function sendPing() {
    const pingPacket = JSON.stringify({ type: 'sys_ping', ts: Date.now() });
    Object.values(peers).forEach(p => {
        if(p.channel && p.channel.readyState === 'open') p.channel.send(pingPacket);
    });
}

function sendSignal(targetId, payload) {
    push(ref(db, `rooms/${ROOM_ID}/signals/${targetId}`), { sender: MY_ID, payload: payload });
}

async function startWebRTC(targetId, isInitiator) {
    if (peers[targetId]) return; 
    const pc = new RTCPeerConnection(rtcConfig);
    peers[targetId] = { conn: pc, channel: null, lastPing: 0 };

    pc.oniceconnectionstatechange = () => {
        if(['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) cleanupPeerUI(targetId);
        updatePeerCount();
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

    try {
        if (signal.type === 'offer') {
            if (pc.signalingState !== "stable" && MY_ID < senderId) {
                await Promise.all([pc.setLocalDescription({type: "rollback"}), pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))]);
            } else {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal(senderId, { type: 'answer', sdp: answer });
        } else if (signal.type === 'answer') {
            if (pc.signalingState === "have-local-offer") await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } else if (signal.type === 'candidate') {
            if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            else setTimeout(async () => { if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); }, 1000);
        }
    } catch(e) {}
}

function setupChannel(channel, id) {
    channel.onopen = () => { updatePeerCount(); if (window.onNetworkConnect) window.onNetworkConnect(); };
    peers[id].channel = channel;
    
    channel.onmessage = (e) => {
        const data = JSON.parse(e.data);
        
        // --- HANDLE PING/PONG ---
        if (data.type === 'sys_ping') {
            // They pinged me -> Send Pong back
            channel.send(JSON.stringify({ type: 'sys_pong', ts: data.ts }));
        } 
        else if (data.type === 'sys_pong') {
            // I received a pong -> Calculate Latency
            const latency = Date.now() - data.ts;
            peers[id].lastPing = latency;
            updatePingDisplay();
        } 
        else {
            // Real Game Data
            if (window.onNetworkData) window.onNetworkData(id, data);
        }
    };
}

function cleanupPeerUI(id) {
    if (window.onPeerDisconnect) window.onPeerDisconnect(id);
    updatePeerCount();
}

// --- UI HELPERS ---
function updateStatus(text, color) {
    const el = document.getElementById('disp-status');
    if(el) { el.innerText = text; el.className = color || "white"; }
}

function updatePeerCount() {
    const count = Object.values(peers).filter(p => p.channel && p.channel.readyState === 'open').length;
    const el = document.getElementById('disp-status');
    if(el) {
        if(count === 0) { el.innerText = "SEARCHING..."; el.className = "red"; }
        else { el.innerText = `CONNECTED (${count})`; el.className = "green"; }
    }
}

function updatePingDisplay() {
    // Calculate Average Ping across all peers
    const connected = Object.values(peers).filter(p => p.channel && p.channel.readyState === 'open');
    if (connected.length === 0) return;

    const totalPing = connected.reduce((acc, p) => acc + (p.lastPing || 0), 0);
    const avgPing = Math.round(totalPing / connected.length);

    const pingEl = document.getElementById('disp-ping');
    if(pingEl) {
        pingEl.innerText = `PING: ${avgPing}ms`;
        // Color coding logic
        if (avgPing < 100) pingEl.className = "green";
        else if (avgPing < 200) pingEl.className = "yellow";
        else pingEl.className = "red";
    }
}
