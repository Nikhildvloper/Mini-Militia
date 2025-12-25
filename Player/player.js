export default class Player {
    constructor(scene, x, y, textureKey = 'man') {
        this.scene = scene;

        // 1. CONTAINER (Holds all parts together)
        this.container = scene.add.container(x, y);
        this.container.setSize(40, 60);
        scene.physics.world.enable(this.container);
        this.container.body.setCollideWorldBounds(true);
        this.container.body.setDrag(800); // Stop smoothly

        // 2. CREATE PARTS (Order matters for Z-index!)
        
        // A. Back Arm (Behind body)
        this.backArm = scene.add.sprite(15, -5, 'arm');
        this.backArm.setOrigin(0, 0.5); // Pivot at shoulder
        this.backArm.setTint(0x999999); // Darker to show depth
        this.container.add(this.backArm);

        // B. Legs
        this.legLeft = scene.add.sprite(-8, 20, 'leg');
        this.legLeft.setOrigin(0.5, 0); // Pivot at hip
        this.container.add(this.legLeft);

        this.legRight = scene.add.sprite(8, 20, 'leg');
        this.legRight.setOrigin(0.5, 0);
        this.container.add(this.legRight);

        // C. Body
        this.body = scene.add.sprite(0, 0, 'body');
        this.container.add(this.body);

        // D. Head
        this.head = scene.add.sprite(0, -22, 'head');
        this.head.setOrigin(0.5, 0.8); // Pivot at neck
        this.container.add(this.head);

        // E. Front Arm (In front of body)
        this.frontArm = scene.add.sprite(15, -5, 'arm');
        this.frontArm.setOrigin(0, 0.5); // Pivot at shoulder
        this.container.add(this.frontArm);
        
        // State
        this.isMoving = false;
    }

    update(joyStickLeft, joyStickRight, cursors, wasd) {
        if (!this.container.body) return; // Safety check

        const speed = 400;
        let vx = 0;
        let vy = 0;

        // --- 1. MOVEMENT INPUT ---
        // Combine Joystick + Keyboard
        const joyCursors = joyStickLeft ? joyStickLeft.createCursorKeys() : null;

        if (cursors.left.isDown || wasd.A.isDown || (joyCursors && joyCursors.left.isDown)) vx = -speed;
        else if (cursors.right.isDown || wasd.D.isDown || (joyCursors && joyCursors.right.isDown)) vx = speed;

        if (cursors.up.isDown || wasd.W.isDown || (joyCursors && joyCursors.up.isDown)) vy = -speed;
        else if (cursors.down.isDown || wasd.S.isDown || (joyCursors && joyCursors.down.isDown)) vy = speed;
        
        // Joystick Analog Precision (if available)
        if (joyStickLeft && joyStickLeft.force > 0) {
            vx = Math.cos(joyStickLeft.rotation) * speed;
            vy = Math.sin(joyStickLeft.rotation) * speed;
        }

        this.container.body.setVelocity(vx, vy);
        this.isMoving = (Math.abs(vx) > 10 || Math.abs(vy) > 10);

        // --- 2. LEG ANIMATION ---
        if (this.isMoving) {
            const time = this.scene.time.now;
            this.legLeft.rotation = Math.sin(time / 100) * 0.5;
            this.legRight.rotation = Math.cos(time / 100) * 0.5;
        } else {
            this.legLeft.rotation = 0;
            this.legRight.rotation = 0;
        }

        // --- 3. AIMING LOGIC (The "Perfect Aim") ---
        let angle = 0;
        let activeAim = false;

        // Check Input Source
        if (joyStickRight && joyStickRight.force > 0) {
            angle = joyStickRight.rotation;
            activeAim = true;
        } else if (vx !== 0 || vy !== 0) {
            // If not aiming, look where moving
            angle = Math.atan2(vy, vx);
            activeAim = true;
        }

        if (activeAim) {
            // Phaser Rotation is -PI to PI
            // Left Side is when angle is > 90 deg (PI/2) or < -90 deg (-PI/2)
            const isLookingLeft = Math.abs(angle) > Math.PI / 2;

            if (isLookingLeft) {
                // --- FACE LEFT ---
                this.container.scaleX = -1; // Flip entire rig

                // Math: We need to mirror the angle because the container is flipped.
                // If aiming left (PI), we want the arm at 0 relative to the flipped body.
                // Formula: PI - angle (or -PI - angle depending on sign) -> Math.atan2(sin, -cos) shortcut?
                // Simplest way for Phaser flipped container:
                // Rotation = PI - Angle
                
                let localRotation = Math.PI - angle;
                // Normalize to -PI to PI
                while (localRotation > Math.PI) localRotation -= Math.PI * 2;
                while (localRotation < -Math.PI) localRotation += Math.PI * 2;

                this.frontArm.rotation = localRotation;
                this.backArm.rotation = localRotation;
                
                // Head looks slightly up/down but clamp it so it doesn't break neck
                this.head.rotation = Phaser.Math.Clamp(localRotation * 0.5, -0.5, 0.5);

            } else {
                // --- FACE RIGHT ---
                this.container.scaleX = 1; // Normal

                this.frontArm.rotation = angle;
                this.backArm.rotation = angle;
                
                // Head Rotation
                this.head.rotation = Phaser.Math.Clamp(angle * 0.5, -0.5, 0.5);
            }
        }
    }

    // --- GETTERS FOR NETWORK ---
    getPositionData() {
        return {
            x: Math.round(this.container.x),
            y: Math.round(this.container.y),
            aimAngle: this.frontArm.rotation, // Send arm rotation
            scaleX: this.container.scaleX     // Send flip direction
        };
    }

    destroy() {
        this.container.destroy();
    }
}
