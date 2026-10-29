// Lanzador de medidas en Chromium headless (Playwright).
// Uso: node lab-sintesis-ligera/scripts/bench_chromium.mjs [grupo...]
//   grupos: offline bloques memoria tiemporeal temporizado sincronia  (por defecto, todos)
// Escribe resultados/bench_<grupo>.json. Requiere haber ejecutado fetch_soundfonts.sh, make_midis.py y sf_stats.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const require = createRequire(import.meta.url);
let playwright;
try {
    playwright = require("playwright");
} catch {
    playwright = require("/opt/node-tools/node_modules/playwright");
}
const { chromium } = playwright;

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RES = path.join(LAB, "resultados");
const SF = (f) => `/lab-sintesis-ligera/.cache/soundfonts/${f}`;
const CUT = (f) => `/lab-sintesis-ligera/.cache/recortes/${f}`;
const MID = (f) => `/lab-sintesis-ligera/midi/${f}`;
const midiInfo = JSON.parse(
    fs.readFileSync(path.join(LAB, "midi/midis.json"), "utf8")
);

const ORQ = "orquestal_bach_bwv248_64.mid";
const CAM = "camara_beethoven_op18n1_i.mid";
const EST = "estres_tutti_sintetico.mid";
const BANKS = {
    "GeneralUserGS.sf3 (completo)": SF("GeneralUserGS.sf3"),
    "GeneralUser-GS.sf2 (completo)": SF("GeneralUser-GS.sf2"),
    "FluidR3Mono_GM.sf3 (completo)": SF("FluidR3Mono_GM.sf3"),
    "TimGM6mb.sf2 (completo)": SF("TimGM6mb.sf2")
};
const CUTS = {
    [ORQ]: {
        "GeneralUserGS recortado (sf3)": CUT(
            "GeneralUserGS__orquestal_bach_bwv248_64.sf3"
        )
    },
    [CAM]: {
        "GeneralUserGS recortado (sf3)": CUT(
            "GeneralUserGS__camara_beethoven_op18n1_i.sf3"
        )
    }
};

const groups = process.argv.slice(2);
const want = (g) => groups.length === 0 || groups.includes(g);

const server = await startServer(0);
const BASE = `http://127.0.0.1:${server.address().port}/lab-sintesis-ligera/demo/bench.html`;
const browser = await chromium.launch({
    channel: "chromium", // Chromium completo en modo headless nuevo (no headless-shell)
    args: ["--autoplay-policy=no-user-gesture-required"]
});
const browserCdp = await browser.newBrowserCDPSession();

const env = {
    chromium: browser.version(),
    node: process.version,
    cpu: os.cpus()[0].model,
    nucleos: os.cpus().length,
    ram_mb: Math.round(os.totalmem() / 2 ** 20),
    fecha: new Date().toISOString()
};
console.log(env);

async function newPage() {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
    page.on("console", (m) => {
        if (m.type() === "error")
            console.log("  [console]", m.text().slice(0, 200));
    });
    await page.goto(BASE);
    await page.waitForFunction(() => window.labReady === true, null, {
        timeout: 30_000
    });
    const cdp = await context.newCDPSession(page);
    return { page, context, cdp };
}

async function processes() {
    const { processInfo } = await browserCdp.send("SystemInfo.getProcessInfo");
    return processInfo.map((p) => {
        let rss = null;
        try {
            const st = fs.readFileSync(`/proc/${p.id}/status`, "utf8");
            rss = Number(/VmRSS:\s+(\d+)/.exec(st)[1]) * 1024;
        } catch {
            /* proceso ya cerrado */
        }
        return { tipo: p.type, pid: p.id, cpu_s: p.cpuTime, rss };
    });
}

function save(name, data) {
    fs.writeFileSync(
        path.join(RES, `bench_${name}.json`),
        JSON.stringify({ entorno: env, ...data }, null, 1)
    );
    console.log(`-> resultados/bench_${name}.json`);
}

const run = (page, fn, arg) =>
    page.evaluate(([f, a]) => window[f](a), [fn, arg]);

// ------------------------------------------------------------------ offline (worklet, obra completa)
if (want("offline")) {
    const out = [];
    for (const midi of [ORQ, CAM, EST]) {
        const banks = { ...BANKS, ...(CUTS[midi] ?? {}) };
        for (const [name, sf] of Object.entries(banks)) {
            const { page, context } = await newPage();
            const r = await run(page, "offlineWorklet", {
                sf,
                midi: MID(midi)
            });
            await context.close();
            console.log(
                "offline",
                midi,
                name,
                r.veces_tiempo_real.toFixed(1),
                "x"
            );
            out.push({ midi, soundfont: name, ...r });
        }
    }
    save("offline", {
        descripcion:
            "Render completo con WorkletSynthesizer en OfflineAudioContext (efectos activos, interpolación hermite, voces ilimitadas)",
        resultados: out
    });
}

// ------------------------------------------------------------------ bloques (núcleo, coste por bloque de 128)
if (want("bloques")) {
    const out = [];
    const cases = [];
    for (const midi of [ORQ, CAM, EST]) {
        for (const [name, sf] of Object.entries({
            ...BANKS,
            ...(CUTS[midi] ?? {})
        }))
            cases.push({ midi, name, sf, opts: {}, throttle: 1 });
    }
    // Variantes de ajuste con el soundfont por defecto
    for (const midi of [ORQ, EST]) {
        const sf = BANKS["GeneralUserGS.sf3 (completo)"];
        const name = "GeneralUserGS.sf3 (completo)";
        cases.push({ midi, name, sf, opts: { effects: false }, throttle: 1 });
        cases.push({ midi, name, sf, opts: { interpolation: 0 }, throttle: 1 });
        cases.push({
            midi,
            name,
            sf,
            opts: { effects: false, interpolation: 0 },
            throttle: 1
        });
        cases.push({ midi, name, sf, opts: { voiceCap: 64 }, throttle: 1 });
        // Equipo modesto emulado: el hilo principal de la página se ralentiza 4x y 6x vía CDP
        for (const throttle of [4, 6]) {
            cases.push({ midi, name, sf, opts: {}, throttle });
            cases.push({
                midi,
                name,
                sf,
                opts: { effects: false, interpolation: 0 },
                throttle
            });
        }
    }
    for (const c of cases) {
        const { page, context, cdp } = await newPage();
        if (c.throttle > 1)
            await cdp.send("Emulation.setCPUThrottlingRate", {
                rate: c.throttle
            });
        const r = await run(page, "blockLoop", {
            sf: c.sf,
            midi: MID(c.midi),
            ...c.opts
        });
        await context.close();
        const label = `${c.midi} | ${c.name} | ${JSON.stringify(c.opts)} | x${c.throttle}`;
        console.log(
            "bloques",
            label,
            "media",
            r.bloque_ms.media.toFixed(3),
            "p99",
            r.bloque_ms.p99.toFixed(3),
            "max",
            r.bloque_ms.max.toFixed(2),
            ">pres",
            r.bloques_sobre_presupuesto,
            "voces",
            r.voces_max
        );
        out.push({
            midi: c.midi,
            soundfont: c.name,
            opciones: {
                effects: true,
                interpolation: 2,
                voiceCap: 350,
                ...c.opts
            },
            throttling_cpu: c.throttle,
            ...r
        });
    }
    save("bloques", {
        descripcion:
            "spessasynth_core en el hilo principal de la página, bloques de 128 muestras a 44,1 kHz, cronometrando cada bloque (performance.now con crossOriginIsolated). interpolation: 0=lineal, 2=hermite.",
        resultados: out
    });
}

// ------------------------------------------------------------------ memoria tras cargar y precargar
if (want("memoria")) {
    const out = [];
    const { page: blank, context: blankCtx, cdp: blankCdp } = await newPage();
    const heapBlank = await blankCdp.send("Runtime.getHeapUsage");
    const procBlank = await processes();
    await blankCtx.close();
    out.push({
        caso: "página vacía (referencia)",
        heap: heapBlank,
        procesos: procBlank
    });
    for (const midi of [ORQ, CAM]) {
        for (const [name, sf] of Object.entries({
            ...BANKS,
            ...(CUTS[midi] ?? {})
        })) {
            const { page, context, cdp } = await newPage();
            await run(page, "blockLoop", { sf, midi: MID(midi), seconds: 5 });
            await cdp.send("HeapProfiler.collectGarbage");
            const heap = await cdp.send("Runtime.getHeapUsage");
            const procs = await processes();
            await context.close();
            const rend = procs
                .filter((p) => p.tipo === "renderer")
                .map((p) => p.rss);
            console.log(
                "memoria",
                midi,
                name,
                "heap",
                (heap.usedSize / 2 ** 20).toFixed(1),
                "MB",
                "backing",
                ((heap.backingStorageSize ?? 0) / 2 ** 20).toFixed(1),
                "MB",
                "rss renderers",
                rend.map((x) => (x / 2 ** 20).toFixed(0))
            );
            out.push({
                caso: "núcleo cargado + precarga + 5 s de render",
                midi,
                soundfont: name,
                heap,
                procesos: procs
            });
        }
    }
    save("memoria", {
        descripcion:
            "Runtime.getHeapUsage (CDP) del documento tras GC, con el sintetizador vivo; RSS de cada proceso de Chromium leído de /proc. usedSize = montón JS; backingStorageSize = almacenamiento de ArrayBuffer/TypedArray (las muestras).",
        resultados: out
    });
}

// ------------------------------------------------------------------ tiempo real: CPU de procesos durante 30 s
if (want("tiemporeal")) {
    const SECS = 30;
    const out = [];
    const cases = [
        {
            caso: "página sin audio (referencia)",
            sf: null,
            midi: null,
            noAudio: true
        },
        {
            caso: "AudioContext + worklet sin notas (referencia)",
            sf: SF("GeneralUserGS.sf3"),
            midi: ORQ,
            play: false
        },
        {
            caso: "orquestal",
            sf: SF("GeneralUserGS.sf3"),
            name: "GeneralUserGS.sf3 (completo)",
            midi: ORQ
        },
        {
            caso: "orquestal",
            sf: CUT("GeneralUserGS__orquestal_bach_bwv248_64.sf3"),
            name: "GeneralUserGS recortado (sf3)",
            midi: ORQ
        },
        {
            caso: "orquestal",
            sf: SF("FluidR3Mono_GM.sf3"),
            name: "FluidR3Mono_GM.sf3 (completo)",
            midi: ORQ
        },
        {
            caso: "orquestal",
            sf: SF("TimGM6mb.sf2"),
            name: "TimGM6mb.sf2 (completo)",
            midi: ORQ
        },
        {
            caso: "orquestal sin efectos + lineal",
            sf: SF("GeneralUserGS.sf3"),
            name: "GeneralUserGS.sf3 (completo)",
            midi: ORQ,
            effects: false,
            interpolation: 0
        },
        {
            caso: "cámara",
            sf: SF("GeneralUserGS.sf3"),
            name: "GeneralUserGS.sf3 (completo)",
            midi: CAM
        },
        {
            caso: "cámara",
            sf: SF("FluidR3Mono_GM.sf3"),
            name: "FluidR3Mono_GM.sf3 (completo)",
            midi: CAM
        },
        {
            caso: "estrés sintético",
            sf: SF("GeneralUserGS.sf3"),
            name: "GeneralUserGS.sf3 (completo)",
            midi: EST
        }
    ];
    for (const c of cases) {
        const { page, context } = await newPage();
        let start = null;
        if (!c.noAudio) {
            start = await run(page, "realtimeStart", {
                sf: c.sf,
                midi: c.midi ? MID(c.midi) : null,
                effects: c.effects ?? true,
                interpolation: c.interpolation ?? 2,
                play: c.play ?? true
            });
        }
        const before = await processes();
        const t0 = performance.now();
        await new Promise((r) => setTimeout(r, SECS * 1000));
        const after = await processes();
        const wall = (performance.now() - t0) / 1000;
        const stop = c.noAudio ? null : await run(page, "realtimeStop", null);
        await context.close();
        const delta = after.map((p) => {
            const b = before.find((x) => x.pid === p.pid);
            return {
                tipo: p.tipo,
                pid: p.pid,
                cpu_pct_un_nucleo: b
                    ? (100 * (p.cpu_s - b.cpu_s)) / wall
                    : null,
                rss: p.rss
            };
        });
        console.log(
            "tiemporeal",
            c.caso,
            c.name ?? "",
            delta
                .filter((d) => d.cpu_pct_un_nucleo > 0.5)
                .map((d) => `${d.tipo}:${d.cpu_pct_un_nucleo.toFixed(1)}%`)
                .join(" "),
            stop ? `voces max ${stop.voces_max}` : ""
        );
        out.push({
            caso: c.caso,
            soundfont: c.name ?? null,
            midi: c.midi,
            segundos: wall,
            inicio: start,
            fin: stop,
            procesos: delta
        });
    }
    save("tiemporeal", {
        descripcion:
            "AudioContext real (dispositivo de audio falso de Chromium headless), WorkletSynthesizer + Sequencer reproduciendo 30 s. CPU por proceso = Δ cpuTime (SystemInfo.getProcessInfo) / tiempo de pared, en % de un núcleo.",
        resultados: out
    });
}

// ------------------------------------------------------------------ temporizado (precisión de muestra)
if (want("temporizado")) {
    const out = {};
    const ideal = midiInfo["temporizado_clicks.mid"].tiempos_ideales_s;
    const sf = SF("GeneralUserGS.sf3");
    let p = await newPage();
    out.secuenciador_worklet_offline = await run(
        p.page,
        "timingSequencerWorklet",
        { sf, midi: MID("temporizado_clicks.mid"), ideal }
    );
    out.secuenciador_nucleo_bloque128 = await run(
        p.page,
        "timingSequencerCore",
        { sf, midi: MID("temporizado_clicks.mid"), ideal, block: 128 }
    );
    out.secuenciador_nucleo_bloque1 = await run(p.page, "timingSequencerCore", {
        sf,
        midi: MID("temporizado_clicks.mid"),
        ideal,
        block: 1
    });
    // Notas programadas con {time} en instantes que no caen en frontera de bloque
    const times = Array.from({ length: 30 }, (_, i) => 0.05 + i * 0.2137);
    out.programado_nucleo_bloque128 = await run(p.page, "timingScheduledCore", {
        sf,
        times,
        block: 128
    });
    out.programado_nucleo_bloque1 = await run(p.page, "timingScheduledCore", {
        sf,
        times,
        block: 1
    });
    await p.context.close();
    p = await newPage();
    out.programado_worklet_offline = await run(
        p.page,
        "timingScheduledWorklet",
        { sf, times }
    );
    await p.context.close();
    // Cambio de playbackRate en mitad (núcleo, frontera de bloque): clics regulares del metrónomo
    const met = Array.from({ length: 120 }, (_, i) => i * 0.5);
    p = await newPage();
    const change = { atAudioSeconds: 5.0, rate: 1.5 };
    // Ideal: hasta 5 s de audio, música = audio; después música avanza 1.5x
    const idealAudio = met.map((m) => (m <= 5 ? m : 5 + (m - 5) / 1.5));
    out.cambio_ritmo_nucleo_bloque128 = await run(
        p.page,
        "timingSequencerCore",
        {
            sf,
            midi: MID("metronomo_120.mid"),
            ideal: idealAudio,
            block: 128,
            rateChange: change
        }
    );
    await p.context.close();
    for (const [k, v] of Object.entries(out))
        console.log(
            "temporizado",
            k,
            "detectados",
            v.clics_detectados,
            "/",
            v.clics_esperados,
            "error muestras",
            JSON.stringify(v.error_muestras),
            "mod128 distintos",
            v.ataques_mod_128_distintos
        );
    save("temporizado", {
        descripcion:
            "Posición de cada ataque detectado frente a su posición ideal, en muestras a 44,1 kHz (1 muestra = 22,7 µs). Referencia: el primer clic.",
        resultados: out
    });
}

// ------------------------------------------------------------------ sincronía con reloj externo (tiempo real)
if (want("sincronia")) {
    const out = [];
    const sf = SF("GeneralUserGS.sf3");
    const rateChanges = [
        { at: 8, rate: 1.25 },
        { at: 16, rate: 0.8 },
        { at: 20, seekTo: 40 }
    ];
    const cases = [
        { strategy: "ingenua", skew: 1.0 },
        { strategy: "corregida", skew: 1.0 },
        { strategy: "ingenua", skew: 1.002 },
        { strategy: "corregida", skew: 1.002 },
        { strategy: "audio_maestro", skew: 1.0 }
    ];
    for (const c of cases) {
        const { page, context } = await newPage();
        const r = await run(page, "syncTest", {
            sf,
            midi: MID("metronomo_120.mid"),
            seconds: 24,
            period: 0.5,
            rateChanges,
            ...c
        });
        await context.close();
        console.log(
            "sincronia",
            c.strategy,
            "skew",
            c.skew,
            "clics",
            r.clics_detectados,
            "error abs ms",
            JSON.stringify(r.error_abs_ms),
            "correcciones",
            JSON.stringify(r.correcciones),
            "ms/s",
            r.ms_perf_por_s_audio.toFixed(4)
        );
        out.push(r);
    }
    save("sincronia", {
        descripcion:
            "Metrónomo (clic cada 0,5 s de música) en AudioContext real; un visor simulado con reloj propio (performance.now × skew) cambia de velocidad a 1,25 en t=8 s y a 0,8 en t=16 s, y salta al segundo musical 40 en t=20 s. El corrector conoce la velocidad nominal del visor, no su desvío. En audio_maestro no hay reloj externo: el visor muestra seq.currentHighResolutionTime menos la latencia de salida, y el error es frente a eso. Error = tiempo musical del clic que suena − tiempo del visor en ese instante (getOutputTimestamp).",
        resultados: out
    });
}

await browser.close();
server.close();
