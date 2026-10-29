# Informe: síntesis ligera en el navegador con SpessaSynth

Rama `lab-sintesis-ligera` del fork `repepone/spessasynth`, solo para estudio. Fecha de las medidas: 29-10-2026.

## Resumen en llano

- SpessaSynth se puede usar y redistribuir: es Apache-2.0, y lo mismo sus dos librerías (`spessasynth_lib` y `spessasynth_core`).
- El soundfont que mejor encaja es **GeneralUser GS** en formato comprimido (SF3). Completo pesa 8 MB. **Recortado a los instrumentos de cada obra** baja a 0,6–0,8 MB en las dos obras de prueba.
- Gasta poca CPU. En esta máquina, una obra orquestal barroca (Bach) y un cuarteto (Beethoven) se generan entre 36 y 45 veces más rápido que el tiempo real. En reproducción, la pestaña consume un 8–9 % de un núcleo. Un tutti artificial muy denso sube al 30 %.
- En memoria añade entre 20 y 55 MB a la pestaña, según el soundfont.
- **No coloca cada nota en la muestra exacta.** Las notas suenan al comienzo de bloques de 128 muestras. Eso supone hasta 2,9 ms de imprecisión, igual para todas.
- El tempo se puede cambiar en vivo (`playbackRate`), y también saltar a otro punto.
- Para seguir a un reloj externo, como la línea de tiempo del visor, hace falta un pequeño bucle de corrección. Sin él, la diferencia creció hasta 130–200 ms en 24 s. Con él se quedó por debajo de 32 ms. Ojo: estas cifras salen de Chromium sin pantalla ni tarjeta de sonido real.
- Lo más sencillo es que mande el audio y el visor dibuje el tiempo del secuenciador.
- La calidad de sonido por familia **no se ha escuchado**. Solo hay datos de cómo están construidos los instrumentos.

## Cómo leer este informe

- **«leído»**: lo he leído en un fichero, una licencia o el código fuente. Se cita la ruta.
- **«medido»**: es la salida de un script de este laboratorio, en este entorno. Los datos en bruto están en `lab-sintesis-ligera/resultados/*.json`. Las tablas completas se generaron con `scripts/tablas.mjs` y están en `lab-sintesis-ligera/resultados/tablas.md`.
- **«inferencia»**: es una deducción mía que no he comprobado. Las que importan se repiten en la lista «SIN MEDIR».

**Entorno de medida** (medido): procesador Intel Xeon a 2,10 GHz con 4 núcleos virtuales y 16 GB de RAM; Chromium 153.0.8010.12 en modo headless (Playwright, `channel: "chromium"`); Node 22.22.0; spessasynth_core 4.4.2 y spessasynth_lib 4.4.1 (leído: `node_modules/*/package.json`). Chromium headless usa un **dispositivo de audio falso**: no hay tarjeta de sonido.

**Límite de red** (medido): desde el contenedor solo respondían `raw.githubusercontent.com`, PyPI y npm. Fallaron schristiancollins.com, ftp.osuosl.org (MuseScore_General), deb.debian.org, archive.org, mutopiaproject.org y la API de GitHub. Por eso faltan algunos candidatos (ver «SIN MEDIR»).

---

## 0. Licencia de SpessaSynth

- El fichero `LICENSE` de la raíz es la **Apache License 2.0** (leído: `LICENSE`, líneas 1-3). El README dice «Copyright © 2026 Spessasus. Licensed under the Apache-2.0 License» (leído: `README.md`, sección _License_).
- `spessasynth_core` y `spessasynth_lib`, las dos piezas que usaría el visor, son también Apache-2.0 (leído: `node_modules/spessasynth_core/LICENSE`, `node_modules/spessasynth_lib/LICENSE` y el campo `license` de sus `package.json`).
- Lo que va dentro del procesador de audio también es libre: el decodificador `stb-vorbis` es Apache-2.0 y `fflate` es MIT (leído: `node_modules/stb-vorbis/package.json`, `node_modules/fflate/package.json`). `wasm-media-encoders`, usado aquí solo para recomprimir soundfonts, es MIT (leído: su `package.json`).
- Condiciones para redistribuir según la cláusula 4 (leído: `LICENSE`, líneas 90-122): entregar una copia de la licencia, marcar los ficheros modificados, conservar los avisos de copyright y, si existiera un fichero NOTICE, reproducir sus avisos. En el repositorio y en las dos librerías **no hay fichero NOTICE** (leído: listado de la raíz y de `node_modules/spessasynth_*`).
- El README añade una licencia BSD-2 para `src/website/js/renderer/base/waveform_trigger.ts`, que procede de corscope (leído: `README.md`, sección _Third-party licenses_). Ese fichero pertenece a la aplicación web, no a las librerías que usaría el visor.

## 1. Soundfonts gratuitos y redistribuibles

### 1.1 Licencias leídas en su fuente

| Soundfont                                           | De dónde se obtuvo                                                                                               | Licencia (leída)                                                                           | Qué dice, en corto                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GeneralUser GS 2.0.3** (S. Christian Collins)     | `raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/` (`GeneralUser-GS.sf2` y `documentation/LICENSE.txt`) | Licencia propia v2.0 (leído: `LICENSE.txt` y también el campo ICMT dentro del propio .sf2) | Uso sin restricción, también comercial. «Please feel free to use it in your software projects, and to modify the SoundFont bank or its packaging». Pide no enlazar directamente sus descargas: alojar una copia propia o enlazar a su web. Advierte que no puede garantizar al 100 % el origen de todas las muestras, aunque ninguna procede de bancos comerciales. |
| GeneralUserGS.sf3 (el que trae este repo)           | `soundfonts/GeneralUserGS.sf3`                                                                                   | La misma (leído: campos ICMT/ICOP del fichero)                                             | Es GeneralUser GS 2.0.3 comprimido por SpessaSynth (leído: ISFT = «SpessaSynth»). Tiene los mismos 287 presets y 920 muestras que el .sf2 (medido: `sf_stats.json`). El README dice que la app lo trae incluido (leído: `README.md`, línea 86).                                                                                                                     |
| **FluidR3Mono_GM.sf3** (versión de MuseScore 3.6.2) | `raw.githubusercontent.com/musescore/MuseScore/v3.6.2/share/sound/` (fichero y `FluidR3Mono_License.md`)         | MIT (leído: `FluidR3Mono_License.md` y ICMT interno)                                       | Su nombre interno es «MS_General v0.1» (leído). Es una derivación de FluidR3 (Frank Wen, MIT) hecha por M. Cowgill y S. C. Collins. La licencia avisa de que la de esta colección «is currently under discussion and may be subject to change before release». Obliga a conservar los avisos de copyright.                                                          |
| TimGM6mb.sf2                                        | Rueda de `pretty_midi` 0.2.11.post0 en PyPI                                                                      | **No leída en su fuente**                                                                  | La rueda solo trae la licencia MIT de pretty_midi (leído: `LICENSE.txt` de la rueda), que cubre el código y no el soundfont. Dentro del .sf2 no hay campo de copyright (leído: bloque INFO). La fuente original (paquete de Debian) no era accesible. Tratar como **no apto** hasta leerla.                                                                         |

Los MIDI de prueba salen del corpus de music21. Su licencia dice que algunas codificaciones «may not be used for commercial uses or have other restrictions» (leído: `music21/corpus/license.txt`). Por eso **no se suben**: el script los regenera.

### 1.2 Peso (medido: `resultados/sf_stats.json`)

| Fichero            | Tamaño  | Presets | Muestras | Formato     |
| ------------------ | ------- | ------- | -------- | ----------- |
| GeneralUser-GS.sf2 | 30,8 MB | 287     | 920      | PCM 16 bits |
| GeneralUserGS.sf3  | 8,0 MB  | 287     | 920      | Vorbis      |
| FluidR3Mono_GM.sf3 | 22,6 MB | 197     | 1186     | Vorbis      |
| TimGM6mb.sf2       | 5,7 MB  | 136     | 520      | PCM 16 bits |

**Recorte por obra.** `BasicSoundBank.trim(midi.getUsedProgramsAndKeys(bank))` deja solo los presets y las teclas que usa el MIDI (leído: `spessasynth_core/dist/index.d.ts`, ejemplo de `writeRMIDI`). Resultado (medido: `.cache/recortes/`, `sf_stats.json`):

| Recorte                                                 | Presets | KB SF3   |
| ------------------------------------------------------- | ------- | -------- |
| GeneralUserGS → Bach BWV 248/64 (15 partes)             | 8       | 812      |
| GeneralUserGS → Beethoven op. 18/1, I                   | 3       | 613      |
| FluidR3Mono → Bach                                      | 8       | 913      |
| FluidR3Mono → Beethoven                                 | 3       | 546      |
| TimGM6mb → Bach / Beethoven (recomprimido Vorbis q=0,5) | 8 / 3   | 249 / 47 |

Partiendo del .sf2 de GeneralUser y recomprimiendo con Vorbis q=0,5, los recortes pesan casi lo mismo que desde el .sf3 del repo: 811 y 612 KB (medido).

### 1.3 Calidad por familia: solo datos de construcción, nada escuchado

**No he podido escuchar nada.** Lo que sigue son indicadores objetivos de cómo está hecho cada instrumento, no juicios de sonido. Están medidos con `sf_stats.mjs`, que recorre las zonas de cada preset GM:

- más muestras por preset suele significar más notas grabadas;
- más segundos de audio, menos dependencia de bucles cortos;
- más capas de velocidad, cambios de timbre entre piano y forte;
- la frecuencia de muestreo mínima (fs) limita los agudos a fs/2.

Familias: cuerda = programas GM 40-45 y 48-49; viento madera = 68-74; metal = 56-61; percusión = 8, 9, 13, 14, 47 más los kits de batería 0 y 48 (orquestal); piano = 0-1; guitarra = 24-25.

| Familia       | GeneralUser GS (sf2 = sf3)                                                                                        | FluidR3Mono (MS_General)                                                                         | TimGM6mb                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Cuerda        | 4–23 muestras por preset; 3–38 s de audio por preset; fs mín. 15 kHz; 1 capa de velocidad                         | 13–22 muestras; 16–44 s; fs mín. 22 kHz; 1 capa                                                  | 3–16 muestras; **0,1–0,3 s** en violín, viola, chelo, contrabajo y pizzicato; fs mín. **12 kHz** |
| Viento madera | 5–20 muestras; 1,5–12,6 s; fs mín. 16,8 kHz                                                                       | 7–14 muestras; 3,4–14 s; fs mín. 22 kHz                                                          | 3–10 muestras; 0,1–0,3 s en 5 de 7 presets                                                       |
| Metal         | 6–19 muestras; 1,9–10,4 s; fs mín. 11 kHz                                                                         | 6–13 muestras; 2,2–40 s; fs mín. 32 kHz                                                          | 4–22 muestras; 0,3 s en 3 de 6 presets                                                           |
| Percusión     | Timbal con **20** zonas de velocidad; kits estándar y orquestal con 65 y 56 muestras; fs mín. 8 kHz (algún golpe) | Timbal con 3 muestras y 1 capa; kits con 60 y 44 muestras                                        | Timbal con 1 muestra de 0,2 s                                                                    |
| Piano         | 17 muestras; 33,7 s; 0,67 MB en el sf3                                                                            | 145 muestras; **1138 s**; 9,4 MB en el fichero; **≈200 MB por preset al descomprimir** a Float32 | 9 muestras; 4,1 s; fs 22 kHz                                                                     |
| Guitarra      | 10–12 muestras; 4,9–7,1 s                                                                                         | 10 muestras; 19–24 s                                                                             | 7–8 muestras; 0,4 s                                                                              |

Nota sobre el «≈200 MB»: el código guarda las muestras decodificadas como `Float32Array` (leído: `audioData?: Float32Array` en `BasicSample`, `spessasynth_core/dist/index.d.ts`). Multiplicar fotogramas × 4 bytes da 200,7 MB para el preset 0 (medido el número de fotogramas, calculada la multiplicación). En el Bach no se usa piano, así que esto no aparece en las medidas de memoria del apartado 2.

Inferencia (no medido): TimGM6mb tiene cuerdas con bucles de 0,1–0,3 s y fs de 12 kHz. Lo previsible es un timbre pobre y apagado en la cuerda, que es justo la familia que más pesa en repertorio orquestal y de cámara.

## 2. Coste de CPU y memoria en Chromium headless

**Obras de prueba** (medido: `midi/midis.json`, generadas por `make_midis.py` desde el corpus de music21):

- **Orquestal**: J. S. Bach, Oratorio de Navidad BWV 248, nº 64. Tres trompetas, timbal, dos oboes, cuerda, coro SATB y continuo (chelo y contrabajo): 15 canales, 4593 notas, 205 s a negra = 80.
- **Cámara**: L. v. Beethoven, cuarteto op. 18 nº 1, primer movimiento: 4 canales, 4051 notas, 336 s a negra = 168.
- **Estrés sintético** (no es música): 15 canales con acordes de 4 notas cada corchea durante 60 s. Sirve para buscar el techo.

Los programas GM del Bach se asignaron a mano porque music21 los asignaba mal (medido: ponía guitarra a las trompetas).

### 2.1 Reproducción real durante 30 s (medido: `bench_tiemporeal.json`)

Montaje: `AudioContext` + `WorkletSynthesizer` + `Sequencer`. Las cifras son % de un núcleo: tiempo de CPU de cada proceso de Chromium dividido por 30 s.

| Caso                                     | Proceso de la pestaña | Servicio de audio | Total Chromium | Voces máx.                    |
| ---------------------------------------- | --------------------- | ----------------- | -------------- | ----------------------------- |
| Página sin audio                         | 0,3 %                 | 0,0 %             | 0,8 %          | —                             |
| Sintetizador cargado **sin notas**       | 5,9 %                 | 1,6 %             | 7,8 %          | 0                             |
| Bach, GeneralUserGS.sf3                  | 8,7 %                 | 1,6 %             | 10,5 %         | 45                            |
| Bach, GeneralUserGS recortado            | 8,4 %                 | 1,6 %             | 10,2 %         | 48                            |
| Bach, FluidR3Mono                        | 8,5 %                 | 1,5 %             | 10,2 %         | 38                            |
| Bach, TimGM6mb                           | 8,6 %                 | 1,5 %             | 10,3 %         | 39                            |
| Bach, sin efectos + interpolación lineal | 7,7 %                 | 1,7 %             | 9,5 %          | 49                            |
| Beethoven, GeneralUserGS.sf3             | 7,6 %                 | 1,6 %             | 9,3 %          | 27                            |
| Beethoven, FluidR3Mono                   | 7,7 %                 | 1,6 %             | 9,5 %          | 24                            |
| Estrés sintético                         | 29,7 %                | 1,7 %             | 31,6 %         | **350** (el tope por defecto) |

- El sintetizador cuesta un 5,9 % aunque no suene nada (medido).
- El tope de 350 voces es el valor por defecto de `voiceCap` (leído: `DEFAULT_GLOBAL_SYSTEM_PARAMETERS` en `spessasynth_core/dist/index.js`).
- Cargar el soundfont llevó 130 ms con GeneralUserGS.sf3 completo y 34 ms con el recorte para el Bach (medido).

### 2.2 Render offline de la obra entera (medido: `bench_offline.json`)

El mismo AudioWorklet en un `OfflineAudioContext`, a la máxima velocidad posible.

| Obra              | GeneralUserGS.sf3 | GeneralUser-GS.sf2 | FluidR3Mono | TimGM6mb | GU recortado |
| ----------------- | ----------------- | ------------------ | ----------- | -------- | ------------ |
| Bach (205 s)      | 36,5×             | 36,9×              | 42,5×       | 36,2×    | 38,4×        |
| Beethoven (336 s) | 44,8×             | 44,9×              | 48,5×       | 45,7×    | 43,2×        |
| Estrés (62 s)     | 3,9×              | 4,0×               | 6,2×        | 3,9×     | —            |

«36,5×» quiere decir que 205 s de música se generaron en 5,6 s, es decir, un 2,7 % de un núcleo (medido). El estrés en offline usa voces ilimitadas; lo fija el propio código (leído: `autoAllocateVoices = true` en `startOfflineRender`, código fuente en `spessasynth_processor.min.js.map`).

### 2.3 Coste de cada bloque y equipo modesto emulado (medido: `bench_bloques.json`)

Un AudioWorklet tiene **2,90 ms** para producir cada bloque de 128 muestras a 44,1 kHz. Si tarda más, se oye un corte. Para cronometrar bloque a bloque, el núcleo (`spessasynth_core`) se ejecutó en el hilo principal de la página con bloques de 128. El render offline (A) y este bucle (B) dan las mismas posiciones de nota (ver 3.1), lo que indica que es el mismo motor.

Para imitar un equipo modesto se usó la ralentización de CPU de las DevTools (`Emulation.setCPUThrottlingRate`) a 4× y 6×. Es una emulación y **no un equipo real**.

| Obra           | Ajustes                         | CPU    | Carga media | p99     | Bloques que superan 2,9 ms    |
| -------------- | ------------------------------- | ------ | ----------- | ------- | ----------------------------- |
| Bach, GU sf3   | efectos + hermite (por defecto) | 1×     | 1,9 %       | 0,17 ms | 0 de 70 629                   |
| Bach, GU sf3   | sin efectos + lineal            | 1×     | 1,0 %       | 0,09 ms | 0                             |
| Bach, GU sf3   | por defecto                     | **6×** | 12,4 %      | 2,10 ms | 263 (0,37 %)                  |
| Bach, GU sf3   | sin efectos + lineal            | **6×** | 7,3 %       | 1,91 ms | 189 (0,27 %)                  |
| Estrés, GU sf3 | por defecto (350 voces)         | 1×     | 15,4 %      | 1,09 ms | 26 (0,12 %)                   |
| Estrés, GU sf3 | máx. 64 voces                   | 1×     | 3,5 %       | 0,38 ms | 7 (0,03 %)                    |
| Estrés, GU sf3 | por defecto                     | **4×** | 72,1 %      | 5,01 ms | 2721 (12,8 %)                 |
| Estrés, GU sf3 | por defecto                     | **6×** | 105,9 %     | 8,22 ms | 10 829 (50,9 %): no da abasto |

- Los máximos aislados (de 2 a 99 ms según el caso) aparecen incluso a 1×. Inferencia: probablemente son pausas del recolector de basura o del propio hilo principal, que en un AudioWorklet real no compite con la página igual. Ver «SIN MEDIR».
- Con el cuarteto, ningún soundfont superó una carga media del 1,5 % a 1× (medido).

### 2.4 Memoria (medido: `bench_memoria.json`)

Medida tras forzar la recolección de basura, con el sintetizador vivo después de cargar la obra y generar 5 s. Montón JS y búfer de datos binarios (`ArrayBuffer`) según `Runtime.getHeapUsage` de Chromium; memoria residente (RSS) del proceso de la pestaña según `/proc`.

| Soundfont (obra Bach)     | Montón JS | ArrayBuffers (muestras) | RSS de la pestaña |
| ------------------------- | --------- | ----------------------- | ----------------- |
| Página vacía (referencia) | 3,1 MB    | —                       | 135,0 MB          |
| GeneralUserGS recortado   | 6,5 MB    | 15,8 MB                 | 158,9 MB          |
| TimGM6mb                  | 7,9 MB    | 15,3 MB                 | 168,9 MB          |
| GeneralUserGS.sf3         | 8,6 MB    | 22,8 MB                 | 180,4 MB          |
| FluidR3Mono               | 8,0 MB    | 42,4 MB                 | 189,4 MB          |
| GeneralUser-GS.sf2        | 8,5 MB    | 45,5 MB                 | 189,3 MB          |

Con Beethoven las cifras son parecidas: entre 156,5 y 187,7 MB de RSS (medido). Solo se decodifican las muestras que la obra usa: el secuenciador las «precarga» al cargar el MIDI (leído: comentario de `Sequencer.midiData` en `spessasynth_lib/dist/index.d.ts`).

## 3. Temporizado y sincronía con un reloj externo

### 3.1 ¿Programa a la muestra exacta? No: a bloques de 128 muestras

**Lo leído en el código:**

- `SpessaSynthProcessor.process()` vacía la cola de eventos solo al **empezar** cada llamada: `while (this.eventQueue[0]?.time <= time)`. Después genera el bloque entero (leído: `spessasynth_core/dist/index.js`, cerca de la línea 42003).
- El secuenciador (`processTick`) se ejecuta una vez por bloque y lanza todos los eventos con `playedTime < currentTime` (leído: `index.js`, línea 14480). El AudioWorklet llama a `processTick()` y luego a `process()` una vez por cada bloque de Web Audio (leído: `worklet_synthesizer_core.ts` y `basic_synthesizer_core.ts` en el sourcemap del procesador).
- El README de core recomienda bloques pequeños porque el bloque es también el intervalo de actualización de moduladores y LFO (leído: `node_modules/spessasynth_core/README.md`, ejemplo de render).

**Lo medido** (`bench_temporizado.json`): clics de wood block en instantes conocidos, situados a propósito fuera de las fronteras de bloque. Se detectó el ataque de cada clic en el audio generado. Todo a 44,1 kHz, donde 128 muestras son 2,9 ms.

| Prueba                                                       | Clics | Error frente al ideal (muestras) | Fases distintas módulo 128                 |
| ------------------------------------------------------------ | ----- | -------------------------------- | ------------------------------------------ |
| Secuenciador, AudioWorklet offline                           | 40/40 | de −122,6 a 0                    | **1**: todos alineados a la rejilla de 128 |
| Secuenciador, núcleo en bloques de 128                       | 40/40 | idéntico al anterior             | 1                                          |
| Secuenciador, núcleo en bloques de **1** muestra             | 40/40 | de −1 a 0                        | 40                                         |
| `noteOn(..., {time})` sin secuenciador, AudioWorklet offline | 30/30 | de −98,4 a +28,3                 | 1                                          |
| Igual, núcleo en bloques de 1                                | 30/30 | de −0,9 a 0                      | 30                                         |

- **La imprecisión es de hasta 128 muestras (2,9 ms), siempre por retraso:** cada nota espera a la siguiente frontera de bloque. Esto incluye los MIDI con cambios de tempo internos: el MIDI de prueba pasa de negra 120 a negra 90 a mitad y no hubo diferencia (medido).
- Con bloques de 128, el primer ataque aparece además unas 36 muestras más tarde que con bloques de 1 (medido: retardo de 172 frente a 8 muestras en el secuenciador y de 143 frente a 8 programando directamente). Es una diferencia constante. Inferencia, no verificada: viene del cálculo de envolventes por bloque.
- `synth.noteOn(canal, nota, vel, {time})` sí funciona en el AudioWorklet de un `OfflineAudioContext` (medido). Esto a pesar del aviso de la propia librería de que Chromium puede ignorar esos mensajes (leído: comentario de `startOfflineRender`). En la prueba se esperaron 300 ms antes de generar.
- El bloque de Web Audio es de 128 muestras fijas en este Chromium. Inferencia: en Web Audio el bloque es de 128 por defecto y no lo configuré, así que con el AudioWorklet no hay forma de bajar a 1 muestra. Bloques de 1 solo son posibles usando el núcleo fuera de Web Audio.

### 3.2 Cambios de tempo en vivo y saltos

- **Sí se puede.** `Sequencer.playbackRate` cambia la velocidad en vivo y `Sequencer.currentTime = t` salta (leído: `spessasynth_lib/dist/index.d.ts`). En el núcleo, el tiempo del secuenciador es `(synth.currentTime − absoluteStartTime) × playbackRate`; cambiar `playbackRate` recalcula el origen para que no haya salto (leído: `index.js`, líneas 14954-14967 y 15170).
- `playbackRate` escala el tiempo de los eventos, no la altura de las notas (leído: `processTick` solo compara tiempos). Es un multiplicador sobre todo el mapa de tempos del MIDI, no un BPM absoluto. Para fijar un BPM hay que dividirlo por `sequencer.currentTempo` (leído: getter `currentTempo`).
- **Medido**: cambio a 1,5× a los 5,0 s de audio dentro del núcleo. Se aplicó en la muestra 220 544, la primera frontera de bloque después de 220 500. Los 120 clics siguieron alineados a la rejilla de 128 (error de −112 a +12 muestras, 1 fase).

### 3.3 Sincronía con un reloj que no es el suyo (medido: `bench_sincronia.json`)

**Montaje:**

- Un `AudioContext` real (con el dispositivo falso de headless) toca un metrónomo de un clic cada 0,5 s de música.
- Un «visor» simulado lleva su propio reloj, basado en `performance.now()`. Pasa a velocidad 1,25 a los 8 s, a 0,8 a los 16 s y salta al segundo musical 40 a los 20 s.
- Se graba la salida con un AudioWorklet grabador. Cada clic se sitúa en el reloj del visor con `AudioContext.getOutputTimestamp()`.
- Error = tiempo musical del clic que suena − tiempo del visor en ese instante.

**Estrategias:**

- _Ingenua_: se limita a copiar al secuenciador la velocidad y los saltos del visor.
- _Corregida_: cada 50 ms compara lo que suena con el visor y ajusta `playbackRate` (±5 % como máximo). Si la diferencia pasa de 150 ms, salta. Solo conoce la velocidad nominal del visor.
- _Audio manda_: el visor no tiene reloj propio y muestra `seq.currentHighResolutionTime` menos la latencia de salida.

| Estrategia  | Desvío del reloj del visor | Error medio | p95    | Máximo | Saltos de corrección |
| ----------- | -------------------------- | ----------- | ------ | ------ | -------------------- |
| Ingenua     | ninguno                    | 70 ms       | 126 ms | 134 ms | 0                    |
| Corregida   | ninguno                    | 13 ms       | 24 ms  | 28 ms  | 1 (el inicial)       |
| Ingenua     | +0,2 %                     | 98 ms       | 194 ms | 201 ms | 0                    |
| Corregida   | +0,2 %                     | 14 ms       | 29 ms  | 32 ms  | 1                    |
| Audio manda | —                          | 22 ms       | 45 ms  | 46 ms  | 0                    |

**Lectura:**

- En headless, **el reloj de audio iba entre un 0,27 % y un 1,0 % más lento que `performance.now()`**: entre 1002,7 y 1009,9 ms de reloj de pared por cada segundo de audio, según la prueba (medido). Por eso la estrategia ingenua se desfasa unos 8 ms por segundo aunque el visor no tenga desvío propio (medido: de −12 a −130 ms entre los segundos 0,5 y 15,3 de la serie). Con el visor un 0,2 % rápido, el desfase sube a unos 14 ms por segundo (medido). Ese desfase solo se reajusta cuando hay un salto.
- Con el bucle de corrección, el error quedó acotado en las dos pruebas (máximo de 28–32 ms, medido).
- **Incertidumbre de la medida:** los sellos de `getOutputTimestamp` se separaron de su recta de ajuste hasta 17–80 ms según la prueba (medido: «residuo máx.»). Por tanto, diferencias por debajo de unas decenas de ms **no son concluyentes** con este montaje. Eso incluye el 22–46 ms de «audio manda», que por construcción debería ser casi cero.
- El dispositivo de audio falso no es una tarjeta real. La latencia y la deriva en equipos reales están en «SIN MEDIR».

**Cómo integrarlo en el visor** (inferencia razonada a partir de lo leído y medido):

1. Si el visor puede subordinarse al audio, que mande el audio: el visor dibuja `seq.currentHighResolutionTime − (outputLatency + baseLatency) × playbackRate`, que la librería describe como la versión suavizada «para visualización» (leído). Los cambios de tempo del usuario se trasladan con `seq.playbackRate` y los saltos con `seq.currentTime`.
2. Si la línea de tiempo del visor tiene que mandar (por ejemplo, porque la mueve otro medio), usar el bucle «corregido» de `demo/demo.js`. Conviene suavizar la medida y saltar solo por encima de un umbral.
3. No programar las notas una a una desde el visor con `{time}`. No aporta precisión (la rejilla es la misma, ver 3.1) y obliga a reescribir el secuenciador.

## 4. Recomendación para web en equipos modestos

Cada fila se apoya en lo medido y leído arriba. La elección en sí es una valoración mía.

| Escenario                                                               | Soundfont                                                                                                                   | Peso de descarga                                      | Ajustes                                                                                        | Por qué                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Por defecto: cada obra con su recorte**                               | GeneralUser GS 2.0.3, **recortado por obra** y en SF3 (generado al publicar la obra con `scripts/sf_stats.mjs` como modelo) | **0,6–0,8 MB** por obra en las dos de prueba (medido) | Por defecto. En equipos débiles, sin efectos e interpolación lineal                            | Licencia que permite usarlo y alojarlo (leído). El que más capas tiene en timbal y percusión (medido). La menor memoria (RSS 156–159 MB frente a 135 de la página vacía, medido) y la carga más rápida (34 ms, medido) |
| Un solo fichero para todo el catálogo                                   | GeneralUserGS.sf3 completo (el del repo)                                                                                    | **8,0 MB**, una vez y en caché                        | Igual                                                                                          | Igual CPU que el recorte (8,7 % frente a 8,4 %, medido). Unos 20 MB más de RSS (medido)                                                                                                                                |
| Si se exige licencia MIT sin la reserva sobre el origen de las muestras | FluidR3Mono_GM (MS_General) **solo recortado**                                                                              | 0,5–0,9 MB por obra (medido)                          | Igual                                                                                          | MIT (leído), pero la propia licencia avisa de que puede cambiar (leído). **No usar completo**: 22,6 MB, y su piano ocupa unos 200 MB al descomprimirse (calculado sobre lo medido)                                     |
| Limitar el gasto de CPU                                                 | Cualquiera de las anteriores                                                                                                | —                                                     | `setSystemParameter("voiceCap", 64)`; `effectsEnabled: false`; `interpolationType: 0` (lineal) | En el estrés sintético, 64 voces bajaron la carga media del 15,4 % al 3,5 % (medido). Sin efectos y con interpolación lineal, el Bach pasó del 1,9 % al 1,0 % (medido). **Cuánto cambia el sonido no está escuchado**  |
| No recomendado                                                          | TimGM6mb                                                                                                                    | 5,7 MB                                                | —                                                                                              | Licencia no verificada en su fuente. Cuerdas de 0,1–0,3 s a 12 kHz (medido). No ahorra CPU frente a GeneralUser (medido)                                                                                               |

Otros apuntes:

- El sintetizador consume un 5,9 % de CPU aunque esté callado (medido). Inferencia: suspender el `AudioContext` (`ctx.suspend()`) cuando el visor no reproduce debería evitarlo; no está medido.
- Para equipos modestos, el margen en música real es amplio: el Bach a 6× de ralentización emulada se quedó en un 12,4 % de carga media (medido). El riesgo está en los picos (0,37 % de bloques fuera de plazo, medido) y en partituras muy densas. Por eso conviene limitar `voiceCap`.

## Scripts y demo en la rama

- Todo está en `lab-sintesis-ligera/`; las instrucciones, en `lab-sintesis-ligera/README.md`.
- Scripts: `fetch_soundfonts.sh`, `make_midis.py`, `sf_stats.mjs`, `bench_chromium.mjs` (grupos: offline, bloques, memoria, tiemporeal, temporizado, sincronía) y `tablas.mjs`.
- Demo: `demo/index.html`. Simula el visor con selector de soundfont y MIDI, velocidad, salto por clic y los dos modos de sincronía. Probada en headless (medido): carga GeneralUserGS.sf3 en 388 ms, sigue al visor tras un cambio a 1,25× y tras un salto, sin errores.
- No se sube ningún soundfont, MIDI ni audio: van a `.cache/` y `midi/`, que están en `.gitignore`.

## SIN MEDIR

1. **Calidad audible por familia.** Nadie ha escuchado nada; el apartado 1.3 solo trata la construcción de los instrumentos.
2. **Equipos modestos reales**, móviles y portátiles antiguos. Solo hay emulación (`setCPUThrottlingRate` en el hilo principal). No sé si esa emulación afecta al hilo del AudioWorklet; por eso el coste por bloque se midió en el hilo principal.
3. **Tarjetas de sonido reales:** latencia de salida, deriva del reloj de audio frente a `performance.now()` y cortes audibles. Headless usa un dispositivo falso.
4. **Firefox y Safari.** Solo se ha probado Chromium 153.
5. Si los máximos aislados por bloque (2–99 ms) también ocurren dentro del AudioWorklet real, y si son pausas del recolector de basura.
6. La causa del desplazamiento constante de unas 36 muestras con bloques de 128 frente a bloques de 1.
7. La sincronía con precisión mejor que unas decenas de ms: la medida tiene esa incertidumbre (residuo de 17–80 ms).
8. La memoria con una obra que use el piano de FluidR3Mono (solo calculada, unos 200 MB por preset).
9. La CPU en reposo con `AudioContext` suspendido.
10. La pérdida de calidad al recomprimir a Vorbis q=0,5.
11. `WorkerSynthesizer`, la otra variante de la librería que trabaja en un Worker.
12. Una obra orquestal romántica real, más densa que el Bach. Solo se probó el estrés sintético como sustituto.
13. Tiempos de descarga en redes reales.
14. **Otros soundfonts** que no se pudieron descargar o no son SF2: MuseScore_General, FluidR3_GM completo, Salamander Grand Piano, VSCO-2 CE, Sonatina Symphonic Orchestra y la licencia de TimGM6mb en Debian.
15. Si el bloque de Web Audio es configurable en este Chromium (no se probó `renderSizeHint`).
