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

Wskocz wrogowi na głowę, aby go pokonać — kolejne trafienia w krótkim czasie budują
**serię** i mnożą punkty. Zderzenie z boku kosztuje życie.

## Efekty wizualne („juice”)

- **Cząsteczki** (pula 512, zero alokacji w pętli gry): kurz spod stóp i przy lądowaniu,
  obłoczek skoku, złote iskry przy pokonaniu wroga, czerwone drobinki przy trafieniu,
  liście niesione wiatrem, zimne smużki za duchami, smugi prędkości przy rozpędzonej grze.
- **Kamera**: screen shake sterowany „traumą” (kwadratowo — małe uderzenia są subtelne),
  hit-stop przy trafieniach, slow-motion przy utracie ostatniego życia.
- **Postać**: squash & stretch przy skoku i lądowaniu, echo sylwetki w powietrzu,
  miękkie cienie pod postaciami.
- **Atmosfera**: promienie światła przez las, świetliki przy ziemi, dwie wstęgi mgły,
  winieta z ciepłą korekcją koloru, fale uderzeniowe i pływające napisy (+10, SERIA x3!).
- **UI**: szklane panele HUD, licznik serii, animowane ekrany startu i końca gry.

## Architektura

```
game/
├── index.html        – logika gry (komponent DC): pętla, fizyka, kolizje, rysowanie
├── effects.js        – FXSystem: cząsteczki, kamera, ambient, nakładki ekranowe
├── spriteAnimator.js – data-driven animator spritesheetów (stany, klatki, przejścia)
├── support.js        – wygenerowany runtime DC (nie edytować ręcznie)
└── layers/           – grafika: warstwy paralaksy + spritesheety postaci i wrogów
```

## Wydajność

- Sprite'y cząsteczek i bufory pełnoekranowe (winieta, promienie, mgła) są
  **prerenderowane** do offscreen canvas — w pętli gry wyłącznie `drawImage`.
- Pule obiektów o stałym rozmiarze — brak pracy dla garbage collectora podczas gry.
- **Adaptacyjna jakość**: system mierzy czas klatki (EMA) i na słabszym sprzęcie
  sam wyłącza najdroższe efekty pełnoekranowe, utrzymując płynność.
