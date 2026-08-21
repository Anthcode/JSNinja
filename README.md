# 🥷 Leśny Ninja: Bieg

Endless runner w czystym JavaScripcie (Canvas 2D) — ninja biegnie przez jesienny las,
skacze wrogom na głowy i buduje serie trafień. Gra powstała jako demo portfolio
z naciskiem na **efekty wizualne** i **stałe 60 fps**.

**▶ Zagraj:** https://anthcode.github.io/JSNinja/

## Sterowanie

| Akcja | Klawiatura | Dotyk |
| --- | --- | --- |
| Ruch lewo / prawo | strzałki lub A / D | przytrzymanie lewej / prawej połowy ekranu |
| Skok | spacja, W lub strzałka w górę | machnięcie w górę |
| Gwiazdki ninja (w powietrzu) | Shift lub E | machnięcie w bok |

Wskocz wrogowi na głowę, aby go pokonać — kolejne trafienia w krótkim czasie budują
**serię** i mnożą punkty. Zderzenie z boku kosztuje życie.

**Gwiazdki ninja (shuriken)** to odpowiedź na latające duchy, których nie da się
doskoczyć. W powietrzu ninja wyrzuca wachlarz trzech gwiazdek w kierunku, w którym
patrzy; każda **sama naprowadza się na najbliższego ducha**, ale z ograniczonym kątem
skrętu (5,5 rad/s) — dociągnie do celu, w który mniej więcej wycelowałeś, lecz nie
zawróci za plecy, więc rzut nadal wymaga wyczucia. Gwiazdki lecą z lekko różnymi
prędkościami, dzięki czemu układają się w czytelną serię, a po zestrzeleniu jednego
ducha pozostałe przejmują kolejny cel.

Trafienie gwiazdką punktuje wyżej niż stomp (15 × seria). Jeden rzut na pobyt
w powietrzu — odnawia się przy lądowaniu albo po pokonaniu wroga, co pozwala łączyć
akcje w serie (stomp → rzut → stomp). Wrogowie naziemni pozostają domeną skoku na
głowę — gwiazdki ich nie dotyczą, więc każde narzędzie ma swoją rolę.

## Efekty wizualne („juice”)

- **Cząsteczki** (pula 512, zero alokacji w pętli gry): kurz spod stóp i przy lądowaniu,
  obłoczek skoku, złote iskry przy pokonaniu wroga, czerwone drobinki przy trafieniu,
  liście niesione wiatrem, zimne smużki za duchami, smugi prędkości przy rozpędzonej grze,
  błysk przy wyrzucie gwiazdek, ich zimne smugi w locie i lodowoniebieska eksplozja
  iskier przy trafieniu ducha.
- **Kamera**: screen shake sterowany „traumą” (kwadratowo — małe uderzenia są subtelne),
  hit-stop przy trafieniach, slow-motion przy utracie ostatniego życia.
- **Postać**: squash & stretch przy skoku, lądowaniu i zamachu do rzutu, echo sylwetki
  w powietrzu, miękkie cienie pod postaciami, zimny rozbłysk sylwetki tuż po rzucie.
- **Pociski**: prerenderowany sprite gwiazdki (jeden `drawImage` z obrotem na sztukę),
  własna pula o stałym rozmiarze, naprowadzanie z limitem kąta skrętu.
- **Atmosfera**: promienie światła przez las, świetliki przy ziemi, dwie wstęgi mgły,
  winieta z ciepłą korekcją koloru, fale uderzeniowe i pływające napisy (+10, SERIA x3!).
- **UI**: szklane panele HUD, licznik serii, animowane ekrany startu i końca gry.

## Dźwięk

`AudioManager` (w `index.html`) preloaduje krótkie efekty z `game/sfx/` i odtwarza je
przez `cloneNode`, więc mogą się nakładać (np. seria stompów jedna po drugiej):

| Zdarzenie | Plik |
| --- | --- |
| Start gry | `game-start.mp3` |
| Skok | `jump.mp3` |
| Pokonanie wroga (stomp) | `stomp-kill.mp3` + `score-tick.mp3` |
| Rzut gwiazdkami | `jump.mp3` (ciszej — placeholder do czasu własnego swoosh) |
| Trafienie ducha gwiazdką | `stomp-kill.mp3` + `score-tick.mp3` |
| Seria trafień (≥2) | `combo.mp3` |
| Nowy rekord serii | `best-combo.mp3` |
| Trafienie przez wroga naziemnego | `player-hit.mp3` |
| Trafienie przez ducha | `ghost-hit.mp3` |
| Utrata ostatniego życia | `game-over.mp3` |

## Architektura

```
game/
├── index.html        – logika gry (komponent DC): pętla, fizyka, kolizje, rysowanie, dźwięk (AudioManager)
├── effects.js        – FXSystem: cząsteczki, kamera, ambient, nakładki ekranowe
├── spriteAnimator.js – data-driven animator spritesheetów (stany, klatki, przejścia)
├── support.js        – wygenerowany runtime DC (nie edytować ręcznie)
├── layers/           – grafika: warstwy paralaksy + spritesheety postaci i wrogów (w tym duch)
└── sfx/              – efekty dźwiękowe (mp3)
```

Sama gra nie ma kroku build ani zależności — `package.json` istnieje wyłącznie po to,
żeby dało się odpalić testy.

## Testy

```bash
npm install     # tylko zależności testowe
npm run lint    # sprawdzenie składni, bez przeglądarki
npm test        # mechanika w prawdziwym Chromium (~20 s)
```

## Wydajność

- Sprite'y cząsteczek i bufory pełnoekranowe (winieta, promienie, mgła) są
  **prerenderowane** do offscreen canvas — w pętli gry wyłącznie `drawImage`.
- Pule obiektów o stałym rozmiarze — brak pracy dla garbage collectora podczas gry.
- **Adaptacyjna jakość**: system mierzy czas klatki (EMA) i na słabszym sprzęcie
  sam wyłącza najdroższe efekty pełnoekranowe, utrzymując płynność.
