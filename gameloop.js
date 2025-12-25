import { broadcastData } from "./webrtc.js";
import Player from "./Player/player.js"; // Import the new class

// --- GLOBALS ---
let game;
let myPlayer; // Renamed to distinguish class instance
let cursors, wasd;
let joyStickLeft, joyStickRight;
let otherPlayers = {}; // { id: { container, ... } }

export function initGame() {
    const config = {
        type: Phaser.AUTO,
        scale: { mode: Phaser.Scale.RESIZE, parent: document.body },
        backgroundColor: '#5c8a8a', // Mini Militia Background Color
        fps: { target: 60, forceSetTimeOut: true }, 
        
        // Input Config
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
        // Update Position
        const p = otherPlayers[id];
        p.targetX = data.x;
        p.targetY = data.y;
        
        // Update Look (Arm Rotation & Flip)
        // We access children by index based on creation order in Player.js
        // 0: BackArm, 1: LegL, 2: LegR, 3: Body, 4: Head, 5: FrontArm
        const frontArm = p.list[5]; 
        const backArm = p.list[0];
        const head = p.list[4];

        p.scaleX = data.scaleX; // FLIP
        frontArm.rotation = data.aimAngle;
        backArm.rotation = data.aimAngle;
        head.rotation = data.aimAngle * 0.5; // Simple head sync

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
    // GENERATE TEXTURES (Mini Militia Style)
    const g = this.make.graphics({x:0, y:0, add:false});
    
    // 1. HEAD (Circle)
    g.clear(); g.fillStyle(0xFFCCAA); g.fillCircle(15,15,15); // Skin
    g.fillStyle(0x333333); g.fillCircle(18,12,3); // Eye
    g.generateTexture('head', 30, 30);

    // 2. BODY (Orange Vest)
    g.clear(); g.fillStyle(0xE67E22); 
    g.fillRoundedRect(0,0,26,36, 8);
    g.generateTexture('body', 26, 36);

    // 3. ARM (Skin + Sleeve)
    g.clear(); 
    g.fillStyle(0xE67E22); g.fillCircle(5,5,5); // Sleeve
    g.fillStyle(0xFFCCAA); g.fillRoundedRect(5, 2, 22, 6, 3); // Arm
    g.generateTexture('arm', 30, 10);

    // 4. LEG (Dark Pants)
    g.clear(); g.fillStyle(0x2C3E50); 
    g.fillRoundedRect(0,0,10,18, 4);
    g.fillStyle(0x111111); g.fillRect(0,18,12,6); // Boot
    g.generateTexture('leg', 12, 24);
}

function create() {
    // 1. World
    this.add.grid(0,0,2000,2000,50,50,0x000000).setAlpha(0.1);
    this.physics.world.setBounds(-1000, -1000, 2000, 2000);

    // 2. Player (Using our new Class)
    myPlayer = new Player(this, Math.random()*400, Math.random()*400);
    
    // Camera
    this.cameras.main.startFollow(myPlayer.container);
    this.cameras.main.setZoom(1.2); // Zoom in a bit
    
    // 3. Controls
    cursors = this.input.keyboard.createCursorKeys();
    wasd = this.input.keyboard.addKeys('W,A,S,D');

    createJoysticks(this);
    
    // Resize Handler
    this.scale.on('resize', () => {
        resizeJoysticks(this);
    });
}

function update(time, delta) {
    if(!myPlayer) return;

    // Delegate update logic to the Player Class
    myPlayer.update(joyStickLeft, joyStickRight, cursors, wasd);

    // UI Updates
    const myUi = document.getElementById('my-coords');
    if(myUi) myUi.innerText = `${Math.round(myPlayer.container.x)}, ${Math.round(myPlayer.container.y)}`;

    // Broadcast
    broadcastData(myPlayer.getPositionData());

    // Interpolate Enemies
    Object.values(otherPlayers).forEach(e => {
        e.x = Phaser.Math.Linear(e.x, e.targetX, 0.5);
        e.y = Phaser.Math.Linear(e.y, e.targetY, 0.5);
    });
}

// --- HELPER FUNCTIONS ---

function spawnEnemy(id, x, y) {
    if (!game.scene.scenes[0]) return;
    const scene = game.scene.scenes[0];
    
    // Use the same Player class for enemies, but disable physics control
    const enemy = new Player(scene, x, y);
    enemy.container.body.setImmovable(true); // Don't let physics move it
    
    // Tint enemy to look different
    enemy.body.setTint(0xFF5555); 
    
    otherPlayers[id] = enemy.container;
}

function createJoysticks(scene) {
    joyStickLeft = scene.plugins.get('rexVirtualJoystick').add(scene, {
        x: 100, y: scene.scale.height - 100,
        radius: 60,
        base: scene.add.circle(0, 0, 60, 0x888888).setAlpha(0.3).setDepth(100),
        thumb: scene.add.circle(0, 0, 30, 0xFFFFFF).setAlpha(0.5).setDepth(100),
        dir: '8dir', forceMin: 16
    });

    joyStickRight = scene.plugins.get('rexVirtualJoystick').add(scene, {
        x: scene.scale.width - 100, y: scene.scale.height - 100,
        radius: 60,
        base: scene.add.circle(0, 0, 60, 0x888888).setAlpha(0.3).setDepth(100),
        thumb: scene.add.circle(0, 0, 30, 0xFF0000).setAlpha(0.5).setDepth(100),
        dir: '8dir', forceMin: 16
    });
}

function resizeJoysticks(scene) {
    if(joyStickLeft) { joyStickLeft.x = 100; joyStickLeft.y = scene.scale.height - 100; }
    if(joyStickRight) { joyStickRight.x = scene.scale.width - 100; joyStickRight.y = scene.scale.height - 100; }
}
