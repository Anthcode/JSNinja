// ==== SPRITE ANIMATOR ====
// Generyczny, data-driven system animacji sprite'ów (spritesheet: siatka
// wierszy=stany animacji, kolumny=klatki).
//
// Użycie (plain <script>, bez modułów/bundlera):
//   <script src="spriteAnimator.js"></script>
//   const animator = new AnimatorController(CHARACTER_ANIM_DATA);
//   // w pętli gry:
//   animator.update(deltaTime); // deltaTime w ms
//   animator.play('run');       // przełącz stan
//   const frame = animator.getCurrentFrame();
//   ctx.drawImage(frame.sheet, frame.sx, frame.sy, frame.sWidth, frame.sHeight, x, y, w, h);

if (typeof window.AnimatorController === 'undefined') {

class AnimatorController {
    constructor(animData) {
        this.frameWidth = animData.frameWidth;
        this.frameHeight = animData.frameHeight;
        this.states = animData.states;

        this.sheets = animData.sheets.map(sheet => {
            if (typeof sheet === 'string') {
                const img = new Image();
                img.src = sheet;
                return img;
            }
            return sheet;
        });

        this.currentSheet = this.pickSheet();
        this.currentState = animData.initialState;
        this.currentFrame = this.states[this.currentState].startFrame || 0;
        this.frameTimer = 0;
        this.finished = false;
    }

    pickSheet() {
        return this.sheets[Math.floor(Math.random() * this.sheets.length)];
    }

    play(name, { force = false } = {}) {
        const nextState = this.states[name];
        if (!nextState) {
            console.warn(`AnimatorController: nieznany stan animacji "${name}"`);
            return;
        }
        if (this.currentState === name) return;

        const current = this.states[this.currentState];
        if (!force && current && current.locked && !this.finished) return;

        this.currentState = name;
        this.currentFrame = nextState.startFrame || 0;
        this.frameTimer = 0;
        this.finished = false;
    }

    update(deltaTime) {
        const state = this.states[this.currentState];
        if (!state) return;

        this.frameTimer += deltaTime;

        if (this.frameTimer >= state.frameInterval) {
            this.frameTimer -= state.frameInterval;
            this.currentFrame++;

            if (this.currentFrame >= state.frameCount) {
                if (state.loop) {
                    this.currentFrame = 0;
                } else {
                    this.currentFrame = state.frameCount - 1;
                    this.finished = true;

                    if (state.next) {
                        this.play(state.next, { force: true });
                    }
                }
            }
        }
    }

    getCurrentFrame() {
        const state = this.states[this.currentState];
        return {
            sheet: this.currentSheet,
            sx: this.currentFrame * this.frameWidth,
            sy: state.row * this.frameHeight,
            sWidth: this.frameWidth,
            sHeight: this.frameHeight
        };
    }

    reset(initialState) {
        this.currentSheet = this.pickSheet();
        this.currentState = initialState || this.currentState;
        this.currentFrame = this.states[this.currentState].startFrame || 0;
        this.frameTimer = 0;
        this.finished = false;
    }
}

// Opisuje układ layers/character.png: 1500x900px, siatka 10 kolumn x 6
// wierszy, 150x150px/klatkę.
const CHARACTER_ANIM_DATA = {
    sheets: [
        'layers/character.png',
    ],
    frameWidth: 150,
    frameHeight: 150,
    states: {
        idle:         { row: 0, frameCount: 10, frameInterval: 50, startFrame: 0, loop: true,  locked: false, next: null },
        'move-left':  { row: 1, frameCount: 10, frameInterval: 50, startFrame: 0, loop: true,  locked: false, next: null },
        'move-right': { row: 2, frameCount: 10, frameInterval: 50, startFrame: 0, loop: true,  locked: false, next: null },
        jump:         { row: 3, frameCount: 10, frameInterval: 50, startFrame: 0, loop: true,  locked: false, next: null },
        hit:          { row: 4, frameCount: 6,  frameInterval: 60, startFrame: 0, loop: false, locked: true,  next: 'idle' },
        death:        { row: 5, frameCount: 10, frameInterval: 90, startFrame: 0, loop: false, locked: true,  next: null }
    },
    initialState: 'idle'
};

window.AnimatorController = AnimatorController;
window.CHARACTER_ANIM_DATA = CHARACTER_ANIM_DATA;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AnimatorController, CHARACTER_ANIM_DATA };
}

}
