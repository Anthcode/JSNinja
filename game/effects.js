// ==== SYSTEM EFEKTÓW WIZUALNYCH ====
// Samodzielny moduł "juice" dla gry: cząsteczki, screen shake, hit-stop,
// slow-motion, pływające napisy, fale uderzeniowe, ambient (liście,
// świetliki, mgła, promienie światła), winieta i rozbłyski ekranu.
//
// Filozofia wydajności (cel: stałe 60 fps):
//  - pula cząsteczek o stałym rozmiarze — zero alokacji w pętli gry,
//  - sprite'y cząsteczek prerenderowane raz do offscreen canvas
//    (żadnego shadowBlur / gradientu liczonego co klatkę),
//  - winieta, promienie światła i mgła prerenderowane przy resize,
//  - rysowanie wyłącznie przez drawImage + globalAlpha.
//
// Użycie (plain <script>, bez modułów):
//   const fx = new FXSystem();
//   fx.resize(w, h);
//   const dt = fx.tick(rawDt);            // dt przeskalowany hit-stopem/slow-mo
//   fx.update(dt, { w, h, gameSpeed, groundY, playing });
//   // rysowanie (kolejność warstw):
//   ctx.translate(fx.shakeX, fx.shakeY);  // świat trzęsie się, HUD nie
//   fx.drawAmbient(ctx, groundY);         // za graczem: promienie, liście, świetliki
//   /* ...wrogowie, gracz... */
//   fx.drawEffects(ctx);                  // przed graczem: kurz, iskry, popupy
//   /* ...pierwszy plan... */
//   fx.drawOverlay(ctx);                  // pełny ekran: mgła, smugi, winieta, flash

if (typeof window.FXSystem === 'undefined') {

// --- Prerenderowane sprite'y ---------------------------------------------

// Miękka, świecąca kropka (radial gradient) — baza dla kurzu, iskier, glow.
function makeGlowSprite(size, r, g, b, innerAlpha) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${r},${g},${b},${innerAlpha})`);
    grad.addColorStop(0.4, `rgba(${r},${g},${b},${innerAlpha * 0.5})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return c;
}

// Listek — mała elipsa z żyłką, w danym kolorze.
function makeLeafSprite(fill, vein) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 10;
    const ctx = c.getContext('2d');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(8, 5, 7, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = vein;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(2, 5); ctx.lineTo(14, 5); ctx.stroke();
    return c;
}

// --- Typy cząsteczek (indeksy do tablicy sprite'ów) -----------------------
const P_DUST = 0;    // kurz spod stóp / lądowanie
const P_SPARK = 1;   // złote iskry przy pokonaniu wroga
const P_LEAF = 2;    // liście lecące przez ekran
const P_WISP = 3;    // zimna poświata za duchami
const P_EMBER = 4;   // drobinki po trafieniu gracza (czerwone)
const P_STREAK = 5;  // poziome smugi prędkości (rysowane jako linie)
const P_PUFF = 6;    // biały obłoczek skoku

const MAX_PARTICLES = 512;
const MAX_POPUPS = 16;
const MAX_RINGS = 8;

class FXSystem {
    constructor() {
        // Kamera: trauma → shake (kwadratowo, żeby małe uderzenia były subtelne).
        this.trauma = 0;
        this.shakeX = 0;
        this.shakeY = 0;
        this.hitStop = 0;      // s zamrożenia świata
        this.slowMo = 0;       // s pozostałego slow-motion
        this.slowMoScale = 1;  // docelowa skala czasu podczas slow-mo
        this.timeScale = 1;

        // Rozbłysk pełnoekranowy (trafienie / stomp).
        this.flashAlpha = 0;
        this.flashColor = '231, 76, 60';

        this.w = 0;
        this.h = 0;
        this.t = 0;           // własny zegar (s) do animacji ambientu
        this.gameSpeed = 40;

        // Adaptacyjna jakość: 2 = pełna, 1 = bez promieni światła + mgła
        // w jednej wstędze, 0 = bez promieni i mgły. Gra startuje z pełną
        // jakością i degraduje ją tylko wtedy, gdy klatki realnie nie wyrabiają
        // (średnia EMA czasu klatki powyżej progu przez dłuższą chwilę).
        this.quality = 2;
        this.frameMsEma = 16.7;
        this.slowStreak = 0;
        this.warmupFrames = 90; // pomijamy rozgrzewkę (kompilacja JIT, cache)

        // Pula cząsteczek — wszystkie pola płaskie, żadnych obiektów w środku.
        this.particles = [];
        for (let i = 0; i < MAX_PARTICLES; i++) {
            this.particles.push({
                active: false, type: P_DUST, x: 0, y: 0, vx: 0, vy: 0,
                life: 0, maxLife: 1, size: 8, rot: 0, vr: 0,
                grav: 0, drag: 1, sway: 0, spriteIdx: 0,
            });
        }
        this.cursor = 0;

        this.popups = [];
        for (let i = 0; i < MAX_POPUPS; i++) {
            this.popups.push({ active: false, x: 0, y: 0, life: 0, maxLife: 1, text: '', color: '#fff', size: 22 });
        }

        this.rings = [];
        for (let i = 0; i < MAX_RINGS; i++) {
            this.rings.push({ active: false, x: 0, y: 0, r: 0, vr: 0, life: 0, maxLife: 1, color: '255,214,112' });
        }

        // Świetliki — stała liczba, wędrują sinusoidalnie przy ziemi.
        this.fireflies = [];
        for (let i = 0; i < 12; i++) {
            this.fireflies.push({
                x: Math.random(), y: Math.random(),       // znormalizowane (0..1)
                phase: Math.random() * Math.PI * 2,
                speed: 0.4 + Math.random() * 0.7,
                amp: 14 + Math.random() * 26,
            });
        }

        this.leafTimer = 0;
        this.mistScroll = 0;

        // Sprite'y (indeksy zgodne z P_*).
        this.sprites = [
            makeGlowSprite(24, 214, 190, 150, 0.55),   // P_DUST
            makeGlowSprite(20, 255, 214, 112, 0.95),   // P_SPARK
            null,                                       // P_LEAF (osobna tablica)
            makeGlowSprite(28, 170, 210, 255, 0.5),    // P_WISP
            makeGlowSprite(18, 255, 110, 80, 0.9),     // P_EMBER
            null,                                       // P_STREAK (rysowane linią)
            makeGlowSprite(30, 255, 250, 235, 0.6),    // P_PUFF
        ];
        this.leafSprites = [
            makeLeafSprite('#7a9c4f', '#5d7a3a'),
            makeLeafSprite('#b8873c', '#8f6527'),
            makeLeafSprite('#8fae52', '#6d8a3d'),
        ];
        this.glowSoft = makeGlowSprite(64, 200, 225, 255, 0.4); // poświata duchów

        // Bufory zależne od rozmiaru okna (tworzone w resize()).
        this.vignette = null;
        this.rays = null;
        this.mist = null;
        this.flashGrad = null;
    }

    // --- Bufory pełnoekranowe (renderowane raz przy zmianie rozmiaru) -----

    resize(w, h) {
        if (w === this.w && h === this.h) return;
        this.w = w; this.h = h;

        // Winieta + ciepła korekcja koloru wypieczone w JEDEN obraz —
        // jeden drawImage na klatkę zamiast pełnoekranowych trybów mieszania.
        const vig = document.createElement('canvas');
        vig.width = w; vig.height = h;
        {
            const ctx = vig.getContext('2d');
            const warm = ctx.createRadialGradient(w / 2, h * 0.38, 0, w / 2, h * 0.38, Math.max(w, h) * 0.6);
            warm.addColorStop(0, 'rgba(255,157,71,0.07)');
            warm.addColorStop(1, 'rgba(255,157,71,0)');
            ctx.fillStyle = warm;
            ctx.fillRect(0, 0, w, h);
            const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.72);
            g.addColorStop(0, 'rgba(10,6,4,0)');
            g.addColorStop(1, 'rgba(10,6,4,0.42)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
        }
        this.vignette = vig;

        // Promienie światła — ukośne pasy przez las. Bufor ma tylko górne 60%
        // ekranu (tam sięgają promienie), żeby zmniejszyć pole kompozycji.
        const rays = document.createElement('canvas');
        rays.width = w; rays.height = Math.round(h * 0.6);
        {
            const ctx = rays.getContext('2d');
            // Miękkie wygaszenie promieni ku dołowi bufora.
            ctx.translate(w * 0.5, -h * 0.15);
            ctx.rotate(0.32);
            for (let i = 0; i < 4; i++) {
                const rx = -w * 0.55 + i * w * 0.28;
                const rw = 60 + i * 34;
                const g = ctx.createLinearGradient(rx, 0, rx + rw, 0);
                g.addColorStop(0, 'rgba(255,236,180,0)');
                g.addColorStop(0.5, 'rgba(255,236,180,0.16)');
                g.addColorStop(1, 'rgba(255,236,180,0)');
                ctx.fillStyle = g;
                ctx.fillRect(rx, -h * 0.2, rw, h * 2.2);
            }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'destination-in';
            const fade = ctx.createLinearGradient(0, 0, 0, rays.height);
            fade.addColorStop(0.55, 'rgba(0,0,0,1)');
            fade.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = fade;
            ctx.fillRect(0, 0, rays.width, rays.height);
        }
        this.rays = rays;

        // Mgła przy ziemi — pozioma wstęga szumu z miękkich plam.
        const mist = document.createElement('canvas');
        mist.width = Math.max(2, Math.round(w * 1.5)); mist.height = 150;
        {
            const ctx = mist.getContext('2d');
            for (let i = 0; i < 26; i++) {
                const mx = Math.random() * mist.width;
                const my = 40 + Math.random() * 100;
                const mr = 45 + Math.random() * 75;
                const g = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
                g.addColorStop(0, 'rgba(214,226,235,0.09)');
                g.addColorStop(1, 'rgba(214,226,235,0)');
                ctx.fillStyle = g;
                ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
            }
        }
        this.mist = mist;

        // Rozbłysk trafienia — czerwień wchodzi z krawędzi ekranu.
        const fl = document.createElement('canvas');
        fl.width = w; fl.height = h;
        {
            const ctx = fl.getContext('2d');
            const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.7);
            g.addColorStop(0, 'rgba(231,60,45,0)');
            g.addColorStop(1, 'rgba(231,60,45,0.85)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
        }
        this.flashGrad = fl;
    }

    reset() {
        this.trauma = 0; this.hitStop = 0; this.slowMo = 0; this.timeScale = 1;
        this.flashAlpha = 0;
        for (const p of this.particles) p.active = false;
        for (const p of this.popups) p.active = false;
        for (const r of this.rings) r.active = false;
    }

    // --- Czas i kamera ------------------------------------------------------

    // Zamienia surowe dt na dt świata gry (hit-stop, slow-mo) i liczy shake.
    // Wołać raz na klatkę, PRZED update().
    tick(rawDt) {
        this.t += rawDt;

        // Monitor wydajności → ewentualna degradacja jakości.
        if (this.warmupFrames > 0) {
            this.warmupFrames--;
        } else if (this.quality > 0) {
            this.frameMsEma += (Math.min(rawDt, 0.05) * 1000 - this.frameMsEma) * 0.05;
            this.slowStreak = this.frameMsEma > 19.5 ? this.slowStreak + 1 : 0;
            if (this.slowStreak > 90) {
                this.quality--;
                this.slowStreak = 0;
                this.frameMsEma = 16.7;
                console.info('[FX] Obniżam jakość efektów do poziomu ' + this.quality + ' (utrzymanie płynności).');
            }
        }

        if (this.hitStop > 0) {
            this.hitStop -= rawDt;
            this.timeScale = 0.05;
        } else if (this.slowMo > 0) {
            this.slowMo -= rawDt;
            // płynne wyjście ze slow-mo pod koniec
            const k = Math.min(1, this.slowMo / 0.3);
            this.timeScale = this.slowMoScale + (1 - this.slowMoScale) * (1 - k);
        } else {
            this.timeScale = 1;
        }

        this.trauma = Math.max(0, this.trauma - rawDt * 1.6);
        const shake = this.trauma * this.trauma * 16;
        this.shakeX = (Math.random() * 2 - 1) * shake;
        this.shakeY = (Math.random() * 2 - 1) * shake;

        return rawDt * this.timeScale;
    }

    addTrauma(amount) { this.trauma = Math.min(1, this.trauma + amount); }
    addHitStop(sec) { this.hitStop = Math.max(this.hitStop, sec); }
    addSlowMo(sec, scale) { this.slowMo = sec; this.slowMoScale = scale; }
    flash(alpha, rgb) { this.flashAlpha = Math.max(this.flashAlpha, alpha); if (rgb) this.flashColor = rgb; }

    // --- Emitery ------------------------------------------------------------

    _emit(type, x, y, vx, vy, life, size, grav, drag) {
        // Szukamy wolnego slotu od kursora — O(1) amortyzowane.
        for (let n = 0; n < MAX_PARTICLES; n++) {
            this.cursor = (this.cursor + 1) % MAX_PARTICLES;
            const p = this.particles[this.cursor];
            if (p.active) continue;
            p.active = true;
            p.type = type; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
            p.life = life; p.maxLife = life; p.size = size;
            p.grav = grav; p.drag = drag;
            p.rot = Math.random() * Math.PI * 2;
            p.vr = (Math.random() - 0.5) * 6;
            p.sway = Math.random() * Math.PI * 2;
            p.spriteIdx = type === P_LEAF ? (Math.random() * this.leafSprites.length) | 0 : type;
            return p;
        }
        return null;
    }

    // Kurz spod stóp podczas biegu.
    emitRunDust(x, y, dir) {
        for (let i = 0; i < 2; i++) {
            this._emit(P_DUST, x + (Math.random() - 0.5) * 14, y - Math.random() * 6,
                -dir * (30 + Math.random() * 50), -(20 + Math.random() * 40),
                0.35 + Math.random() * 0.2, 6 + Math.random() * 7, -60, 0.9);
        }
    }

    // Obłok kurzu przy lądowaniu — siła 0..1 skaluje liczbę i rozmiar.
    emitLanding(x, y, strength) {
        const n = 4 + Math.round(strength * 8);
        for (let i = 0; i < n; i++) {
            const dir = i % 2 === 0 ? 1 : -1;
            this._emit(P_DUST, x + dir * (6 + Math.random() * 10), y - Math.random() * 5,
                dir * (60 + Math.random() * 120) * (0.5 + strength), -(30 + Math.random() * 70),
                0.4 + Math.random() * 0.25, 8 + Math.random() * 9 * (0.6 + strength), -50, 0.86);
        }
    }

    // Obłoczek przy wybiciu w górę.
    emitJump(x, y) {
        for (let i = 0; i < 6; i++) {
            const a = Math.PI + (i / 5) * Math.PI; // wachlarz w dół
            this._emit(P_PUFF, x, y - 4,
                Math.cos(a) * (40 + Math.random() * 60), 30 + Math.random() * 50,
                0.3 + Math.random() * 0.2, 8 + Math.random() * 8, -120, 0.88);
        }
    }

    // Złota eksplozja iskier — pokonanie wroga.
    emitStompBurst(x, y) {
        for (let i = 0; i < 18; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 90 + Math.random() * 260;
            this._emit(P_SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 80,
                0.4 + Math.random() * 0.4, 4 + Math.random() * 6, 500, 0.94);
        }
        this.spawnRing(x, y, '255,214,112');
    }

    // Czerwone drobinki przy trafieniu gracza.
    emitHitSparks(x, y) {
        for (let i = 0; i < 14; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 70 + Math.random() * 210;
            this._emit(P_EMBER, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 60,
                0.35 + Math.random() * 0.35, 4 + Math.random() * 5, 420, 0.93);
        }
        this.spawnRing(x, y, '231,76,60');
    }

    // Zimna smużka za duchem.
    emitWisp(x, y) {
        this._emit(P_WISP, x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 14,
            20 + Math.random() * 30, (Math.random() - 0.5) * 20,
            0.5 + Math.random() * 0.3, 8 + Math.random() * 10, -40, 0.95);
    }

    spawnRing(x, y, color) {
        for (const r of this.rings) {
            if (r.active) continue;
            r.active = true; r.x = x; r.y = y; r.r = 8; r.vr = 340;
            r.life = 0.35; r.maxLife = 0.35; r.color = color;
            return;
        }
    }

    spawnPopup(x, y, text, color, size) {
        for (const p of this.popups) {
            if (p.active) continue;
            p.active = true; p.x = x; p.y = y; p.text = text;
            p.color = color || '#ffd670'; p.size = size || 22;
            p.life = 0.9; p.maxLife = 0.9;
            return;
        }
    }

    // --- Aktualizacja --------------------------------------------------------

    update(dt, env) {
        this.gameSpeed = env.gameSpeed;
        const w = env.w, h = env.h;

        this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2.4);

        // Liście — spadają cały czas, gęściej przy większej prędkości gry.
        this.leafTimer -= dt;
        if (this.leafTimer <= 0) {
            this.leafTimer = 0.5 - Math.min(0.32, env.gameSpeed * 0.0005) + Math.random() * 0.3;
            this._emit(P_LEAF, w + 20, Math.random() * h * 0.75,
                -(40 + Math.random() * 60) - env.gameSpeed * 0.35,
                26 + Math.random() * 40,
                7, 10 + Math.random() * 8, 0, 1);
        }

        // Smugi prędkości — dopiero gdy gra się rozpędzi.
        if (env.playing && env.gameSpeed > 400 && Math.random() < (env.gameSpeed - 400) * 0.004) {
            this._emit(P_STREAK, w + 30, Math.random() * h * 0.8,
                -(env.gameSpeed * 2.6 + Math.random() * 300), 0,
                0.6, 60 + Math.random() * 90, 0, 1);
        }

        this.mistScroll = (this.mistScroll + dt * (18 + env.gameSpeed * 0.06));

        // Cząsteczki.
        for (const p of this.particles) {
            if (!p.active) continue;
            p.life -= dt;
            if (p.life <= 0 || p.x < -60 || p.y > h + 60) { p.active = false; continue; }
            p.vy += p.grav * dt;
            p.vx *= Math.pow(p.drag, dt * 60);
            p.vy *= Math.pow(p.drag, dt * 60);
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
            if (p.type === P_LEAF) {
                p.sway += dt * 3;
                p.x += Math.sin(p.sway) * 26 * dt;
                p.y += Math.cos(p.sway * 0.7) * 14 * dt;
            }
        }

        // Pierścienie.
        for (const r of this.rings) {
            if (!r.active) continue;
            r.life -= dt;
            if (r.life <= 0) { r.active = false; continue; }
            r.r += r.vr * dt;
        }

        // Popupy.
        for (const p of this.popups) {
            if (!p.active) continue;
            p.life -= dt;
            if (p.life <= 0) { p.active = false; continue; }
            p.y -= 55 * dt;
        }
    }

    // --- Rysowanie ------------------------------------------------------------
    // Ambient: za wrogami i graczem (promienie światła, świetliki, liście).

    drawAmbient(ctx, groundY) {
        // Promienie światła — delikatny ruch wahadłowy + pulsowanie jasności.
        if (this.rays && this.quality >= 2) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = 0.55 + Math.sin(this.t * 0.7) * 0.2;
            ctx.drawImage(this.rays, Math.sin(this.t * 0.24) * 24, 0);
            ctx.restore();
        }

        // Świetliki — dodawane świecenie, pulsująca alfa.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const f of this.fireflies) {
            const fx = ((f.x + this.t * 0.008 * f.speed) % 1) * this.w;
            const fy = groundY - 30 - f.y * 180 + Math.sin(this.t * f.speed + f.phase) * f.amp;
            const a = 0.35 + 0.35 * Math.sin(this.t * (1.4 + f.speed) + f.phase * 3);
            if (a <= 0.05) continue;
            ctx.globalAlpha = a;
            const s = 10 + f.speed * 6;
            ctx.drawImage(this.sprites[P_SPARK], fx - s / 2, fy - s / 2, s, s);
        }
        ctx.restore();
    }

    // Efekty świata: kurz, iskry, liście, wisps, pierścienie, popupy.
    drawEffects(ctx) {
        ctx.save();
        for (const p of this.particles) {
            if (!p.active) continue;
            const k = p.life / p.maxLife;
            if (p.type === P_LEAF) {
                ctx.globalAlpha = Math.min(1, k * 3) * 0.9;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                const spr = this.leafSprites[p.spriteIdx];
                ctx.drawImage(spr, -p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
                ctx.restore();
            } else if (p.type === P_STREAK) {
                ctx.globalAlpha = k * 0.14;
                ctx.fillStyle = '#fff6e0';
                ctx.fillRect(p.x, p.y, p.size, 2);
            } else {
                const spr = this.sprites[p.type];
                const additive = p.type === P_SPARK || p.type === P_EMBER || p.type === P_WISP;
                if (additive) ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = k;
                const s = p.size * (p.type === P_DUST || p.type === P_PUFF ? (2 - k) : 1);
                ctx.drawImage(spr, p.x - s / 2, p.y - s / 2, s, s);
                if (additive) ctx.globalCompositeOperation = 'source-over';
            }
        }
        ctx.restore();

        // Fale uderzeniowe.
        ctx.save();
        for (const r of this.rings) {
            if (!r.active) continue;
            const k = r.life / r.maxLife;
            ctx.globalAlpha = k * 0.8;
            ctx.strokeStyle = `rgba(${r.color},1)`;
            ctx.lineWidth = 1 + k * 5;
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();

        // Pływające napisy (+10, SERIA x2! ...).
        ctx.save();
        ctx.textAlign = 'center';
        for (const p of this.popups) {
            if (!p.active) continue;
            const k = p.life / p.maxLife;
            const pop = 1 + Math.max(0, k - 0.75) * 3; // "strzał" skali na starcie
            ctx.globalAlpha = Math.min(1, k * 2.5);
            ctx.font = `800 ${Math.round(p.size * pop)}px 'Trebuchet MS', sans-serif`;
            ctx.strokeStyle = 'rgba(20,12,4,0.85)';
            ctx.lineWidth = 4;
            ctx.strokeText(p.text, p.x, p.y);
            ctx.fillStyle = p.color;
            ctx.fillText(p.text, p.x, p.y);
        }
        ctx.restore();
    }

    // Miękka poświata (np. za duchem) — publiczny helper.
    drawGlow(ctx, x, y, size, alpha) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha;
        ctx.drawImage(this.glowSoft, x - size / 2, y - size / 2, size, size);
        ctx.restore();
    }

    // Cień postaci — elipsa pod stopami, mniejsza gdy postać jest w powietrzu.
    drawShadow(ctx, x, groundY, width, airOffset) {
        const lift = Math.min(1, Math.abs(airOffset) / 260);
        ctx.save();
        ctx.globalAlpha = 0.3 * (1 - lift * 0.7);
        ctx.fillStyle = '#0c0803';
        ctx.beginPath();
        ctx.ellipse(x, groundY + 6, width * (1 - lift * 0.4), 7 * (1 - lift * 0.4), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Nakładki pełnoekranowe — rysować POZA transformacją shake.
    drawOverlay(ctx, groundY) {
        // Mgła przy ziemi — dwie wstęgi w różnym tempie budują głębię
        // (przy obniżonej jakości: jedna wstęga, przy najniższej: brak).
        if (this.mist && this.quality >= 1) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const mw = this.mist.width;
            let x1 = -(this.mistScroll % mw);
            ctx.globalAlpha = 0.75;
            for (let x = x1; x < this.w; x += mw) ctx.drawImage(this.mist, x, groundY - 90);
            if (this.quality >= 2) {
                let x2 = -((this.mistScroll * 0.55) % mw);
                ctx.globalAlpha = 0.45;
                for (let x = x2; x < this.w; x += mw) ctx.drawImage(this.mist, x, groundY - 40);
            }
            ctx.restore();
        }

        // Winieta z wypieczoną ciepłą korekcją koloru — jeden tani drawImage.
        if (this.vignette) ctx.drawImage(this.vignette, 0, 0);

        // Rozbłysk trafienia.
        if (this.flashAlpha > 0.01 && this.flashGrad) {
            ctx.save();
            ctx.globalAlpha = this.flashAlpha;
            ctx.drawImage(this.flashGrad, 0, 0);
            ctx.restore();
        }
    }
}

window.FXSystem = FXSystem;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FXSystem };
}

}
