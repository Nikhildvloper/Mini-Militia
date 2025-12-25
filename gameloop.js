import { broadcastData } from "./webrtc.js";

let game;
let player;
let cursors, wasd;
let otherPlayers = {}; 
let lastBroadcast = 0;

export function initGame() {
    const config = {
        type: Phaser.AUTO,
        scale: { mode: Phaser.Scale.RESIZE, parent: document.body },
        backgroundColor: '#2c3e50',
        fps: { target: 60, forceSetTimeOut: true }, // Lock to 60 FPS
        physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
        scene: { preload, create, update }
    };
    game = new Phaser.Game(config);
}

export function handleNetworkData(id, data) {
    if (otherPlayers[id]) {
        otherPlayers[id].targetX = data.x;
        otherPlayers[id].targetY = data.y;
    } else {
        spawnEnemy(id, data.x, data.y);
    }
}

export function handlePeerDisconnect(id) {
    if (otherPlayers[id]) {
        otherPlayers[id].destroy();
        delete otherPlayers[id];
    }
}

export function getPlayerPosition() {
    if (player) return { x: Math.round(player.x), y: Math.round(player.y) };
    return null;
}

function preload() {
    const g = this.make.graphics({x:0, y:0, add:false});
    g.fillStyle(0x3498db); g.fillRect(0,0,32,32); g.generateTexture('me', 32, 32);
    g.fillStyle(0xe74c3c); g.fillRect(0,0,32,32); g.generateTexture('enemy', 32, 32);
}

function create() {
    const self = this;
    this.add.grid(0,0,2000,2000,50,50,0x000000).setAlpha(0.2);
    this.physics.world.setBounds(-1000, -1000, 2000, 2000);

    player = this.physics.add.sprite(Math.random()*400, Math.random()*400, 'me');
    player.setCollideWorldBounds(true);
    
    this.cameras.main.startFollow(player);
    cursors = this.input.keyboard.createCursorKeys();
    wasd = this.input.keyboard.addKeys('W,A,S,D');
}

function update(time, delta) {
    if(!player) return;

    let ax=0, ay=0; const speed=600;
    if (cursors.left.isDown || wasd.A.isDown) ax=-speed;
    else if (cursors.right.isDown || wasd.D.isDown) ax=speed;
    if (cursors.up.isDown || wasd.W.isDown) ay=-speed;
    else if (cursors.down.isDown || wasd.S.isDown) ay=speed;
    player.setVelocity(ax, ay);

    // Update Coords UI
    const myUi = document.getElementById('my-coords');
    if(myUi) myUi.innerText = `${Math.round(player.x)}, ${Math.round(player.y)}`;

    // --- NETWORK THROTTLE (30 Updates per second) ---
    // Increased from 20 to 30 for smoother movement
    if (time > lastBroadcast + 30) { 
        broadcastData({ x: Math.round(player.x), y: Math.round(player.y) });
        lastBroadcast = time;
    }

    // --- MOVEMENT FIX: FASTER LERP ---
    // Changed 0.2 to 0.5 for snappier movement (less laggy trail)
    Object.values(otherPlayers).forEach(e => {
        e.x = Phaser.Math.Linear(e.x, e.targetX, 0.5);
        e.y = Phaser.Math.Linear(e.y, e.targetY, 0.5);
    });
}

function spawnEnemy(id, x, y) {
    if (!game.scene.scenes[0]) return;
    const scene = game.scene.scenes[0];
    const enemy = scene.physics.add.sprite(x, y, 'enemy');
    enemy.targetX = x;
    enemy.targetY = y;
    otherPlayers[id] = enemy;
}
