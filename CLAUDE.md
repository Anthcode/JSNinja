# Notatki dla agentów pracujących nad JS Ninja

Endless runner w czystym JS + Canvas 2D. **Bez frameworków, bez bundlera, bez kroku
build** — pliki z `game/` są serwowane jeden do jednego przez GitHub Pages.

## Układ projektu

```
game/
├── index.html        – CAŁA logika gry w <script type="text/x-dc">: pętla, fizyka,
│                       kolizje, input, rysowanie, AudioManager, HUD (szablon DC)
├── effects.js        – FXSystem: pule cząsteczek, kamera (shake/hit-stop/slow-mo),
│                       prerenderowane sprite'y, ambient, nakładki pełnoekranowe
├── spriteAnimator.js – data-driven animator spritesheetów postaci
├── support.js        – WYGENEROWANY runtime DC — nie edytować ręcznie
├── layers/           – warstwy paralaksy + spritesheety
└── sfx/              – efekty dźwiękowe (mp3)
```

## Zasady, które łatwo złamać

1. **Nie edytuj `game/support.js`** — jest generowany, zmiany przepadną.
2. **Zero alokacji w pętli gry.** Cząsteczki (`FXSystem._emit`) i pociski
   (`this.stars`) chodzą po pulach o stałym rozmiarze. Dodając cokolwiek, co
   powstaje wielokrotnie w trakcie rozgrywki, dołóż pulę — nie `push`/`filter`.
   Wyjątkiem historycznym jest `this.enemies`, które alokuje.
3. **Sprite'y prerenderuj raz** do offscreen canvas (patrz `makeGlowSprite`,
   `makeShurikenSprite`). W pętli ma zostać samo `drawImage`.
4. **Komentarze po polsku i o „dlaczego", nie o „co".** Dopasuj się do stylu
   otoczenia — komentarz ma tłumaczyć nieoczywistą decyzję, nie opisywać kod.
5. **Mobile jest pierwszoklasowym targetem.** Gra działa w orientacji poziomej,
   ma tryb foto i blokadę pionu. Każdą zmianę sterowania sprawdź na wąskim
   viewporcie (np. 667×375), nie tylko na desktopie.

## Uruchomienie i testy

```bash
npm install                 # tylko zależności testowe; gra ich nie potrzebuje
npm run lint                # sprawdzenie składni (ułamek sekundy, bez przeglądarki)
npm test                    # testy mechaniki w prawdziwym Chromium (~20 s)
npm run serve               # http://localhost:8917/game/index.html do oglądania
```

Grę serwuj po HTTP (`npm run serve`, a w testach robi to harness) — tak działa
produkcja i tak wygląda ścieżka, którą sprawdzamy. CI (`.github/workflows/ci.yml`)
odpala dokładnie `npm run lint` i `npm test`.

**Uwaga przy pisaniu testów:** obecność przycisku „Start" w DOM **nie dowodzi**,
że gra wstała — to surowy szablon `x-dc`, widoczny także wtedy, gdy runtime nie
zdołał się zbootować. Dowodem jest dopiero `window.__game` (patrz `bootGame()`).

## Środowisko: co działa, a co gryzie

Te punkty wynikają z realnego debugowania w piaskownicy agenta. Każdy kosztował
osobną rundę, więc warto je znać zanim się na nie wpadnie.

### Gra dociąga React z CDN w runtime

`support.js` ładuje React 18.3.1, ReactDOM i `@babel/standalone` z **unpkg.com**
w trakcie startu strony. W piaskownicy agenta unpkg jest **nieosiągalny**
(`ERR_CONNECTION_RESET` z Chromium, mimo że `curl` przez proxy działa) i strona
nie wstaje wcale — zostaje czarny prostokąt.

Rozwiązanie jest w `tests/helpers.mjs`: te same wersje siedzą w `devDependencies`,
a `page.route('**://unpkg.com/**')` serwuje je z `node_modules`. Testy są przez to
hermetyczne i nie zależą od CDN-a także w CI. Jeśli kiedyś zregenerujesz
`support.js` na nowsze wersje, zaktualizuj `CDN_MAP` — harness celowo krzyczy przy
nietrafionym route zamiast po cichu wychodzić do sieci.

### Wersja Playwrighta musi pasować do builda przeglądarki

Piaskownica ma przygotowane przeglądarki w `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`
i **nie wolno w niej uruchamiać `playwright install`**. Leży tam konkretny build
(np. `chromium-1194`), który odpowiada konkretnej wersji Playwrighta.

Dlatego `package.json` przypina `"playwright": "1.56.1"` **bez daszka**. Zakres
`^1.56.1` cicho podbija do nowszej wersji, która szuka innego builda i wywala się:

```
browserType.launch: Executable doesn't exist at .../chromium_headless_shell-1234/...
```

W CI to bez znaczenia (`playwright install` dociąga pasujący build), ale w
piaskownicy przypięcie jest jedyną rzeczą, która trzyma to razem. Gdyby build i tak
się nie zgadzał, ostatnią deską ratunku jest `executablePath: '/opt/pw-browsers/chromium'`.

### Nie podawaj proxy dla localhost

W piaskownicy jest globalne `HTTPS_PROXY`. Przekazanie go Chromium
(`--proxy-server` albo opcja `proxy:`) sprawia, że **żądania na localhost lecą
przez proxy i wracają z 405**. Chromium do testów odpalaj bez żadnych ustawień
proxy — połączenia lokalne działają wtedy normalnie. Na unpkg to i tak nie pomaga
(patrz wyżej), więc nie ma po co próbować.

### Dojście do logiki gry z testu

Instancja gry nie jest globalna. Trzeba wejść po drzewie fiberów Reacta z
`<canvas>` w górę do `StreamableComponent` i wziąć jego `.logic` — robi to
`bootGame()` i wystawia jako `window.__game`.

### Przycisk Start trzeba kliknąć `{ force: true }`

Ma nieskończoną animację `floatY`, więc Playwright nigdy nie uzna go za „stable"
i zwykły `click()` czeka do timeoutu.

### Progi kolizji zależą od `dt` — testy muszą je narzucać

`tick()` liczy `dt` jako `(now - lastTime)` i **przycina do 50 ms**. Stomp wymaga,
żeby gracz nie wszedł w wroga głębiej niż `0.6 × wysokość wroga` w jednej klatce —
co przy `dt = 50 ms` przestaje zachodzić i trafienie **słusznie** staje się
zderzeniem z boku. Konkretnie: przy typowym ustawieniu testowym stomp wypada tylko
dla `dt < ~44 ms`.

Skutek: test kolizji bez narzuconego `dt` to loteria zależna od obciążenia maszyny.
Używaj `stepFrame(page, 16)` z `tests/helpers.mjs`, nie `g.tick(performance.now())`.

### Stan gry narasta między testami

`gameSpeed` rośnie z czasem, spawnery dosypują wrogów, `invuln` zostaje po
trafieniu. Testy współdzielące jedną stronę zaczynają na siebie wpływać — przy
rozpędzonym `gameSpeed` wróg przelatuje obok gracza w jednej klatce i do kolizji
w ogóle nie dochodzi. Grupy testów dotykające kolizji dostają **świeżą stronę**
(osobne `describe` z własnym `bootGame`).

### Martwi wrogowie znikają z tablicy po 0.4 s

`this.enemies` jest filtrowane, więc szukanie wroga po fakcie przez
`enemies.find(...)` myli „sprzątnięty po zabiciu" z „nietrafiony". W testach
trzymaj **referencję** do wroga (`window.__ghost = {...}; g.enemies.push(...)`).

### Pliki sfx z `#` w nazwie trzeba enkodować w `AudioManager`

Assety audio bywają nazwane surowo, tak jak wyszły z generatora. `#` w URL-u zaczyna fragment — bez zamiany
na `%23` przeglądarka odcina resztę ścieżki i plik dostaje 404 **po cichu**:
`AudioManager.play()` łyka odrzucenie `play()` (`node.play().catch(() => {})`,
patrz komentarz przy tej linii — to celowe, dla przeglądarek blokujących audio
poza gestem użytkownika), więc w konsoli nic nie widać, dźwięk po prostu nigdy
nie gra. Test `dźwięk > każdy zadeklarowany plik sfx ładuje się` w
`tests/mechanics.test.mjs` łapie to dla każdego pliku w `files` naraz —
sprawdzone empirycznie: bez `%23` test faktycznie czerwienieje.

### `git push` czasem zwraca 502

Zdarza się `remote: session scope unavailable` + HTTP 502 z proxy gita, przy
działającym `git fetch`. To przejściowe — powtórz push z narastającym odstępem
(2 s, 4 s, 8 s, 16 s). U mnie przeszło za czwartym razem, nic nie ginie.

## Mapa strojenia rozgrywki

Stałe do kręcenia balansem (wszystkie na górze `<script>` w `game/index.html`,
o ile nie napisano inaczej):

| Co | Gdzie |
| --- | --- |
| Gwiazdki ninja: prędkość, zasięg, naprowadzanie, rozrzut | `STAR_*` |
| Grawitacja, siła skoku, prędkość biegu | w `tick()` / `tryJump()` |
| Odbicie po stompie, punkty, okno serii | `onStompKill`, `onStarKill`, `comboTimer` |
| Tempo gry i częstotliwość spawnów | `gameSpeed`, `spawnTimer`, `ghostSpawnTimer` w `tick()` |
| Linia gruntu | `GROUND_LIFT_RATIO`, `computeGroundY()` |
| Progi degradacji jakości efektów | `FXSystem.tick()` w `effects.js` |

Zmieniając cokolwiek z tej tabeli, przelec `npm test` — kilka z tych stałych jest
wprost zakotwiczonych w testach mechaniki.

## Deploy

GitHub Pages serwuje `main` bezpośrednio (jest `.nojekyll`, nie ma osobnego
workflow deployu). Merge do `main` = publikacja na
https://anthcode.github.io/JSNinja/ w ciągu ok. minuty. CI nie blokuje deployu —
jest to zwykły workflow testowy, nie brama.
