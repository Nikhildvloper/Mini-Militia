import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, onValue, update, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// --- 1. SETUP FIREBASE ---
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

// --- 2. GET USER DATA ---
const sessionRaw = localStorage.getItem('mm_session');
if (!sessionRaw) {
    window.location.href = "index.html";
}
const session = JSON.parse(sessionRaw);
const ROOM_ID = session.room;
const MY_ID = session.id;

// --- 3. PHASER CONFIGURATION ---
const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#2c3e50', // Dark Space Blue
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 }, // ZERO GRAVITY
            debug: false
        }
    },
    scene: { preload, create, update }
};

const game = new Phaser.Game(config);

// GLOBAL VARIABLES
let player;
let cursors;
let otherPlayers = {}; 
let wasd; // Added WASD keys support

// --- SCENE: PRELOAD ---
function preload() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });

    // Draw Soldier (Green Box)
    g.fillStyle(0x4CAF50);
    g.fillRect(0, 0, 32, 32); // Made it square for zero-g feel
    g.fillStyle(0x000000); 
    g.fillRect(20, 10, 8, 8); // Eyes
    g.generateTexture('soldier', 32, 32);

    // Draw Enemy (Red Box)
    g.clear();
    g.fillStyle(0xE74C3C);
    g.fillRect(0, 0, 32, 32);
    g.generateTexture('enemy', 32, 32);
}

// --- SCENE: CREATE ---
function create() {
    const self = this;

    // 1. CREATE WORLD BOUNDS
    this.physics.world.setBounds(0, 0, 1600, 1200); // Larger map
    
    // Grid background to see movement better
    this.add.grid(800, 600, 1600, 1200, 64, 64, 0x000000, 0, 0xffffff, 0.1);

    // 2. CREATE MY PLAYER
    player = this.physics.add.sprite(400, 300, 'soldier');
    player.setCollideWorldBounds(true);
    
    // ZERO G PHYSICS TWEAKS
    player.setDrag(100);     // Air resistance (Slows down when key released)
    player.setAngularDrag(100); 
    player.setMaxVelocity(300); // Speed cap

    // Camera Follow
    this.cameras.main.startFollow(player);
    this.cameras.main.setZoom(1);

    // Controls (Arrow Keys + WASD)
    cursors = this.input.keyboard.createCursorKeys();
    wasd = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D
    });

    // 3. MULTIPLAYER: LISTEN FOR OTHERS
    const playersRef = ref(db, 'rooms/' + ROOM_ID + '/players');
    
    onValue(playersRef, (snapshot) => {
        const playersData = snapshot.val();
        if (!playersData) return;

        Object.keys(playersData).forEach((key) => {
            if (key === MY_ID) return;

            const pData = playersData[key];

            if (otherPlayers[key]) {
                // Update Enemy
                otherPlayers[key].targetX = pData.x;
                otherPlayers[key].targetY = pData.y;
            } else {
                // Create New Enemy
                const enemy = self.add.sprite(pData.x, pData.y, 'enemy');
                enemy.targetX = pData.x;
                enemy.targetY = pData.y;
                otherPlayers[key] = enemy;
            }
        });

        // Cleanup disconnected
        Object.keys(otherPlayers).forEach((key) => {
            if (!playersData[key]) {
                otherPlayers[key].destroy();
                delete otherPlayers[key];
            }
        });
    });

    // 4. HANDLE DISCONNECT
    const myRef = ref(db, 'rooms/' + ROOM_ID + '/players/' + MY_ID);
    onDisconnect(myRef).remove();

    document.getElementById('btn-exit').addEventListener('click', () => {
        remove(myRef).then(() => {
            window.location.href = "index.html";
        });
    });
}

// --- SCENE: UPDATE ---
function update() {
    if (!player) return;

    // 1. MOVEMENT LOGIC (Zero Gravity)
    // We apply ACCELERATION instead of setting velocity directly
    // This makes it feel like a thruster
    
    // Horizontal
    if (cursors.left.isDown || wasd.left.isDown) {
        player.setAccelerationX(-300);
        player.flipX = true; 
    } else if (cursors.right.isDown || wasd.right.isDown) {
        player.setAccelerationX(300);
        player.flipX = false;
    } else {
        player.setAccelerationX(0); // Drag will take over
    }

    // Vertical (Since no gravity, we use Up/Down keys)
    if (cursors.up.isDown || wasd.up.isDown) {
        player.setAccelerationY(-300);
    } else if (cursors.down.isDown || wasd.down.isDown) {
        player.setAccelerationY(300);
    } else {
        player.setAccelerationY(0); // Drag will take over
    }

    // 2. SYNC TO SERVER
    const myRef = ref(db, 'rooms/' + ROOM_ID + '/players/' + MY_ID);
    
    update(myRef, {
        x: Math.round(player.x),
        y: Math.round(player.y)
    });

    // 3. INTERPOLATE ENEMIES
    Object.keys(otherPlayers).forEach((key) => {
        const enemy = otherPlayers[key];
        enemy.x = Phaser.Math.Linear(enemy.x, enemy.targetX, 0.1);
        enemy.y = Phaser.Math.Linear(enemy.y, enemy.targetY, 0.1);
    });
      }
                            
