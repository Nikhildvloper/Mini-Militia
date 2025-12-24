import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get, set, onValue, update, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- DOM ELEMENTS ---
const startScreen = document.getElementById('start-screen');
const inputScreen = document.getElementById('input-screen');
const waitingScreen = document.getElementById('waiting-screen');
const playerListArea = document.getElementById('player-list-area');
const countdownOverlay = document.getElementById('countdown-overlay');

const btnStart = document.getElementById('btn-start');
const btnJoin = document.getElementById('btn-join');
const btnReady = document.getElementById('btn-ready');
const statusMsg = document.getElementById('status-msg');

// --- GAME STATE ---
let myPlayerId = 'soldier_' + Math.floor(Math.random() * 100000);
let currentRoom = "";
let isMyReady = false;
let countdownInterval = null;
let timerValue = 10;
let isLocked = false; // "Point of No Return" flag

// --- EVENT LISTENERS ---

// 1. START
btnStart.addEventListener('click', () => {
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) docEl.requestFullscreen().catch(() => {});
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
    }
    startScreen.classList.add('hidden');
    inputScreen.classList.remove('hidden');
});

// 2. JOIN
btnJoin.addEventListener('click', () => {
    const name = document.getElementById('input-name').value.trim();
    const room = document.getElementById('input-room').value.trim();

    if (!name || !room) {
        statusMsg.innerText = "NAME AND ROOM ARE REQUIRED!";
        return;
    }

    btnJoin.disabled = true;
    statusMsg.innerText = "Connecting...";

    const roomRef = ref(db, 'rooms/' + room);
    get(roomRef).then(() => {
        enterLobby(room, name);
    }).catch((err) => {
        statusMsg.innerText = "Error: " + err.message;
        btnJoin.disabled = false;
    });
});

// 3. READY BUTTON
btnReady.addEventListener('click', () => {
    if (isLocked) return; // Ignore clicks if timer < 4

    isMyReady = !isMyReady;
    updateReadyButtonUI();

    // Sync to DB
    update(ref(db, 'rooms/' + currentRoom + '/players/' + myPlayerId), {
        ready: isMyReady
    });
});

// --- CORE FUNCTIONS ---

function enterLobby(roomName, playerName) {
    currentRoom = roomName;

    inputScreen.classList.add('hidden');
    waitingScreen.classList.remove('hidden');
    document.getElementById('room-title').innerText = "ROOM: " + roomName;

    // Add Myself
    const myRef = ref(db, 'rooms/' + roomName + '/players/' + myPlayerId);
    set(myRef, {
        name: playerName,
        ready: false,
        online: true
    });

    // Remove on disconnect (Cleanup)
    onDisconnect(myRef).remove();

    // LISTEN FOR UPDATES
    const playersRef = ref(db, 'rooms/' + roomName + '/players');
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val();
        
        if (!data) return; // Room empty

        renderPlayerList(data);
        checkGameStart(data);
    });
}

function updateReadyButtonUI() {
    if (isMyReady) {
        btnReady.innerText = "READY!";
        btnReady.classList.add('is-ready');
    } else {
        btnReady.innerText = "NOT READY";
        btnReady.classList.remove('is-ready');
    }
}

function renderPlayerList(players) {
    playerListArea.innerHTML = "";
    Object.keys(players).forEach((key) => {
        const p = players[key];
        const isMe = (key === myPlayerId);
        
        const card = document.createElement('div');
        card.className = "player-card " + (p.ready ? "ready" : "");
        const readyText = p.ready ? "READY" : "WAITING";
        const readyColor = p.ready ? "#4CAF50" : "#888";

        card.innerHTML = `
            <div><strong>${p.name}</strong> ${isMe ? "(YOU)" : ""}</div>
            <div style="color:${readyColor}; font-weight:bold;">${readyText}</div>
        `;
        playerListArea.appendChild(card);
    });
}

// --- COUNTDOWN LOGIC ---

function checkGameStart(players) {
    const playerArray = Object.values(players);
    // Are ALL players ready?
    const allReady = playerArray.every(p => p.ready);
    const playerCount = playerArray.length;

    // Requirements: At least 1 player (or 2 for real MP) and ALL must be ready
    if (allReady && playerCount > 0) {
        if (!countdownInterval && !isLocked) {
            startCountdown();
        }
    } else {
        // If someone un-readies AND we haven't reached the point of no return (4s)
        if (countdownInterval && !isLocked) {
            stopCountdown();
        }
    }
}

function startCountdown() {
    console.log("Starting Countdown...");
    timerValue = 10;
    countdownOverlay.innerText = timerValue;
    countdownOverlay.classList.remove('hidden');
    
    countdownInterval = setInterval(() => {
        timerValue--;
        countdownOverlay.innerText = timerValue;

        // POINT OF NO RETURN (4 Seconds)
        if (timerValue === 4) {
            isLocked = true;
            // Hide the ready button area to prevent cancellation
            document.getElementById('ready-area').style.visibility = 'hidden';
            console.log("Lobby Locked!");
        }

        // GO!
        if (timerValue <= 0) {
            clearInterval(countdownInterval);
            launchGame();
        }
    }, 1000);
}

function stopCountdown() {
    console.log("Countdown Cancelled!");
    clearInterval(countdownInterval);
    countdownInterval = null;
    countdownOverlay.classList.add('hidden');
    timerValue = 10;
}

function launchGame() {
    countdownOverlay.innerText = "GO!";
    
    // Save Session Data for the next page
    const sessionData = {
        room: currentRoom,
        id: myPlayerId,
        name: document.getElementById('input-name').value.trim() // Get latest name
    };
    localStorage.setItem('mm_session', JSON.stringify(sessionData));

    // Redirect
    setTimeout(() => {
        window.location.href = "game.html";
    }, 1000);
}
