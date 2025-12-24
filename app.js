import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get, set, onValue, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBv36GemaSD-sMRUKjNdwkMiLyPv8-kOMI",
    authDomain: "mini-militia-online.firebaseapp.com",
    databaseURL: "https://mini-militia-online-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "mini-militia-online",
    storageBucket: "mini-militia-online.firebasestorage.app",
    messagingSenderId: "1042367396622",
    appId: "1:1042367396622:web:271681c7160b559807b55f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- DOM ELEMENTS ---
const startScreen = document.getElementById('start-screen');
const inputScreen = document.getElementById('input-screen');
const waitingScreen = document.getElementById('waiting-screen');
const playerListArea = document.getElementById('player-list-area');

const btnStart = document.getElementById('btn-start');
const btnJoin = document.getElementById('btn-join');
const btnReady = document.getElementById('btn-ready');
const statusMsg = document.getElementById('status-msg');

// --- GAME STATE ---
let myPlayerId = 'soldier_' + Math.floor(Math.random() * 100000);
let currentRoom = "";
let isMyReady = false;

// --- EVENT LISTENERS ---

// 1. START BUTTON
btnStart.addEventListener('click', () => {
    // Fullscreen & Orientation Lock
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) docEl.requestFullscreen().catch(() => {});
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
    }
    
    startScreen.classList.add('hidden');
    inputScreen.classList.remove('hidden');
});

// 2. JOIN BUTTON
btnJoin.addEventListener('click', () => {
    const name = document.getElementById('input-name').value.trim();
    const room = document.getElementById('input-room').value.trim();

    if (!name || !room) {
        statusMsg.innerText = "NAME AND ROOM ARE REQUIRED!";
        return;
    }

    btnJoin.disabled = true;
    statusMsg.innerText = "Connecting to Satellite...";

    // Check if room exists (Optional check, mainly to ensure DB connection works)
    const roomRef = ref(db, 'rooms/' + room);
    get(roomRef).then(() => {
        enterLobby(room, name);
    }).catch((err) => {
        statusMsg.innerText = "Connection Error: " + err.message;
        btnJoin.disabled = false;
    });
});

// 3. READY BUTTON
btnReady.addEventListener('click', () => {
    isMyReady = !isMyReady;

    if (isMyReady) {
        btnReady.innerText = "READY!";
        btnReady.classList.add('is-ready');
    } else {
        btnReady.innerText = "NOT READY";
        btnReady.classList.remove('is-ready');
    }

    // Sync Ready Status to DB
    update(ref(db, 'rooms/' + currentRoom + '/players/' + myPlayerId), {
        ready: isMyReady
    });
});

// --- HELPER FUNCTIONS ---

function enterLobby(roomName, playerName) {
    currentRoom = roomName;

    // Switch Screens
    inputScreen.classList.add('hidden');
    waitingScreen.classList.remove('hidden');
    document.getElementById('room-title').innerText = "ROOM: " + roomName;

    // Add Myself to DB
    const myRef = ref(db, 'rooms/' + roomName + '/players/' + myPlayerId);
    set(myRef, {
        name: playerName,
        ready: false,
        online: true
    });

    // Listen for Player Updates (Realtime Sync)
    const playersRef = ref(db, 'rooms/' + roomName + '/players');
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val();
        renderPlayerList(data);
    });
}

function renderPlayerList(players) {
    playerListArea.innerHTML = ""; // Clear existing list
    
    if (!players) return;

    Object.keys(players).forEach((key) => {
        const p = players[key];
        const isMe = (key === myPlayerId);
        
        // Create HTML Card
        const card = document.createElement('div');
        card.className = "player-card " + (p.ready ? "ready" : "");
        
        const readyText = p.ready ? "READY" : "WAITING";
        const readyColor = p.ready ? "#4CAF50" : "#888";

        card.innerHTML = `
            <div>
                <strong>${p.name}</strong> ${isMe ? "(YOU)" : ""}
            </div>
            <div style="color:${readyColor}; font-weight:bold;">
                ${readyText}
            </div>
        `;
        
        playerListArea.appendChild(card);
    });
}
