// Harness do testowania gry w prawdziwej przeglądarce.
//
// Zamyka w sobie cztery rzeczy, które nie są oczywiste przy pierwszym podejściu
// do tego projektu — każda z nich kosztowała osobną rundę debugowania:
//
//  1. Gra dociąga React/ReactDOM/Babel z unpkg.com w runtime (patrz support.js).
//     W odciętych od sieci środowiskach (piaskownice agentów, CI bez egressu)
//     unpkg jest nieosiągalny i strona nie wstaje wcale — zamiast tego serwujemy
//     te same wersje z node_modules przez page.route(). Dzięki temu testy są
//     hermetyczne i nie zależą od dostępności CDN-a.
//  2. Instancja logiki gry nie jest globalna. Trzeba wejść po drzewie fiberów
//     Reacta z <canvas> w górę do StreamableComponent i wziąć jego `.logic`.
//  3. Przycisk Start ma nieskończoną animację floatY, więc Playwright nigdy nie
//     uzna go za „stable" — klikamy z { force: true }.
//  4. tick() przycina dt do 50 ms, a progi kolizji od dt zależą. Testy, które
//     dotykają kolizji, muszą wymuszać dt (patrz stepFrame) — inaczej łapią
//     losowo zdławioną klatkę i sypią się bez związku ze zmianą w kodzie.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Wersje muszą zgadzać się z tymi, które zaszyto w game/support.js. Gdyby ktoś
// zregenerował runtime na nowsze, testy zgłoszą to jako nietrafiony route
// (patrz assert w bootGame), zamiast po cichu iść do prawdziwego CDN-a.
const CDN_MAP = {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js':
    'node_modules/react/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js':
    'node_modules/react-dom/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js':
    'node_modules/@babel/standalone/babel.min.js',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json',
};

// Statyczny serwer na losowym porcie — gra musi iść po HTTP (file:// nie
// przejdzie przez ładowanie warstw i skryptów), a losowy port pozwala odpalać
// kilka przebiegów naraz bez konfliktu.
export async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      const file = join(ROOT, safe);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    async close() { await new Promise((r) => server.close(r)); },
  };
}

// Startuje przeglądarkę, ładuje grę, wciska Start i wystawia logikę gry jako
// window.__game. Zwraca też listę błędów konsoli/strony — każdy test powinien
// na koniec sprawdzić, że jest pusta.
export async function bootGame({ viewport = { width: 1280, height: 720 }, mobile = false } = {}) {
  const server = await startServer();
  // --no-sandbox: kontenery CI i piaskownice agentów zwykle nie mają
  // uprawnień do user namespaces, których wymaga sandbox Chromium.
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({
    viewport,
    ...(mobile ? { hasTouch: true, isMobile: true } : {}),
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  const servedFromCdn = new Set();
  await page.route('**://unpkg.com/**', async (route) => {
    const url = route.request().url();
    const local = CDN_MAP[url];
    if (!local) {
      // Nietrafiony route = support.js dociąga inną wersję niż zna CDN_MAP.
      // Lepiej wywalić się głośno niż milcząco wyjść do sieci.
      errors.push(`nieznany zasób CDN (zaktualizuj CDN_MAP w tests/helpers.mjs): ${url}`);
      await route.abort();
      return;
    }
    servedFromCdn.add(url);
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: await readFile(join(ROOT, local)),
    });
  });

  await page.goto(`${server.url}/game/index.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Start")', { state: 'visible', timeout: 30000 });
  // force: przycisk pulsuje animacją floatY i nigdy nie jest „stable".
  await page.locator('button:has-text("Start")').click({ force: true });
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const key = Object.keys(canvas).find((k) => k.startsWith('__reactFiber$'));
    let fiber = canvas[key];
    while (fiber && fiber.stateNode?.constructor?.name !== 'StreamableComponent') fiber = fiber.return;
    // Uwaga: sam przycisk „Start" jest w DOM także wtedy, gdy runtime w ogóle
    // się nie zbootował (to surowy szablon x-dc), więc dopiero to jest dowodem,
    // że gra żyje. Najczęstsza przyczyna porażki: nie doszły skrypty z CDN-a.
    if (!fiber) {
      throw new Error(
        'nie znaleziono StreamableComponent — runtime DC nie wstał. '
        + 'Sprawdź, czy React/Babel zostały podstawione (CDN_MAP w tests/helpers.mjs), '
        + 'albo czy nie zmieniła się struktura runtime.',
      );
    }
    window.__game = fiber.stateNode.logic;
  });

  return {
    page,
    errors,
    servedFromCdn,
    async close() { await browser.close(); await server.close(); },
  };
}

// Wykonuje jedną klatkę gry z NARZUCONYM dt (domyślnie 16 ms ≈ 60 fps).
//
// tick() liczy dt jako (now - lastTime) i przycina do 50 ms. Progi kolizji na
// tym polegają: stomp wymaga, żeby gracz nie przeleciał zbyt głęboko w wroga
// w jednej klatce (penetracja < 0.6 * wysokości wroga), co przy dt = 50 ms
// przestaje zachodzić i trafienie SŁUSZNIE staje się zderzeniem z boku.
// Bez narzucenia dt taki test jest loterią zależną od obciążenia maszyny.
export const stepFrame = (page, dtMs = 16) => page.evaluate((ms) => {
  const g = window.__game;
  const t = performance.now();
  g.lastTime = t;
  g.tick(t + ms);
}, dtMs);

// Puszcza N prawdziwych klatek rAF — do rzeczy, które muszą przebiec w czasie
// (lot gwiazdek, naprowadzanie), gdzie dokładne dt nie ma znaczenia.
export const runFrames = (page, n) => page.evaluate((count) => new Promise((resolve) => {
  let i = 0;
  const step = () => { i += 1; if (i < count) requestAnimationFrame(step); else resolve(); };
  requestAnimationFrame(step);
}), n);
