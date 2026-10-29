# Laboratorio: síntesis ligera en el navegador

Material de estudio para valorar SpessaSynth (spessasynth_lib / spessasynth_core) como fuente de sonido
de un visor web de partituras. El informe con las conclusiones está en
[`../INFORME-LAB-SINTESIS-LIGERA.md`](../INFORME-LAB-SINTESIS-LIGERA.md).

No se sube ningún soundfont, MIDI ni audio: los scripts los descargan o generan en `.cache/` y `midi/`
(ignorados por git). Solo se suben los scripts, la demo y los resultados numéricos (`resultados/*.json`).

## Requisitos

- Node 22 y `npm install` en la raíz del repositorio (trae spessasynth_lib, spessasynth_core y wasm-media-encoders).
- Python 3 con `music21` (`pip install music21`) para generar los MIDI desde su corpus.
- Playwright con Chromium para las medidas (`npx playwright install chromium` si no lo tienes).

## Pasos

Desde la raíz del repositorio:

```bash
lab-sintesis-ligera/scripts/fetch_soundfonts.sh
```

```bash
python3 -I lab-sintesis-ligera/scripts/make_midis.py lab-sintesis-ligera/midi
```

```bash
node lab-sintesis-ligera/scripts/sf_stats.mjs
```

```bash
node lab-sintesis-ligera/scripts/bench_chromium.mjs
```

El último acepta grupos sueltos: `offline bloques memoria tiemporeal temporizado sincronia`.

## Demo

```bash
node lab-sintesis-ligera/scripts/serve.mjs 8123
```

Abre `http://127.0.0.1:8123/lab-sintesis-ligera/demo/index.html`. La barra simula la línea de tiempo
del visor; se puede cambiar la velocidad, saltar con un clic y elegir quién manda (el audio o el reloj del visor).

## Ficheros

| Fichero                                   | Qué hace                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `scripts/fetch_soundfonts.sh`             | Descarga GeneralUser GS, FluidR3Mono (MuseScore 3.6.2) y TimGM6mb con sus licencias                   |
| `scripts/make_midis.py`, `scripts/smf.py` | MIDI orquestal (Bach BWV 248/64), de cámara (Beethoven op. 18/1), estrés sintético, clics y metrónomo |
| `scripts/sf_stats.mjs`                    | Estructura por familia de cada soundfont y recortes por obra (`.cache/recortes/*.sf3`)                |
| `scripts/bench_chromium.mjs`              | Lanza Chromium headless y ejecuta las medidas de `demo/bench.js`                                      |
| `scripts/serve.mjs`                       | Servidor estático con COOP/COEP                                                                       |
| `demo/bench.html`, `demo/bench.js`        | Funciones de medida (worklet offline, bloques de 128, tiempo real, temporizado, sincronía)            |
| `demo/recorder-worklet.js`                | Graba la salida de audio con su número de frame, para la prueba de sincronía                          |
| `demo/index.html`, `demo/demo.js`         | Demo interactiva                                                                                      |
| `resultados/*.json`                       | Salida en bruto de las medidas citadas en el informe                                                  |
