// Sprawdzenie składni bez uruchamiania przeglądarki — najtańsza siatka
// bezpieczeństwa w CI (ułamek sekundy, zero zależności poza Node).
//
// Logika gry nie jest osobnym plikiem .js, tylko siedzi w <script type="text/x-dc">
// w game/index.html, więc `node --check` nie zadziała na niej wprost — najpierw
// wycinamy skrypt do pliku tymczasowego.
//
// Uwaga: to sprawdza WYŁĄCZNIE parsowalność. Błędy logiczne wyłapują dopiero
// testy w tests/mechanics.test.mjs, które odpalają prawdziwą grę.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Skrypt gry osadzony w index.html — ten sam wzorzec, którego używa runtime DC.
const GAME_SCRIPT_RE = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/;

function check(label, source) {
  const dir = mkdtempSync(join(tmpdir(), 'jsninja-syntax-'));
  const file = join(dir, 'check.js');
  writeFileSync(file, source);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`  ok  ${label}`);
    return true;
  } catch (err) {
    console.error(`  FAIL  ${label}`);
    console.error(String(err.stderr || err.message));
    return false;
  }
}

const targets = [];

const indexHtml = readFileSync(join(ROOT, 'game/index.html'), 'utf8');
const match = indexHtml.match(GAME_SCRIPT_RE);
if (!match) {
  console.error('FAIL: nie znaleziono <script type="text/x-dc"> w game/index.html — zmienił się układ pliku?');
  process.exit(1);
}
targets.push(['game/index.html (osadzony skrypt gry)', match[1]]);

for (const rel of ['game/effects.js', 'game/spriteAnimator.js']) {
  targets.push([rel, readFileSync(join(ROOT, rel), 'utf8')]);
}

console.log('Sprawdzanie składni:');
const ok = targets.map(([label, src]) => check(label, src)).every(Boolean);
process.exit(ok ? 0 : 1);
