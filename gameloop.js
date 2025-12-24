import { broadcastData } from "./webrtc.js";

// --- GLOBAL STATE ---
let game;
let player;
let cursors, wasd;
let otherPlayers = {}; // Stores Enemy Sprites { id: sprite }
let myCoordsText = null;

// --- EXPORTED FUNCTIONS ---

export function initGame() {
    const config = {
        type: Phaser.AUTO,
        scale: { mode: Phaser.Scale.RESIZE, parent: document.body },
        backgroundColor: '#2c3e50',
        physics: { 
            default: 'arcade', 
            arcade: { gravity: { y: 0 }, debug: false } 
        },
        scene: { preload, create, update }
    };
    game = new Phaser.Game(config);
}

// Called by Network when data arrives
export function handleNetworkData(id, data) {
    if (otherPlayers[id]) {
        // Update existing enemy target
        otherPlayers[id].targetX = data.x;
        otherPlayers[id].targetY = data.y;
        
        // Update UI (optional direct DOM manipulation)
        const enemyUi = document.getElementById('enemy-coords');
        if(enemyUi) {
            enemyUi.innerText = `${data.x}, ${data.y}`;
            enemyUi.className = "green";
        }
    } else {
        // Spawn new enemy
        spawnEnemy(id, data.x, data.y);
    }
}

// Called by Network when a peer disconnects
export function handlePeerDisconnect(id) {
    if (otherPlayers[id]) {
        otherPlayers[id].destroy();
        delete otherPlayers[id];
    }
    const enemyUi = document.getElementById('enemy-coords');
    if(enemyUi) {
        enemyUi.innerText = "WAITING...";
        enemyUi.className = "red";
    }
}

// Helper to get my current position (for initial sync)
export function getPlayerPosition() {
    if (player) return { x: Math.round(player.x), y: Math.round(player.y) };
    return null;
}

// --- INTERNAL PHASER LOGIC ---

function preload() {
    const g = this.make.graphics({x:0, y:0, add:false});
    
    // Player Texture (Blue)
    g.fillStyle(0x3498db); g.fillRect(0,0,32,32); g.generateTexture('me', 32, 32);
    
    // Enemy Texture (Red)
    g.fillStyle(0xe74c3c); g.fillRect(0,0,32,32); g.generateTexture('enemy', 32, 32);
}

function create() {
    const self = this;
    
    // 1. World Setup
    this.add.grid(0,0,2000,2000,50,50,0x000000).setAlpha(0.2);
    this.physics.world.setBounds(-1000, -1000, 2000, 2000);

    // 2. Player Setup
    player = this.physics.add.sprite(Math.random()*400, Math.random()*400, 'me');
    player.setCollideWorldBounds(true);
    
    // 3. Camera
    this.cameras.main.startFollow(player);
    
    // 4. Controls
    cursors = this.input.keyboard.createCursorKeys();
    wasd = this.input.keyboard.addKeys('W,A,S,D');
}

function update() {
    if(!player) return;

    // 1. Movement Logic
    let ax = 0; let ay = 0; const speed = 600;
    
    if (cursors.left.isDown || wasd.A.isDown) ax = -speed;
    else if (cursors.right.isDown || wasd.D.isDown) ax = speed;
    
    if (cursors.up.isDown || wasd.W.isDown) ay = -speed;
    else if (cursors.down.isDown || wasd.S.isDown) ay = speed;
    
    player.setVelocity(ax, ay);

    // 2. Update UI
    const myUi = document.getElementById('my-coords');
    if(myUi) myUi.innerText = `${Math.round(player.x)}, ${Math.round(player.y)}`;

    // 3. Network Broadcast (Send my position)
    broadcastData({ x: Math.round(player.x), y: Math.round(player.y) });

    // 4. Enemy Interpolation (Smooth movement)
    Object.values(otherPlayers).forEach(enemy => {
        // Linear Interpolation (Lerp) 20% towards target per frame
        enemy.x = Phaser.Math.Linear(enemy.x, enemy.targetX, 0.2);
        enemy.y = Phaser.Math.Linear(enemy.y, enemy.targetY, 0.2);
    });
}

// Internal Helper
function spawnEnemy(id, x, y) {
    if (!game.scene.scenes[0]) return; // Safety check
    const scene = game.scene.scenes[0];
    
    const enemy = scene.physics.add.sprite(x, y, 'enemy');
    enemy.targetX = x;
    enemy.targetY = y;
    otherPlayers[id] = enemy;
}
