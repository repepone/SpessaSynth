// Funciones de medida que el lanzador Playwright (scripts/bench_chromium.mjs) invoca dentro de Chromium.
// Todas devuelven objetos JSON serializables. Ninguna cifra se calcula fuera de lo que aquí se mide.
import { Sequencer, WorkletSynthesizer } from "spessasynth_lib";
import {
    BasicMIDI,
    BasicSoundBank,
    SoundBankLoader,
    SpessaSynthProcessor,
    SpessaSynthSequencer
} from "spessasynth_core";

const PROCESSOR_URL =
    "/node_modules/spessasynth_lib/dist/spessasynth_processor.min.js";
const RECORDER_URL = "/lab-sintesis-ligera/demo/recorder-worklet.js";
const BLOCK = 128;

const fetchBuf = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.arrayBuffer();
};

function stats(arr) {
    const s = Float64Array.from(arr).sort();
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    let sum = 0;
    for (const v of s) sum += v;
    return {
        n: s.length,
        media: sum / s.length,
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        p999: q(0.999),
        max: s.at(-1)
    };
}

function level(ch) {
    let peak = 0;
    let sq = 0;
    for (const v of ch) {
        const a = Math.abs(v);
        if (a > peak) peak = a;
        sq += v * v;
    }
    return { pico: peak, rms: Math.sqrt(sq / ch.length) };
}

/** Detecta ataques: primer cruce de umbral tras un periodo refractario. Devuelve índices de muestra. */
function onsets(ch, sampleRate, refractory = 0.1) {
    let peak = 0;
    for (const v of ch) peak = Math.max(peak, Math.abs(v));
    const thr = peak * 0.25;
    const out = [];
    let last = -Infinity;
    for (let i = 0; i < ch.length; i++) {
        if (Math.abs(ch[i]) >= thr && i - last > refractory * sampleRate) {
            out.push(i);
            last = i;
        }
    }
    return out;
}

// ---------------------------------------------------------------- A) worklet en OfflineAudioContext
/** Render completo con el sintetizador real (AudioWorklet) a la máxima velocidad posible. */
window.offlineWorklet = async ({
    sf,
    midi,
    seconds = Infinity,
    sampleRate = 44_100,
    keepAudio = false
}) => {
    const sfBuf = await fetchBuf(sf);
    const midiObj = BasicMIDI.fromArrayBuffer(await fetchBuf(midi));
    const dur = Math.min(seconds, midiObj.duration + 1);
    const ctx = new OfflineAudioContext({
        numberOfChannels: 2,
        length: Math.ceil(dur * sampleRate),
        sampleRate
    });
    const t0 = performance.now();
    await ctx.audioWorklet.addModule(PROCESSOR_URL);
    const synth = new WorkletSynthesizer(ctx);
    synth.connect(ctx.destination);
    await synth.startOfflineRender({
        midiSequence: midiObj,
        soundBankList: [{ bankOffset: 0, soundBankBuffer: sfBuf }],
        loopCount: 0,
        sequencerOptions: { skipToFirstNoteOn: false, initialPlaybackRate: 1 }
    });
    const t1 = performance.now();
    const buf = await ctx.startRendering();
    const t2 = performance.now();
    const res = {
        segundos_audio: dur,
        ms_preparacion: t1 - t0,
        ms_render: t2 - t1,
        veces_tiempo_real: dur / ((t2 - t1) / 1000),
        nivel: level(buf.getChannelData(0))
    };
    if (keepAudio)
        window.__lastAudio = { L: buf.getChannelData(0), sampleRate };
    synth.destroy();
    return res;
};

// ---------------------------------------------------------------- B) núcleo bloque a bloque en el hilo principal
/**
 * Ejecuta el mismo motor (spessasynth_core) en bloques de 128 muestras, como el AudioWorklet,
 * pero cronometrando cada bloque. El presupuesto de un bloque en tiempo real es 128/fs.
 */
window.blockLoop = async ({
    sf,
    midi,
    seconds = Infinity,
    sampleRate = 44_100,
    effects = true,
    interpolation = 2,
    voiceCap = 350
}) => {
    await BasicSoundBank.ready;
    const sfBuf = await fetchBuf(sf);
    const midBuf = await fetchBuf(midi);
    const t0 = performance.now();
    const bank = SoundBankLoader.fromArrayBuffer(sfBuf);
    const t1 = performance.now();
    const synth = new SpessaSynthProcessor(sampleRate, {
        eventsEnabled: false,
        effectsEnabled: effects
    });
    synth.soundBankManager.addSoundBank(bank, "main");
    await synth.ready;
    synth.setSystemParameter("interpolationType", interpolation);
    synth.setSystemParameter("voiceCap", voiceCap);
    const seq = new SpessaSynthSequencer(synth);
    const midiObj = BasicMIDI.fromArrayBuffer(midBuf);
    seq.loadNewSongList([midiObj]); // incluye la precarga (decodificación) de las muestras usadas
    const t2 = performance.now();
    seq.play();
    const dur = Math.min(seconds, midiObj.duration + 1);
    const blocks = Math.ceil((dur * sampleRate) / BLOCK);
    const L = new Float32Array(BLOCK);
    const R = new Float32Array(BLOCK);
    const times = new Float64Array(blocks);
    let maxVoices = 0;
    const tStart = performance.now();
    for (let i = 0; i < blocks; i++) {
        const a = performance.now();
        seq.processTick();
        L.fill(0);
        R.fill(0);
        synth.process(L, R, 0, BLOCK);
        times[i] = performance.now() - a;
        if (synth.voiceCount > maxVoices) maxVoices = synth.voiceCount;
    }
    const total = performance.now() - tStart;
    const budgetMs = (BLOCK / sampleRate) * 1000;
    let over = 0;
    for (const t of times) if (t > budgetMs) over++;
    const st = stats(times);
    // Sin los 2 primeros segundos (calentamiento del compilador JIT y precarga perezosa)
    const warm = stats(
        times.subarray(
            Math.min(times.length - 1, Math.ceil((2 * sampleRate) / BLOCK))
        )
    );
    window.__keep = { bank, synth, seq }; // mantener vivo para medir memoria desde fuera
    return {
        segundos_audio: dur,
        ms_parse_soundfont: t1 - t0,
        ms_carga_y_precarga: t2 - t1,
        ms_render_total: total,
        veces_tiempo_real: dur / (total / 1000),
        presupuesto_bloque_ms: budgetMs,
        bloque_ms: st,
        bloque_ms_sin_2s_iniciales: warm,
        bloques_sobre_presupuesto: over,
        pct_bloques_sobre_presupuesto: (100 * over) / blocks,
        carga_media_pct: (100 * st.media) / budgetMs,
        voces_max: maxVoices,
        aislado: crossOriginIsolated
    };
};

window.releaseKeep = () => {
    window.__keep = undefined;
};

// ---------------------------------------------------------------- C) tiempo real (AudioContext)
let rt;
window.realtimeStart = async ({
    sf,
    midi,
    effects = true,
    interpolation = 2,
    latencyHint = "interactive",
    play = true
}) => {
    const ctx = new AudioContext({ sampleRate: 44_100, latencyHint });
    await ctx.resume();
    await ctx.audioWorklet.addModule(PROCESSOR_URL);
    const synth = new WorkletSynthesizer(ctx);
    synth.connect(ctx.destination);
    await synth.isReady;
    const t0 = performance.now();
    if (sf)
        await synth.soundBankManager.addSoundBank(await fetchBuf(sf), "main");
    const t1 = performance.now();
    synth.setSystemParameter("effectsEnabled", effects);
    synth.setSystemParameter("interpolationType", interpolation);
    let seq;
    if (midi) {
        seq = new Sequencer(synth);
        const changed = new Promise((r) =>
            seq.eventHandler.addEvent("songChange", "lab", r)
        );
        seq.loadNewSongList([{ binary: await fetchBuf(midi) }]);
        await changed;
        if (play) seq.play();
    }
    rt = { ctx, synth, seq, voices: [] };
    rt.timer = setInterval(() => rt.voices.push(synth.voiceCount), 100);
    return {
        ms_carga_soundfont: t1 - t0,
        estado_ctx: ctx.state,
        baseLatency: ctx.baseLatency,
        outputLatency: ctx.outputLatency
    };
};

window.realtimeStop = async () => {
    clearInterval(rt.timer);
    const r = {
        tiempo_ctx: rt.ctx.currentTime,
        voces_max: Math.max(0, ...rt.voices),
        voces_media:
            rt.voices.reduce((a, b) => a + b, 0) /
            Math.max(1, rt.voices.length),
        seq_tiempo: rt.seq?.currentTime
    };
    rt.seq?.pause();
    rt.synth.destroy();
    await rt.ctx.close();
    rt = undefined;
    return r;
};

// ---------------------------------------------------------------- D) temporizado
/** D1: clics del MIDI de temporizado, render offline con el worklet; posiciones de ataque en muestras. */
window.timingSequencerWorklet = async ({
    sf,
    midi,
    ideal,
    sampleRate = 44_100
}) => {
    const r = await window.offlineWorklet({
        sf,
        midi,
        keepAudio: true,
        sampleRate
    });
    const { L } = window.__lastAudio;
    return {
        ...analyseClicks(onsets(L, sampleRate), ideal, sampleRate),
        render: r
    };
};

/** D1b: lo mismo con el núcleo en bucle de bloques de tamaño configurable. */
window.timingSequencerCore = async ({
    sf,
    midi,
    ideal,
    sampleRate = 44_100,
    block = BLOCK,
    rateChange
}) => {
    await BasicSoundBank.ready;
    const synth = new SpessaSynthProcessor(sampleRate, {
        eventsEnabled: false,
        effectsEnabled: false,
        maxBufferSize: Math.max(block, 128)
    });
    synth.soundBankManager.addSoundBank(
        SoundBankLoader.fromArrayBuffer(await fetchBuf(sf)),
        "main"
    );
    await synth.ready;
    const seq = new SpessaSynthSequencer(synth);
    const midiObj = BasicMIDI.fromArrayBuffer(await fetchBuf(midi));
    seq.loadNewSongList([midiObj]);
    seq.play();
    const total = Math.ceil((midiObj.duration + 1) * sampleRate);
    const L = new Float32Array(total);
    const R = new Float32Array(total);
    let changedAt;
    for (let pos = 0; pos < total; pos += block) {
        if (
            rateChange &&
            changedAt === undefined &&
            pos / sampleRate >= rateChange.atAudioSeconds
        ) {
            seq.playbackRate = rateChange.rate;
            changedAt = pos;
        }
        seq.processTick();
        synth.process(L, R, pos, Math.min(block, total - pos));
    }
    return {
        ...analyseClicks(onsets(L, sampleRate), ideal, sampleRate),
        cambio_ritmo_en_muestra: changedAt
    };
};

/** D2: notas programadas directamente con {time} (sin secuenciador), núcleo en bloques de 128. */
window.timingScheduledCore = async ({
    sf,
    times,
    sampleRate = 44_100,
    block = BLOCK
}) => {
    await BasicSoundBank.ready;
    const synth = new SpessaSynthProcessor(sampleRate, {
        eventsEnabled: false,
        effectsEnabled: false,
        maxBufferSize: Math.max(block, 128)
    });
    synth.soundBankManager.addSoundBank(
        SoundBankLoader.fromArrayBuffer(await fetchBuf(sf)),
        "main"
    );
    await synth.ready;
    for (const t of times) {
        synth.processMessage([0x99, 76, 127], 0, { time: t });
        synth.processMessage([0x89, 76, 0], 0, { time: t + 0.03 });
    }
    const total = Math.ceil((times.at(-1) + 1) * sampleRate);
    const L = new Float32Array(total);
    const R = new Float32Array(total);
    for (let pos = 0; pos < total; pos += block)
        synth.process(L, R, pos, Math.min(block, total - pos));
    return analyseClicks(onsets(L, sampleRate), times, sampleRate);
};

/** D2b: lo mismo a través del AudioWorklet en OfflineAudioContext (synth.noteOn con eventOptions.time). */
window.timingScheduledWorklet = async ({ sf, times, sampleRate = 44_100 }) => {
    const ctx = new OfflineAudioContext({
        numberOfChannels: 2,
        length: Math.ceil((times.at(-1) + 1) * sampleRate),
        sampleRate
    });
    await ctx.audioWorklet.addModule(PROCESSOR_URL);
    const synth = new WorkletSynthesizer(ctx);
    synth.connect(ctx.destination);
    await synth.isReady;
    await synth.soundBankManager.addSoundBank(await fetchBuf(sf), "main");
    synth.setSystemParameter("effectsEnabled", false);
    for (const t of times) {
        synth.noteOn(9, 76, 127, { time: t });
        synth.noteOff(9, 76, { time: t + 0.03 });
    }
    await new Promise((r) => setTimeout(r, 300)); // dar tiempo a que los mensajes lleguen al worklet
    const buf = await ctx.startRendering();
    synth.destroy();
    return analyseClicks(
        onsets(buf.getChannelData(0), sampleRate),
        times,
        sampleRate
    );
};

function analyseClicks(found, ideal, sampleRate) {
    const n = Math.min(found.length, ideal.length);
    // El ataque de la muestra tiene un retardo propio constante; se toma el del primer clic como referencia.
    const base = found[0] - Math.round(ideal[0] * sampleRate);
    const err = [];
    for (let i = 0; i < n; i++)
        err.push(found[i] - base - ideal[i] * sampleRate);
    const mod = found.slice(0, n).map((f) => (f - base) % BLOCK);
    return {
        clics_esperados: ideal.length,
        clics_detectados: found.length,
        retardo_ataque_muestras: base,
        error_muestras: stats(err),
        error_muestras_lista: err.map((e) => Math.round(e * 10) / 10),
        ataques_mod_128_distintos: [...new Set(mod)].length,
        ataques_mod_128: [...new Set(mod)].slice(0, 8)
    };
}

// ---------------------------------------------------------------- D4) sincronía con un reloj externo en tiempo real
/**
 * Toca el metrónomo (1 clic cada 0,25 s de música) en un AudioContext real. Un "visor" simulado lleva su propio
 * reloj (performance.now, con un desvío artificial `skew`) y cambia de velocidad en los instantes de `rateChanges`.
 * Estrategias: "ingenua" (solo copia la velocidad del visor), "corregida" (además corrige la deriva con
 * playbackRate y salta si se pasa de `seekThreshold`) y "audio_maestro" (no hay reloj externo: el visor
 * se limita a mostrar el tiempo del secuenciador; se mide cuánto se equivoca lo mostrado frente a lo que suena).
 * La salida se graba con un AudioWorklet grabador; cada clic detectado se sitúa en el reloj del visor con
 * AudioContext.getOutputTimestamp(), y se compara su tiempo musical con el del visor en ese instante.
 */
window.syncTest = async ({
    sf,
    midi,
    seconds = 30,
    strategy = "corregida",
    skew = 1.0,
    rateChanges = [],
    gain = 2,
    seekThreshold = 0.15,
    period = 0.25,
    latencyComp = true
}) => {
    const ctx = new AudioContext({
        sampleRate: 44_100,
        latencyHint: "interactive"
    });
    await ctx.resume();
    await ctx.audioWorklet.addModule(PROCESSOR_URL);
    await ctx.audioWorklet.addModule(RECORDER_URL);
    const synth = new WorkletSynthesizer(ctx);
    const rec = new AudioWorkletNode(ctx, "lab-recorder", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit"
    });
    synth.connect(ctx.destination);
    synth.connect(rec);
    await synth.isReady;
    await synth.soundBankManager.addSoundBank(await fetchBuf(sf), "main");
    synth.setSystemParameter("effectsEnabled", false);
    const seq = new Sequencer(synth);
    const changed = new Promise((r) =>
        seq.eventHandler.addEvent("songChange", "lab", r)
    );
    seq.loadNewSongList([{ binary: await fetchBuf(midi) }]);
    await changed;

    const chunks = [];
    rec.port.onmessage = (e) => chunks.push(e.data);
    // Mapa reloj de audio -> performance.now, muestreado durante toda la prueba
    const stamps = [];
    // Reloj del visor: tiempo musical en función de performance.now
    const viewer = { t0: 0, music0: 0, rate: 1 };
    const viewerAt = (perf) =>
        viewer.music0 + ((perf - viewer.t0) / 1000) * viewer.rate * skew;
    const segments = [];
    const setViewerRate = (rate, perf) => {
        viewer.music0 = viewerAt(perf);
        viewer.t0 = perf;
        viewer.rate = rate;
        segments.push({ perf, music: viewer.music0, rate });
    };
    const lat = () =>
        latencyComp ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0;

    rec.port.postMessage("start");
    const ctxAtLoad = ctx.currentTime;
    const pausedAfterLoad = seq.paused;
    seq.currentTime = 0;
    seq.play();
    const startPerf = performance.now();
    const ctxAtPlay = ctx.currentTime;
    viewer.t0 = startPerf;
    setViewerRate(1, startPerf);
    const pending = rateChanges.map((c) => ({ ...c }));
    const corrections = { saltos: 0, ajustes: 0 };
    const display = [];
    let smooth;
    await new Promise((resolve) => {
        const tick = () => {
            const now = performance.now();
            const ts = ctx.getOutputTimestamp();
            stamps.push({
                ctx: ts.contextTime,
                perf: ts.performanceTime,
                now,
                cur: ctx.currentTime
            });
            const elapsed = (now - startPerf) / 1000;
            while (pending.length && pending[0].at <= elapsed) {
                const c = pending.shift();
                if (c.seekTo === undefined) {
                    setViewerRate(c.rate, now);
                    seq.playbackRate = c.rate;
                } else {
                    // El usuario salta a otro punto de la partitura: el visor avisa y el secuenciador salta
                    viewer.music0 = c.seekTo;
                    viewer.t0 = now;
                    segments.push({
                        perf: now,
                        music: c.seekTo,
                        rate: viewer.rate
                    });
                    seq.currentTime =
                        c.seekTo +
                        (strategy === "corregida" ? lat() * viewer.rate : 0);
                }
            }
            if (strategy === "audio_maestro") {
                // El visor no tiene reloj propio: muestra lo que dice el secuenciador menos la latencia de salida
                display.push({
                    perf: now,
                    music:
                        seq.currentHighResolutionTime - lat() * seq.playbackRate
                });
            }
            if (strategy === "corregida") {
                // Tiempo musical que suena en este momento, según el sello de salida del propio AudioContext.
                // El corrector solo conoce la velocidad nominal del visor (viewer.rate), no su desvío (skew).
                let drift;
                if (ts.performanceTime > 0) {
                    const heard =
                        seq.currentTime -
                        (ctx.currentTime - ts.contextTime) * seq.playbackRate;
                    drift = heard - viewerAt(ts.performanceTime);
                } else {
                    drift =
                        seq.currentTime -
                        lat() * seq.playbackRate -
                        viewerAt(now);
                }
                smooth =
                    smooth === undefined
                        ? drift
                        : smooth + 0.3 * (drift - smooth);
                if (Math.abs(smooth) > seekThreshold) {
                    seq.currentTime = viewerAt(now) + lat() * viewer.rate;
                    smooth = undefined;
                    corrections.saltos++;
                } else {
                    const corr = Math.max(
                        -0.05,
                        Math.min(0.05, -smooth * gain)
                    );
                    seq.playbackRate = viewer.rate * (1 + corr);
                    corrections.ajustes++;
                }
            }
            if (elapsed >= seconds) resolve();
            else setTimeout(tick, 50);
        };
        tick();
    });
    rec.port.postMessage("stop");
    await new Promise((r) => setTimeout(r, 300));
    seq.pause();

    // Reconstruir la grabación: cada trozo trae el índice de frame de inicio (currentFrame del hilo de audio)
    const first = chunks[0]?.frame ?? 0;
    const last = chunks.at(-1);
    const total = last ? last.frame + last.data.length - first : 0;
    const L = new Float32Array(total);
    for (const c of chunks) L.set(c.data, c.frame - first);
    const sr = ctx.sampleRate;
    const found = onsets(L, sr, 0.08);

    // Ajuste lineal contextTime -> performanceTime con los sellos válidos
    const valid = stamps.filter((s) => s.perf > 0);
    const n = valid.length;
    const mx = valid.reduce((a, s) => a + s.ctx, 0) / n;
    const my = valid.reduce((a, s) => a + s.perf, 0) / n;
    let sxx = 0;
    let sxy = 0;
    for (const s of valid) {
        sxx += (s.ctx - mx) ** 2;
        sxy += (s.ctx - mx) * (s.perf - my);
    }
    const slope = sxy / sxx; // ms de performance.now por segundo de reloj de audio
    const toPerf = (ctxTime) => my + slope * (ctxTime - mx);
    let resid = 0;
    for (const s of valid)
        resid = Math.max(resid, Math.abs(s.perf - toPerf(s.ctx)));

    const displayAt = (perf) => {
        let i = display.findIndex((d) => d.perf > perf);
        if (i <= 0) i = i === 0 ? 1 : display.length - 1;
        const a = display[i - 1];
        const b = display[i];
        return (
            a.music +
            ((b.music - a.music) * (perf - a.perf)) / (b.perf - a.perf)
        );
    };
    const viewerAtSeg = (perf) => {
        if (strategy === "audio_maestro") return displayAt(perf);
        let seg = segments[0];
        for (const s of segments) if (s.perf <= perf) seg = s;
        return seg.music + ((perf - seg.perf) / 1000) * seg.rate * skew;
    };
    // Cada clic k suena en el tiempo musical k*period (el metrónomo no tiene huecos)
    // Se descartan los primeros 0,5 s (arranque) y se emparejan por el clic musical más cercano.
    // Sin saltos, el clic i-ésimo detectado es el tiempo musical i*period (emparejamiento exacto).
    // Con saltos se empareja con el clic más cercano (válido mientras |error| < period/2).
    const sequential =
        corrections.saltos === 0 &&
        !rateChanges.some((c) => c.seekTo !== undefined);
    const errs = [];
    for (const [i, f] of found.entries()) {
        const ctxTime = (first + f) / sr;
        const perf = toPerf(ctxTime);
        const v = viewerAtSeg(perf);
        if ((perf - startPerf) / 1000 < 0.5) continue;
        const k = sequential ? i : Math.round(v / period);
        // tiempo musical que suena = el del clic más cercano al visor; error = clic - visor
        errs.push({
            t: (perf - startPerf) / 1000,
            err_ms: (k * period - v) * 1000
        });
    }
    const errAbs = errs.map((e) => Math.abs(e.err_ms));
    const arranque = {
        pausado_tras_cargar: pausedAfterLoad,
        ctx_al_cargar: ctxAtLoad,
        ctx_al_play: ctxAtPlay,
        ctx_primer_clic: found.length ? (first + found[0]) / sr : null,
        ctx_inicio_grabacion: first / sr,
        perf_primer_clic_menos_play_ms: found.length
            ? toPerf((first + found[0]) / sr) - startPerf
            : null
    };
    synth.destroy();
    await ctx.close();
    return {
        estrategia: strategy,
        skew,
        compensa_latencia: latencyComp,
        baseLatency: ctx.baseLatency,
        outputLatency: ctx.outputLatency,
        ms_perf_por_s_audio: slope,
        residuo_max_ms_ajuste_reloj: resid,
        sellos_validos: n,
        clics_detectados: found.length,
        correcciones: corrections,
        emparejamiento: sequential ? "secuencial" : "clic más cercano",
        arranque,
        error_abs_ms: stats(errAbs),
        error_ms_serie: errs.map((e) => [
            Math.round(e.t * 100) / 100,
            Math.round(e.err_ms * 10) / 10
        ])
    };
};

window.labReady = true;
