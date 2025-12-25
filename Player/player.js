export default class Player {
    constructor(scene, x, y) {
        this.scene = scene;

        // 1. CONTAINER (Holds everything)
        this.container = scene.add.container(x, y);
        this.container.setSize(40, 60);
        scene.physics.world.enable(this.container);
        this.container.body.setCollideWorldBounds(true);
        this.container.body.setDrag(800); 

        // 2. CREATE PARTS (Exact order from your snippet)

        // LAYER 1: BACK ARM (Offset: 40, -25)
        this.backArm = scene.add.sprite(15, -10, 'arm'); // Adjusted offset for Phaser scale
        this.backArm.setOrigin(0, 0.5); 
        this.backArm.setTint(0xCCCCCC); 
        this.container.add(this.backArm);

        // LAYER 2: LEGS (Offsets: -15 and 50)
        this.legLeft = scene.add.sprite(-8, 15, 'leg');
        this.legLeft.setOrigin(0.5, 0); 
        this.container.add(this.legLeft);

        this.legRight = scene.add.sprite(8, 15, 'leg');
        this.legRight.setOrigin(0.5, 0); 
        this.container.add(this.legRight);

        // LAYER 3: BODY
        this.body = scene.add.sprite(0, 0, 'body');
        this.body.setOrigin(0.5, 0.5);
        this.container.add(this.body);

        // LAYER 4: HEAD (Offset: 0, -70)
        this.head = scene.add.sprite(0, -25, 'head'); // Phaser units are different, scaled down from -70
        this.head.setOrigin(0.5, 0.9);
        this.container.add(this.head);

        // LAYER 5: FRONT ARM (Offset: -40, -25)
        this.frontArm = scene.add.sprite(15, -10, 'arm');
        this.frontArm.setOrigin(0, 0.5); 
        this.container.add(this.frontArm);
    }

    update(joyStickLeft, joyStickRight, cursors, wasd) {
        if (!this.container.body) return;

        // --- 1. MOVEMENT LOGIC (Exact same structure) ---
        const speed = 400;
        let moveX = 0;
        let moveY = 0;
        let activeMove = false;

        // Joystick Input
        if (joyStickLeft && joyStickLeft.force > 0) {
            moveX = Math.cos(joyStickLeft.rotation);
            moveY = Math.sin(joyStickLeft.rotation);
            activeMove = true;
        } 
        // Keyboard Input (Fallback)
        else {
            if (cursors.left.isDown || wasd.A.isDown) { moveX = -1; activeMove = true; }
            else if (cursors.right.isDown || wasd.D.isDown) { moveX = 1; activeMove = true; }
            
            if (cursors.up.isDown || wasd.W.isDown) { moveY = -1; activeMove = true; }
            else if (cursors.down.isDown || wasd.S.isDown) { moveY = 1; activeMove = true; }
        }

        // Apply Velocity
        this.container.body.setVelocity(moveX * speed, moveY * speed);

        // --- 2. LEG ANIMATION (Your Exact Math) ---
        if (activeMove) {
            const time = Date.now() / 100;
            this.legLeft.rotation = Math.sin(time) * 0.4;
            this.legRight.rotation = Math.cos(time) * 0.4;
        } else {
            this.legLeft.rotation = 0;
            this.legRight.rotation = 0;
        }

        // --- 3. AIMING LOGIC (Your Exact Math) ---
        let angle = 0;
        let aimActive = false;

        // Use Right Joystick for Aim
        if (joyStickRight && joyStickRight.force > 0) {
            angle = joyStickRight.rotation;
            aimActive = true;
        } 
        // Fallback: Use Movement Direction if no aim
        else if (activeMove) {
            angle = Math.atan2(moveY, moveX);
            aimActive = true;
        }

        if (aimActive) {
            // Your Logic: Check if angle is between 90 (PI/2) and 270 (-PI/2 in Phaser)
            // Phaser rotation goes from -PI to PI.
            // Left side is when absolute value of angle > PI/2
            const isLookingLeft = Math.abs(angle) > Math.PI / 2;

            if (isLookingLeft) {
                // --- FACE LEFT ---
                this.container.scaleX = -1; // Flip Player

                // Logic: rotation = angle - PI
                let correctRot = angle - Math.PI;
                // Normalize
                if (correctRot < -Math.PI) correctRot += Math.PI * 2;
                if (correctRot > Math.PI) correctRot -= Math.PI * 2;

                this.frontArm.rotation = correctRot;
                this.backArm.rotation = correctRot;
                
                // Head Clamp
                this.head.rotation = Math.max(-0.5, Math.min(0.5, correctRot * 0.5));

            } else {
                // --- FACE RIGHT ---
                this.container.scaleX = 1; // Normal

                let correctRot = angle;
                
                this.frontArm.rotation = correctRot;
                this.backArm.rotation = correctRot;

                // Head Clamp
                this.head.rotation = Math.max(-0.5, Math.min(0.5, correctRot * 0.5));
            }
        }
    }

    // --- NETWORK HELPERS ---
    getPositionData() {
        return {
            x: Math.round(this.container.x),
            y: Math.round(this.container.y),
            aimAngle: this.frontArm.rotation,
            scaleX: this.container.scaleX,
            legRot: this.legLeft.rotation // Sync leg anim for smoothness
        };
    }

    destroy() {
        this.container.destroy();
    }
}
