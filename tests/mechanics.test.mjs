// Testy mechaniki gry w prawdziwej przeglądarce.
//
// Zakres: reguły rozgrywki, które łatwo zepsuć niepowiązaną zmianą — bramkowanie
// rzutu gwiazdkami, naprowadzanie, role wrogów (duch vs naziemny), stomp, utrata
// życia. Nie testujemy wyglądu; od tego są zrzuty ekranu robione ręcznie.
//
// Każdy test dostaje ŚWIEŻĄ stronę. Stan gry narasta (gameSpeed rośnie z czasem,
// spawnery dosypują wrogów, invuln zostaje po trafieniu), więc testy współdzielące
// jedną stronę zaczynają na siebie wpływać: przy rozpędzonym gameSpeed wróg
// przelatuje obok gracza w jednej klatce i do kolizji w ogóle nie dochodzi.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bootGame, runFrames, stepFrame } from './helpers.mjs';

// Ustawia gracza w powietrzu w powtarzalnym miejscu i zeruje scenę.
const RESET_AIRBORNE = `
  const g = window.__game, p = g.player;
  g.enemies = [];
  for (const s of g.stars) s.active = false;
  g.gameSpeed = 260;
  p.onGround = false; p.y = -150; p.vy = 0; p.facing = 1;
  p.starsAvailable = true; p.invuln = 0;
  p.x = g.viewW * 0.2;
`;

describe('gwiazdki ninja', () => {
  let game;
  before(async () => { game = await bootGame(); });
  after(async () => { await game?.close(); });

  it('rzut działa tylko w powietrzu', async () => {
    const thrown = await game.page.evaluate(`(() => {
      ${RESET_AIRBORNE}
      p.onGround = true;
      g.tryThrowStars();
      return g.stars.filter(s => s.active).length;
    })()`);
    assert.equal(thrown, 0, 'stojąc na ziemi nie powinno wylecieć nic');
  });

  it('jeden rzut na pobyt w powietrzu wypuszcza 3 gwiazdki', async () => {
    const res = await game.page.evaluate(`(() => {
      ${RESET_AIRBORNE}
      g.tryThrowStars();
      const first = g.stars.filter(s => s.active).length;
      g.tryThrowStars();
      return { first, afterSecond: g.stars.filter(s => s.active).length, available: p.starsAvailable };
    })()`);
    assert.equal(res.first, 3);
    assert.equal(res.afterSecond, 3, 'drugi rzut w tym samym locie nie powinien nic dodać');
    assert.equal(res.available, false);
  });

  it('lądowanie odnawia rzut', async () => {
    const available = await game.page.evaluate(`(() => {
      const g = window.__game, p = g.player;
      g.enemies = [];
      p.starsAvailable = false; p.onGround = false; p.y = -5; p.vy = 100;
      for (let i = 0; i < 20 && !p.onGround; i++) { const t = performance.now(); g.lastTime = t; g.tick(t + 16); }
      return { onGround: p.onGround, starsAvailable: p.starsAvailable };
    })()`);
    assert.equal(available.onGround, true, 'gracz powinien wylądować');
    assert.equal(available.starsAvailable, true);
  });

  it('gwiazdka naprowadza się na ducha poza linią rzutu i go zabija', async () => {
    await game.page.evaluate(`(() => {
      ${RESET_AIRBORNE}
      const groundY = g.computeGroundY(g.viewW, g.viewH, p.x);
      // Duch wyraźnie POWYŻEJ toru prostego rzutu — trafi tylko naprowadzanie.
      // Trzymamy referencję: martwy wróg znika z g.enemies po 0.4 s, więc
      // szukanie go w tablicy po fakcie myli sprzątnięcie z brakiem trafienia.
      window.__ghost = { type: 'ghost', x: p.x + 380, y: groundY + p.y - 110, w: 50, h: 60,
        alive: true, dead: false, deadTimer: 0, hit: false, hitTimer: 0,
        bob: 0, wispTimer: 0, frame: 0, frameTimer: 0 };
      g.enemies.push(window.__ghost);
      window.__before = { kills: g.state.kills, score: g.state.score };
      g.tryThrowStars();
    })()`);
    await runFrames(game.page, 30);

    const res = await game.page.evaluate(() => {
      const g = window.__game;
      return {
        dead: window.__ghost.dead,
        killsDelta: g.state.kills - window.__before.kills,
        scoreDelta: g.state.score - window.__before.score,
        chainReset: g.player.starsAvailable,
      };
    });
    assert.equal(res.dead, true, 'duch powinien zginąć od naprowadzonej gwiazdki');
    assert.equal(res.killsDelta, 1);
    assert.ok(res.scoreDelta >= 15, `trafienie ma dać min. 15 pkt, było ${res.scoreDelta}`);
    assert.equal(res.chainReset, true, 'trafienie odnawia rzut (seria stomp → rzut → stomp)');
  });

  it('gwiazdki nie ruszają wrogów naziemnych — to domena stompa', async () => {
    await game.page.evaluate(`(() => {
      ${RESET_AIRBORNE}
      p.y = -60; p.invuln = 5; // invuln: chodzi o pociski, nie o zderzenie ciałem
      const groundY = g.computeGroundY(g.viewW, g.viewH, p.x);
      window.__ground = { type: 'ground', x: p.x + 220, y: groundY, w: 46, h: 58,
        alive: true, dead: false, deadTimer: 0, hit: false, hitTimer: 0,
        bob: 0, frame: 0, frameTimer: 0 };
      g.enemies.push(window.__ground);
      g.tryThrowStars();
    })()`);
    await runFrames(game.page, 25);

    const dead = await game.page.evaluate(() => window.__ground.dead);
    assert.equal(dead, false, 'wróg naziemny ma przeżyć ostrzał gwiazdkami');
  });

  it('pula pocisków nie przecieka przy ciągłym ostrzale', async () => {
    const res = await game.page.evaluate(() => new Promise((resolve) => {
      const g = window.__game, p = g.player;
      g.enemies = [];
      let maxActive = 0, frames = 0;
      const step = () => {
        p.onGround = false; p.y = -150; p.vy = 0; p.starsAvailable = true;
        g.tryThrowStars();
        maxActive = Math.max(maxActive, g.stars.filter((s) => s.active).length);
        frames += 1;
        if (frames < 60) requestAnimationFrame(step);
        else resolve({ maxActive, poolSize: g.stars.length });
      };
      requestAnimationFrame(step);
    }));
    assert.ok(res.maxActive <= res.poolSize,
      `aktywnych gwiazdek (${res.maxActive}) nie może być więcej niż wielkość puli (${res.poolSize})`);
  });

  it('nie zgłasza błędów w konsoli', () => {
    assert.deepEqual(game.errors, []);
  });
});

describe('dźwięk', () => {
  let game;
  before(async () => { game = await bootGame(); });
  after(async () => { await game?.close(); });

  // Regresja: sfx rzutu gwiazdkami miał nazwę pliku z "#", co w URL-u zaczyna
  // fragment — bez zakodowania na %23 przeglądarka odcinała resztę ścieżki
  // i plik nigdy się nie ładował (cichy 404, żadnego błędu w konsoli, bo
  // AudioManager łyka odrzucenie play() — patrz komentarz w klasie). Zamiast
  // pilnować jednego pliku, sprawdzamy WSZYSTKIE zadeklarowane sfx naraz, żeby
  // ta sama klasa błędu przy kolejnym dodanym dźwięku też została złapana.
  it('każdy zadeklarowany plik sfx ładuje się (200, nie 404)', async () => {
    const results = await game.page.evaluate(() => Promise.all(
      Object.entries(window.__game.audio.sounds).map(async ([key, audioEl]) => {
        const res = await fetch(audioEl.src);
        return { key, src: audioEl.src, status: res.status };
      }),
    ));
    const failed = results.filter((r) => r.status !== 200);
    assert.deepEqual(failed, [], `te pliki sfx nie ładują się: ${JSON.stringify(failed)}`);
    assert.ok(results.length >= 10, 'lista dźwięków wygląda podejrzanie krótko — AudioManager się nie wczytał?');
  });

  it('nie zgłasza błędów w konsoli', () => {
    assert.deepEqual(game.errors, []);
  });
});

describe('walka wręcz (regresje)', () => {
  let game;
  // Świeża strona: te ścieżki zależą od gameSpeed i pozycji gracza, które
  // testy gwiazdek rozstrajają.
  before(async () => { game = await bootGame(); });
  after(async () => { await game?.close(); });

  it('skok na głowę zabija wroga naziemnego i odbija gracza', async () => {
    await game.page.evaluate(() => {
      const g = window.__game, p = g.player;
      g.enemies = [];
      p.invuln = 0; p.onGround = false; p.vy = 400;
      // p.y musi dać penetrację w (0, 34.8) po klatce fizyki — inaczej trafienie
      // liczy się jako zderzenie z boku. Przy dt = 16 ms -45 daje zapas.
      p.y = -45;
      const groundY = g.computeGroundY(g.viewW, g.viewH, p.x);
      window.__enemy = { type: 'ground', x: p.x, y: groundY, w: 46, h: 58,
        alive: true, dead: false, deadTimer: 0, hit: false, hitTimer: 0,
        bob: 0, frame: 0, frameTimer: 0 };
      g.enemies.push(window.__enemy);
    });
    await stepFrame(game.page, 16);

    const res = await game.page.evaluate(() => ({
      dead: window.__enemy.dead,
      bounced: window.__game.player.vy < 0,
    }));
    assert.equal(res.dead, true);
    assert.equal(res.bounced, true, 'stomp ma odbić gracza w górę');
  });

  it('dotknięcie ducha bez gwiazdek nadal kosztuje życie', async () => {
    await game.page.evaluate(() => {
      const g = window.__game, p = g.player;
      g.enemies = [];
      for (const s of g.stars) s.active = false;
      p.invuln = 0; p.onGround = false; p.y = -100; p.vy = 0;
      const gy = g.computeGroundY(g.viewW, g.viewH, p.x);
      window.__ghost = { type: 'ghost', x: p.x, y: gy + p.y, w: 50, h: 60,
        alive: true, dead: false, deadTimer: 0, hit: false, hitTimer: 0,
        bob: 0, wispTimer: 0, frame: 0, frameTimer: 0 };
      g.enemies.push(window.__ghost);
      window.__lives = g.state.lives;
    });
    await stepFrame(game.page, 16);

    const res = await game.page.evaluate(() => ({
      lost: window.__lives - window.__game.state.lives,
      ghostAlive: window.__ghost.alive,
    }));
    assert.equal(res.lost, 1, 'kontakt z duchem ma zabrać życie');
    assert.equal(res.ghostAlive, true, 'duch nie ginie od zderzenia ciałem');
  });

  it('nie zgłasza błędów w konsoli', () => {
    assert.deepEqual(game.errors, []);
  });
});

describe('mobile', () => {
  let game;
  before(async () => { game = await bootGame({ viewport: { width: 667, height: 375 }, mobile: true }); });
  after(async () => { await game?.close(); });

  // Regresja: poprzednia wersja tej umiejętności (dash) przesuwała gracza o
  // ~196 px, co na wąskim ekranie zjadało prawie cały pas ruchu i potrafiło
  // przykleić postać do krawędzi na czas trwania zrywu — wyglądało to jak
  // zawieszenie gry. Rzut gwiazdkami nie rusza graczem wcale.
  it('rzut w powietrzu nie przykleja gracza do krawędzi ani nie zatrzymuje gry', async () => {
    const before = await game.page.evaluate(() => {
      const g = window.__game, p = g.player;
      g.enemies = [];
      p.onGround = false; p.y = -120; p.vy = 0; p.facing = 1; p.starsAvailable = true;
      p.x = (p.minX + p.maxX) / 2;
      g.tryThrowStars();
      return { x: p.x, score: g.state.score };
    });
    await runFrames(game.page, 30);

    const after = await game.page.evaluate(() => {
      const g = window.__game, p = g.player;
      return {
        x: p.x, minX: p.minX, maxX: p.maxX,
        score: g.state.score,
        gameState: g.state.gameState,
      };
    });
    assert.equal(after.x, before.x, 'rzut nie może przesuwać gracza w poziomie');
    assert.ok(after.x > after.minX && after.x < after.maxX, 'gracz nie może wisieć na granicy ruchu');
    assert.equal(after.gameState, 'playing');
    assert.ok(after.score > before.score, 'gra ma biec dalej po rzucie (brak zawieszenia)');
  });

  it('nie zgłasza błędów w konsoli', () => {
    assert.deepEqual(game.errors, []);
  });
});
