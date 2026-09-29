'use strict';
// InputSystem: held keys, pointer-lock mouse look and key presses routed to the game.

class InputSystem {
    constructor(game, canvas) {
        this.game = game;
        this.canvas = canvas;
        this.keys = new Set();
    }

    attach() {
        const canvas = this.canvas;
        canvas.addEventListener('click', () => canvas.requestPointerLock?.());
        document.addEventListener('mousemove', e => {
            const p = this.game.player;
            if (document.pointerLockElement !== canvas || !p) return;
            const s = p.cfg.mouseSensitivity;
            p.cam.look(e.movementX * s, e.movementY * s);
        });
        document.addEventListener('keydown', e => {
            this.keys.add(e.code);
            if (this.game.world) this.game.onKey(e.code);
        });
        document.addEventListener('keyup', e => this.keys.delete(e.code));
        window.addEventListener('blur', () => this.keys.clear());
    }
}
