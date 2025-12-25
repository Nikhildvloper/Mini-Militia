import { broadcastData } from "./webrtc.js";
import Player from "./Player/player.js"; 

// --- GLOBALS ---
let game;
let myPlayer; 
let cursors, wasd;
let joyStickLeft, joyStickRight;
let otherPlayers = {}; 

export function initGame() {
    const config = {
        type: Phaser.AUTO,
        scale: { mode: Phaser.Scale.RESIZE, parent: document.body },
        backgroundColor: '#5c8a8a', 
        fps: { target: 60, forceSetTimeOut: true }, 
        input: { activePointers: 3 }, 
        
        physics: { 
            default: 'arcade', 
            arcade: { gravity: { y: 0 }, debug: false } 
        },

        plugins: {
            global: [{
                key: 'rexVirtualJoystick',
                plugin: window.rexvirtualjoystickplugin,
                start: true
            }]
        },

        scene: { preload, create, update }
    };
    game = new Phaser.Game(config);
}

// --- NETWORK HANDLERS ---
export function handleNetworkData(id, data) {
    if (otherPlayers[id]) {
        const p = otherPlayers[id];
        
        // Sync Position
        p.targetX = data.x;
        p.targetY = data.y;
        
        // Sync Visuals (Flip & Rotation)
        if (p.list && p.list.length >= 6) {
            // 0:BackArm, 1:LegL, 2:LegR, 3:Body, 4:Head, 5:FrontArm
            p.scaleX = data.scaleX; 
            
            p.list[5].rotation = data.aimAngle; // Front Arm
            p.list[0].rotation = data.aimAngle; // Back Arm
            p.list[4].rotation = data.aimAngle * 0.5; // Head

            // Sync Legs (Optional visual polish)
            if (data.legRot !== undefined) {
                p.list[1].rotation = data.legRot;
                p.list[2].rotation = Math.cos(Math.asin(data.legRot || 0)); // Approx opposite
            }
        }
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
    if (myPlayer) return myPlayer.getPositionData();
    return null;
}

// --- PHASER SCENE ---

function preload() {
    // Load your exact assets
    this.load.image('head', './Player/head.png');
    this.load.image('body', './Player/body.png');
    this.load.image('arm',  './Player/arm.png');
    this.load.image('leg',  './Player/leg.png');
}

function create() {
    this.add.grid(0,0,2000,2000,50,50,0x000000).setAlpha(0.1);
    this.physics.world.setBounds(-1000, -1000, 2000, 2000);

    // Create Local Player
    myPlayer = new Player(this, Math.random()*400, Math.random()*400);
    
    this.cameras.main.startFollow(myPlayer.container);
    this.cameras.main.setZoom(1.0); 
    
    cursors = this.input.keyboard.createCursorKeys();
    wasd = this.input.keyboard.addKeys('W,A,S,D');

    createJoysticks(this);
    
    this.scale.on('resize', () => resizeJoysticks(this));
}

function update(time, delta) {
    if(!myPlayer) return;

    // Pass controls to Player Class
    myPlayer.update(joyStickLeft, joyStickRight, cursors, wasd);

    // UI & Broadcast
    const myUi = document.getElementById('my-coords');
    if(myUi) myUi.innerText = `${Math.round(myPlayer.container.x)}, ${Math.round(myPlayer.container.y)}`;

    broadcastData(myPlayer.getPositionData());

    // Interpolation for Enemies
    Object.values(otherPlayers).forEach(e => {
        e.x = Phaser.Math.Linear(e.x, e.targetX, 0.5);
        e.y = Phaser.Math.Linear(e.y, e.targetY, 0.5);
    });
}

function spawnEnemy(id, x, y) {
    if (!game.scene.scenes[0]) return;
    const scene = game.scene.scenes[0];
    
    const enemy = new Player(scene, x, y);
    enemy.container.body.setImmovable(true); 
    
    // Tint parts red manually
    enemy.body.setTint(0xFF5555);
    enemy.frontArm.setTint(0xFF5555);
    enemy.backArm.setTint(0xCC4444);
    
    otherPlayers[id] = enemy.container;
}

function createJoysticks(scene) {
    if (!scene.plugins.get('rexVirtualJoystick')) return;

    joyStickLeft = scene.plugins.get('rexVirtualJoystick').add(scene, {
        x: 100, y: scene.scale.height - 100,
        radius: 70,
        base: scene.add.circle(0, 0, 70, 0x888888).setAlpha(0.3).setDepth(100),
        thumb: scene.add.circle(0, 0, 35, 0xFFFFFF).setAlpha(0.5).setDepth(100),
        dir: '8dir', forceMin: 16
    });

    joyStickRight = scene.plugins.get('rexVirtualJoystick').add(scene, {
        x: scene.scale.width - 100, y: scene.scale.height - 100,
        radius: 70,
        base: scene.add.circle(0, 0, 70, 0x888888).setAlpha(0.3).setDepth(100),
        thumb: scene.add.circle(0, 0, 35, 0xFF0000).setAlpha(0.5).setDepth(100),
        dir: '8dir', forceMin: 16
    });
}

function resizeJoysticks(scene) {
    if(joyStickLeft) { joyStickLeft.x = 100; joyStickLeft.y = scene.scale.height - 100; }
    if(joyStickRight) { joyStickRight.x = scene.scale.width - 100; joyStickRight.y = scene.scale.height - 100; }
}
