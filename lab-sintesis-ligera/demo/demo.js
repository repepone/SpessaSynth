// Demo: visor de partituras simulado + spessasynth_lib, con dos modos de sincronía.
// - "audio": el audio manda; el visor pinta seq.currentHighResolutionTime menos la latencia de salida.
// - "externo": el visor tiene reloj propio (performance.now); el secuenciador lo sigue corrigiendo la
//   deriva con playbackRate (±5 %) y saltando si la diferencia supera 150 ms.
// Es la misma lógica que se midió en bench.js (syncTest), sin la parte de grabación.
import { Sequencer, WorkletSynthesizer } from "spessasynth_lib";

const PROCESSOR_URL =
    "/node_modules/spessasynth_lib/dist/spessasynth_processor.min.js";
const $ = (id) => document.getElementById(id);

let ctx,
    synth,
    seq,
    duration = 0;
const viewer = { playing: false, t0: 0, music0: 0, rate: 1 };
let seeks = 0;
let smooth;

const viewerNow = () =>
    viewer.playing
        ? viewer.music0 + ((performance.now() - viewer.t0) / 1000) * viewer.rate
        : viewer.music0;
const latency = () =>
    ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0;
const heardNow = () => {
    if (!seq) return 0;
    const ts = ctx.getOutputTimestamp();
    if (!seq.paused && ts.performanceTime > 0) {
        return (
            seq.currentTime -
            (ctx.currentTime - ts.contextTime) * seq.playbackRate
        );
    }
    return (
        seq.currentHighResolutionTime -
        (seq.paused ? 0 : latency() * seq.playbackRate)
    );
};

async function readInput(fileInput, select) {
    const f = fileInput.files[0];
    if (f) return f.arrayBuffer();
    const r = await fetch(select.value);
    if (!r.ok)
        throw new Error(
            `${select.value}: ${r.status}. ¿Ejecutaste fetch_soundfonts.sh, make_midis.py y sf_stats.mjs?`
        );
    return r.arrayBuffer();
}

$("load").onclick = async () => {
    $("load").disabled = true;
    $("loadInfo").textContent = "cargando…";
    try {
        if (!ctx) {
            ctx = new AudioContext({ latencyHint: "playback" });
            await ctx.audioWorklet.addModule(PROCESSOR_URL);
            synth = new WorkletSynthesizer(ctx);
            synth.connect(ctx.destination);
            await synth.isReady;
            seq = new Sequencer(synth, { skipToFirstNoteOn: false });
        }
        await ctx.resume();
        const t0 = performance.now();
        const sfBuf = await readInput($("sfFile"), $("sfSel"));
        const sfBytes = sfBuf.byteLength;
        await synth.soundBankManager.addSoundBank(sfBuf, "main");
        const t1 = performance.now();
        const midBuf = await readInput($("midFile"), $("midSel"));
        const changed = new Promise((r) =>
            seq.eventHandler.addEvent("songChange", "demo", r)
        );
        seq.loadNewSongList([{ binary: midBuf }]);
        await changed;
        seq.pause();
        seq.currentTime = 0;
        duration = seq.duration;
        viewer.playing = false;
        viewer.music0 = 0;
        $("loadInfo").textContent =
            `soundfont ${(sfBytes / 2 ** 20).toFixed(1)} MB cargado en ${(t1 - t0).toFixed(0)} ms; obra de ${duration.toFixed(1)} s`;
        $("play").disabled = false;
        $("pause").disabled = false;
        applyOptions();
    } catch (e) {
        $("loadInfo").textContent = String(e);
    } finally {
        $("load").disabled = false;
    }
};

function applyOptions() {
    if (!synth) return;
    synth.setSystemParameter("effectsEnabled", $("fx").checked);
    synth.setSystemParameter("interpolationType", $("lin").checked ? 0 : 2);
}
$("fx").onchange = applyOptions;
$("lin").onchange = applyOptions;

$("play").onclick = async () => {
    await ctx.resume();
    viewer.music0 = viewerNow();
    viewer.t0 = performance.now();
    viewer.playing = true;
    seq.playbackRate = viewer.rate;
    seq.currentTime =
        viewer.music0 +
        ($("mode").value === "externo" ? latency() * viewer.rate : 0);
    seq.play();
    smooth = undefined;
};

$("pause").onclick = () => {
    viewer.music0 = viewerNow();
    viewer.playing = false;
    seq.pause();
};

$("rate").oninput = () => {
    const r = Number($("rate").value);
    $("rateOut").textContent = r.toFixed(2);
    viewer.music0 = viewerNow();
    viewer.t0 = performance.now();
    viewer.rate = r;
    if (seq) seq.playbackRate = r;
};

$("bar").onclick = (e) => {
    if (!seq || !duration) return;
    const rect = $("bar").getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    viewer.music0 = t;
    viewer.t0 = performance.now();
    seq.currentTime =
        t +
        (viewer.playing && $("mode").value === "externo"
            ? latency() * viewer.rate
            : 0);
    smooth = undefined;
};

// Bucle de corrección (modo "externo"): cada 50 ms, igual que en la prueba medida
setInterval(() => {
    if (!seq || !viewer.playing || seq.paused || $("mode").value !== "externo")
        return;
    const drift = heardNow() - viewerNow();
    smooth = smooth === undefined ? drift : smooth + 0.3 * (drift - smooth);
    if (Math.abs(smooth) > 0.15) {
        seq.currentTime = viewerNow() + latency() * viewer.rate;
        smooth = undefined;
        seeks++;
    } else {
        seq.playbackRate =
            viewer.rate * (1 + Math.max(-0.05, Math.min(0.05, -smooth * 2)));
    }
}, 50);

// Dibujo
function frame() {
    const heard = heardNow();
    // En modo "audio" el visor no tiene reloj propio: muestra lo que suena
    if (seq && $("mode").value === "audio" && viewer.playing) {
        viewer.music0 = heard;
        viewer.t0 = performance.now();
    }
    const v = viewerNow();
    if (duration) {
        $("viewerHead").style.left = `${Math.min(100, (100 * v) / duration)}%`;
        $("audioHead").style.left =
            `${Math.min(100, (100 * heard) / duration)}%`;
    }
    $("vT").textContent = v.toFixed(3);
    $("aT").textContent = heard.toFixed(3);
    $("dT").textContent =
        seq && viewer.playing ? ((heard - v) * 1000).toFixed(1) : "—";
    $("voices").textContent = synth ? synth.voiceCount : 0;
    $("lat").textContent = ctx ? (latency() * 1000).toFixed(1) : "—";
    $("seeks").textContent = seeks;
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
