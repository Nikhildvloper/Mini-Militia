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
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" }
    ]
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- STATE ---
let ROOM_ID, MY_ID, MY_NAME;
const peers = {}; // Active Connections
const knownPlayers = new Set(); // Everyone in the room (connected or not)
let meshHealerInterval = null;

// --- EXPORTED FUNCTIONS ---

export function startNetwork(roomId, myId, myName) {
    ROOM_ID = roomId;
    MY_ID = myId;
    MY_NAME = myName;

    updateStatus("CONNECTING TO MESH...", "yellow");
    initSignaling();
    
    // START THE HEALER LOOP (Every 3 Seconds)
    if (meshHealerInterval) clearInterval(meshHealerInterval);
    meshHealerInterval = setInterval(checkMeshHealth, 3000);
}

export function broadcastData(data) {
    const packet = JSON.stringify(data);
    Object.values(peers).forEach(p => {
        if(p.channel && p.channel.readyState === 'open') {
            p.channel.send(packet);
        }
    });
}

// --- MESH HEALER (The Fix) ---
function checkMeshHealth() {
    // Look at everyone we know is in the room
    knownPlayers.forEach(peerId => {
        if (peerId === MY_ID) return;

        // If we are NOT connected to them
        if (!peers[peerId]) {
            console.log(`[Mesh Healer] Missing connection to ${peerId}. Retrying...`);
            
            // Retry using the Golden Rule (Higher ID calls)
            if (MY_ID > peerId) {
                startWebRTC(peerId, true);
            }
        }
        // If we ARE connected but the channel is closed/dead
        else if (peers[peerId].conn.connectionState === 'failed' || peers[peerId].conn.connectionState === 'disconnected') {
            console.log(`[Mesh Healer] Dead connection to ${peerId}. Restarting...`);
            cleanupPeer(peerId); // Kill it first
            if (MY_ID > peerId) startWebRTC(peerId, true); // Then restart
        }
    });
}

// --- INTERNAL LOGIC ---

function initSignaling() {
    console.log("Initializing Mesh Signaling...");
    
    remove(ref(db, `rooms/${ROOM_ID}/signals/${MY_ID}`)); 

    const myRef = ref(db, `rooms/${ROOM_ID}/players/${MY_ID}`);
    set(myRef, { online: true, name: MY_NAME });
    onDisconnect(myRef).remove();

    // 1. DISCOVERY
    const playersRef = ref(db, `rooms/${ROOM_ID}/players`);
    onChildAdded(playersRef, (snapshot) => {
        const peerId = snapshot.key;
        if (peerId === MY_ID) return;

        // Add to "Known" list for the Healer to track
        knownPlayers.add(peerId);
        console.log(`Discovered Peer: ${peerId}`);

        // Initial Attempt
        if (MY_ID > peerId) {
            startWebRTC(peerId, true);
        }
    });

    // 2. SIGNALS
    onChildAdded(ref(db, `rooms/${ROOM_ID}/signals/${MY_ID}`), (snapshot) => {
        const data = snapshot.val();
        if (data) handleSignal(data.sender, data.payload);
        remove(snapshot.ref); 
    });

    // 3. REMOVAL
    onChildRemoved(playersRef, (snapshot) => {
        const peerId = snapshot.key;
        if (peerId !== MY_ID) {
            knownPlayers.delete(peerId); // Stop trying to heal this connection
            cleanupPeer(peerId);
        }
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

    console.log(`Starting WebRTC with ${targetId}`);
    const pc = new RTCPeerConnection(rtcConfig);
    peers[targetId] = { conn: pc, channel: null };

    // Monitor Connection
    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if(state === 'disconnected' || state === 'failed' || state === 'closed') {
            // Don't delete immediately, let the Healer handle logic or wait for momentary drop
            // But update UI
            updatePeerCount();
        }
        if(state === 'connected') updatePeerCount();
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
            // Collision handling: If we are already connected or connecting, ignore lower-ID offers
            // But since we follow Golden Rule strictly, this is just a standard accept.
            if (pc.signalingState !== "stable") {
                // If we are in "glare", rollback could be needed, but usually simplified logic holds up.
                await Promise.all([
                    pc.setLocalDescription({type: "rollback"}),
                    pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
                ]);
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
            // Queue candidate if remote desc not ready
            if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } else {
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

function updatePeerCount() {
    // Count only OPEN channels (Active players)
    let activeCount = 0;
    Object.values(peers).forEach(p => {
        if (p.channel && p.channel.readyState === 'open') activeCount++;
    });

    const el = document.getElementById('disp-status');
    if(el) {
        if(activeCount === 0) {
            el.innerText = "SEARCHING...";
            el.className = "red";
        } else {
            el.innerText = `SQUAD: ${activeCount + 1} MEMBERS`; // +1 includes Me
            el.className = "green";
        }
    }
}
