# Thomas Johann Sieder – Portfolio

Mein Portfolio als interaktives Sonnensystem. Die Sonne ist der Start, jeder Bereich ist ein eigener Planet
mit eigener Oberfläche, Atmosphäre und Umlaufbahn, und jedes Projekt ist ein Mond seines Planeten.

Die Seite ist eine Reise: Beim Scrollen fliegt die Kamera von der Sonne zum ersten Planeten, kommt ihm näher,
während sein Inhalt daneben vorbeizieht, und fliegt beim Weiterscrollen zum nächsten.

| Nr. | Planet            | Welt         | Inhalt                                              |
| --- | ----------------- | ------------ | --------------------------------------------------- |
| 00  | Start             | Sonne        | Name, Begrüßung, Intro                              |
| 01  | Über mich         | Heimatwelt   | Text, Fakten, Links                                 |
| 02  | Skills            | Kristallwelt | Skills nach Bereich, mit den Projekten, die sie nutzen |
| 03  | Apps & Spiele     | Lavawelt     | Projekte der Kategorie App / Spiel (Monde)          |
| 04  | Web               | Gasriese     | Websites und Präsentationen (Monde)                 |
| 05  | Minecraft         | Blockwelt    | Shader, Resource Packs, Mods (Monde)                |
| 06  | Schule & Hardware | Platinenwelt | Facharbeit, Schulübungen, Experimente (Monde)       |
| 07  | Zeitleiste        | Ringplanet   | Alle Projekte nach Zeitraum, neueste zuerst         |
| 08  | Kontakt           | Eiswelt      | Links und Minecraft-Name                            |

Gebaut mit [Vite](https://vite.dev), TypeScript, [three.js](https://threejs.org) und [Lenis](https://lenis.darkroom.engineering)
(sanftes Scrollen). Alle Planeten, Wolken, Polarlichter, Ringe, die Sonne, der Nebel und die Sterne entstehen in
eigenen GLSL-Shadern, mit Bloom für alles, was leuchtet: Es gibt keine Bild- oder Modelldateien, die geladen werden
müssen. Schriften (Tektur, Inter, JetBrains Mono) werden über npm installiert und lokal ausgeliefert.

## Lokal starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18.18 (getestet mit 20.11) und npm.

```bash
npm install        # einmalig: Abhängigkeiten installieren
npm run dev        # Entwicklungsserver mit Live-Reload
```

Dann im Browser **http://localhost:5173** öffnen.

### Produktionsversion lokal testen

```bash
npm run build      # Typprüfung + optimierter Build nach dist/
npm run preview    # dist/ lokal ausliefern
```

Dann **http://localhost:4173** öffnen. `npm start` macht beides in einem Schritt und öffnet den Browser.

### Auf dem Handy im selben WLAN testen

```bash
npm run dev:lan
```

Vite zeigt danach eine Netzwerk-Adresse an (z. B. `http://192.168.x.x:5173`), die auf dem Handy geöffnet werden kann.

> Hinweis: `dist/index.html` lässt sich nicht per Doppelklick (`file://`) öffnen, weil Browser dort keine
> JavaScript-Module laden. Immer über `npm run preview` oder einen anderen lokalen Webserver starten.
> Der Build verwendet relative Pfade und läuft deshalb auch in einem Unterordner (z. B. GitHub Pages).

### Die 404-Seite testen

Unbekannte Pfade beantworten `npm run dev` und `npm run preview` wie ein echter Webserver mit der 404-Seite,
z. B. **http://localhost:5173/gibtsnicht**. Eine unbekannte Adresse innerhalb der Seite (z. B. `#/gibtsnicht`)
zeigt das 404-Fenster der App über dem Sonnensystem.

## Inhalte ändern

Alle Texte, Projekte, Skills und Links kommen aus **`portfolio-daten.txt`**. Gesucht wird die Datei hier
(in dieser Reihenfolge):

1. der Pfad in der Umgebungsvariable `PORTFOLIO_TXT`
2. `content/portfolio-daten.txt` in diesem Projekt
3. `../portfolio-daten.txt` (der Ordner über diesem Projekt)

Daraus wird `src/content/portfolio.json` erzeugt, und die Seite liest nur diese Datei.

- `npm run dev` und `npm run build` erzeugen die JSON automatisch. Während `npm run dev` läuft, reicht es, die
  Textdatei zu speichern: Die Seite lädt neu.
- `npm run content` erzeugt sie von Hand.
- Ist keine Textdatei vorhanden, wird die vorhandene `portfolio.json` verwendet. Ein frischer Klon baut also auch
  ohne die Textdatei.

Gelesen werden nur die Abschnitte **Über mich** und **Projekte**. Kopfzeilen mit Quellenangaben und der Abschnitt
„Noch offen / fehlt“ landen weder in der JSON noch auf der Seite. `content/*.txt` ist in `.gitignore` eingetragen,
damit diese Notizen nicht mit ins Repository kommen.

Felder, die in der Textdatei als „Noch leer“ markiert sind, zeigt die Seite bei jedem Projekt gestrichelt unter
**Noch offen** an.

### Planeten und Kategorien

Welcher Planet ein Projekt bekommt, ergibt sich aus seiner `Kategorie` (`src/content/index.ts`, `groupOf`):

- enthält „Website“, „Präsentation“ oder „Web“ → **Web**
- sonst enthält „Minecraft“ → **Minecraft**
- sonst enthält „App“, „Spiel“ oder „Flutter“ → **Apps & Spiele**
- alles andere → **Schule & Hardware**

Name, Farbe und Aussehen der Planeten stehen in `src/config/sections.ts`.

### Bilder

Die Textdatei nennt Bilder mit Pfad, z. B. `assets/projects/omnicraft/pack-icon-wappenschild.png`. Liegt die
Datei unter `public/` (also `public/assets/projects/omnicraft/pack-icon-wappenschild.png`), erscheint sie beim
Projekt. Fehlt sie, steht dort „Noch nicht hinterlegt“ mit der Beschreibung aus der Textdatei.

### Wortlaut „Inseln“ → „Planeten“

Drei Sätze der Textdatei stammen aus einer früheren Version mit Inseln („Willkommen auf meinen Inseln!“ usw.).
Auf dieser Seite sprechen sie von Planeten. Die Ersetzungen stehen in `src/content/index.ts` (`WORDING`) und
greifen nur bei genau diesen Originalsätzen. Ändert sich der Text in der Datei, wird der neue Text verwendet.

## Bedienung

| Eingabe                        | Wirkung                                          |
| ------------------------------ | ------------------------------------------------ |
| Scrollen / Wischen             | weiterfliegen: näher an den Planeten, dann zum nächsten |
| Klick / Tippen auf Planet, Dock | direkt dorthin fliegen                          |
| Klick auf Mond oder Projektkarte | Projekt öffnen (Schublade rechts bzw. unten)   |
| `←` `→`                        | vorheriger / nächster Planet                     |
| `0` – `8`                      | Start bzw. Planet direkt                         |
| `Esc`                          | Projekt schließen bzw. zurück zum Start          |
| `M`                            | Menü                                             |
| Seitwärts ziehen               | System bzw. Blick um den Planeten drehen         |
| Klick / Tippen auf ein Raumschiff | Minispiel „Sternenschwarm“ (auch über `#/spiel`) |

Ton ist standardmäßig aus und lässt sich oben rechts einschalten (die Klänge werden live per Web Audio erzeugt).

### Ladebildschirm, Intro, Hyperraum, Raumschlacht und Minispiel

- **Ladebildschirm:** steht schon in `index.html` und ist damit ab dem ersten Bild da, bevor das Skript geladen
  ist: Sterne ziehen vorbei, der Name erscheint, und sobald das Skript läuft, kommen die acht Planeten auf ihren
  (verkleinerten) echten Bahnen dazu und leuchten nacheinander auf, während die Szene aufgebaut wird. Darunter
  Fortschritt in Prozent und der aktuelle Schritt. Alles, was sich bewegt, läuft über CSS (`transform`/`opacity`)
  und ruckelt deshalb nicht, während der Browser Shader kompiliert. Am Ende springt der Bildschirm in den
  Hyperraum, und die Szene fällt aus ihm heraus. Dauert das Laden länger als 12 Sekunden, steht ein Hinweis da;
  kommt ein Skript nicht an oder schlägt der Start fehl, gibt es eine Meldung mit „Neu laden“.
- **Intro:** Die Kamera fällt aus dem Hyperraum ins System. Danach leuchten am Himmel Sterne auf, ziehen in einem
  Wirbel zusammen und schreiben den Namen von links nach rechts; er steht kurz als Sternbild am Himmel, dann
  übernimmt die Überschrift an genau derselben Stelle (die Sterne fliegen zu Punkten, die aus der echten
  Überschrift abgetastet werden, `src/three/nameIntro.ts`). Scrollen überspringt das Intro.
- **Angezeigter Name:** Die Seite zeigt nur den Nachnamen aus `Name:` der Textdatei (`src/content/index.ts`,
  für den Seitentitel auch `vite.config.ts`).
- **Hyperraum:** nur bei schnellem Scrollen (oder einem Sprung über mehrere Planeten): Die Sterne werden zu
  Streifen, das Bild verschwimmt zum Fluchtpunkt hin, mit einem Blitz beim Ein- und Austritt
  (`src/three/hyperspace.ts`). Ruhiges Scrollen und der Flug zum Nachbarplaneten bleiben im normalen Raum. Die
  Schwelle steht in `src/three/universe.ts` (`updateWarp`).
- **Raumschlacht:** Zwei Fraktionen mit eigenen Jäger- und Großkampfschiff-Entwürfen kämpfen im Hintergrund
  (`src/three/fleet.ts`). Zeigt man auf ein Schiff, läuft der Kampf langsamer.
- **Minispiel:** `src/game/shooter.ts`, ein Weltraum-Shooter mit Alien-Wellen, Power-ups und einer Schwarmkönigin
  in jeder fünften Welle. Wird erst beim Öffnen nachgeladen; der Rekord wird im Browser gespeichert.

Mit „Bewegung reduzieren“ gibt es kein Intro, keinen Hyperraum und keine Schlacht; das Spiel bleibt über das
Menü („Minispiel“) und auf dem Desktop über den Link im Hero erreichbar.

### Planeten-Datenblatt und 404

- **Datenblatt:** Die Inhalte jedes Planeten stehen auf einem kantigen Panel wie auf einem Bordbildschirm:
  Kennung und Messwerte (Umlaufbahn, Radius, Monde aus `src/config/sections.ts`), große Nummer, Name in Tektur,
  darunter ein Lineal in der Farbe des Planeten. Fakten als Datenzellen, Projekte als Monde mit Nummer.
- **404 auf dem Server:** `public/404.html` wird von GitHub Pages, Netlify, Vercel und den meisten Hostern für
  unbekannte Pfade ausgeliefert. Weil sie in jeder Ordnertiefe erscheinen kann, ist sie komplett eigenständig
  (Styles, Skript und Grafik inline, Systemschriften). Den Weg zur Startseite sucht sie selbst: Sie fragt die
  Ordner über der Adresse ab und nimmt den tiefsten, der die Startseite liefert (erkannt an `id="journey"` in
  `index.html`).
- **404 in der Seite:** Eine unbekannte Adresse wie `#/gibtsnicht` öffnet ein 404-Fenster über dem
  Sonnensystem, mit Wegen zur Sonne, zum Minispiel und zu jedem Planeten (`Esc` schließt es). Ein Link auf ein
  Projekt, das der Planet nicht hat (`#/web/gibtsnicht`), fliegt zum Planeten und sagt es kurz an.

## Barrierefreiheit und Leistung

- Alle Inhalte sind normales HTML (Überschriften, Listen, Links), die 3D-Szene ist nur Kulisse.
- Tastatur-Navigation mit sichtbarem Fokus, Sprunglink zum Inhalt, Menü mit Fokusfalle.
- „Bewegung reduzieren“ im System wird beachtet: kein sanftes Nachgleiten, Sprünge statt Flüge, keine
  Buchstaben-Animationen.
- Ohne WebGL bleibt die Seite vollständig nutzbar (Sternenhimmel in CSS, Planeten im Dock als Farbverläufe).
- Ein gemeinsames Shader-Programm für alle Planeten und Monde, Nebel nur einmal beim Start berechnet.
- Bloom nur auf Rechnern mit genug Leistung (nicht auf Handys). Die Auflösung passt sich der Bildrate an.
  Im Hintergrund-Tab wird nicht gerendert.

## Projektstruktur

```
index.html                 Grundgerüst der Seite, mit dem Ladebildschirm
scripts/
  build-content.mjs        npm run content
  content/parse.mjs        liest portfolio-daten.txt
  content/generate.mjs     schreibt src/content/portfolio.json
src/
  main.ts                  Einstieg (Schriften, Styles, App)
  content/                 Daten aus der Textdatei, Zeitleiste, Skill-Zuordnung
  config/sections.ts       die acht Planeten: Name, Farbe, Oberfläche, Umlaufbahn
  three/                   3D: Shader, Planeten, Monde, Sonne, Himmel, Kamera, Hyperraum, Raumschlacht, Intro
  ui/                      Oberfläche: Scroll-Reise, Hero, Karten, Projekt-Schublade, Dock, Labels, Menü, Ton
  game/                    das Minispiel (wird nachgeladen)
  styles/main.css          Gestaltung
public/                    statische Dateien (Favicon, 404.html, Projektbilder unter assets/)
```
