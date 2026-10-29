// Análisis estructural de soundfonts por familia instrumental y peso de versiones recortadas.
// Uso: node lab-sintesis-ligera/scripts/sf_stats.mjs
// Lee .cache/soundfonts/*.sf2|sf3 y midi/*.mid; escribe resultados/sf_stats.json y .cache/recortes/*.sf3
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BasicMIDI, BasicSoundBank, SoundBankLoader } from "spessasynth_core";
import { createOggEncoder } from "wasm-media-encoders";

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SF_DIR = path.join(LAB, ".cache/soundfonts");
const OUT_DIR = path.join(LAB, ".cache/recortes");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Familias pedidas -> presets GM (banco 0) y kits de percusión (banco 128)
export const FAMILIAS = {
    cuerda: [40, 41, 42, 43, 44, 45, 48, 49],
    "viento madera": [68, 69, 70, 71, 72, 73, 74],
    metal: [56, 57, 58, 59, 60, 61],
    percusión: [47, 8, 9, 13, 14, "kit:0", "kit:48"],
    piano: [0, 1],
    guitarra: [24, 25]
};

function findPreset(bank, id) {
    if (typeof id === "string") {
        const prog = Number(id.split(":")[1]);
        return (
            bank.presets.find((p) => p.isDrum && p.program === prog) ??
            (prog === 0 ? bank.presets.find((p) => p.isDrum) : undefined)
        );
    }
    return (
        bank.presets.find(
            (p) =>
                !p.isDrum &&
                p.program === id &&
                p.bankMSB === 0 &&
                p.bankLSB === 0
        ) ?? bank.presets.find((p) => !p.isDrum && p.program === id)
    );
}

function presetStats(preset) {
    const samples = new Set();
    const velSplits = new Set();
    let zones = 0;
    for (const pz of preset.zones) {
        for (const iz of pz.instrument.zones) {
            zones++;
            samples.add(iz.sample);
            if (iz.sample.linkedSample) samples.add(iz.sample.linkedSample);
            velSplits.add(`${iz.velRange.min}-${iz.velRange.max}`);
        }
    }
    let frames = 0;
    let seconds = 0;
    let rawBytes = 0;
    let maxRate = 0;
    let minRate = Infinity;
    let stereo = 0;
    let looped = 0;
    for (const s of samples) {
        const n = s.getAudioData().length;
        frames += n;
        seconds += n / s.sampleRate;
        rawBytes += s.getRawData(true).length;
        maxRate = Math.max(maxRate, s.sampleRate);
        minRate = Math.min(minRate, s.sampleRate);
        if (s.linkedSample) stereo++;
        if (s.loopEnd - s.loopStart > 32) looped++;
    }
    return {
        nombre: preset.name,
        zonas: zones,
        muestras: samples.size,
        muestras_estereo: stereo,
        muestras_con_bucle: looped,
        capas_velocidad: velSplits.size,
        segundos_audio: Number(seconds.toFixed(1)),
        bytes_en_fichero: rawBytes,
        bytes_float32_en_memoria: frames * 4,
        fs_max: maxRate,
        fs_min: minRate
    };
}

let encoderPromise;
async function vorbis(data, sampleRate, quality) {
    encoderPromise ??= createOggEncoder();
    const enc = await encoderPromise;
    enc.configure({ channels: 1, sampleRate, vbrQuality: quality * 10 });
    const a = enc.encode([data]).slice();
    const b = enc.finalize().slice();
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}

function loadBank(file) {
    const t0 = performance.now();
    const bank = SoundBankLoader.fromArrayBuffer(fs.readFileSync(file).buffer);
    return { bank, ms: performance.now() - t0 };
}

// El decodificador Vorbis (WASM) debe estar listo antes de leer muestras SF3
await BasicSoundBank.ready;

const results = { soundfonts: {}, recortes: {} };
const files = fs
    .readdirSync(SF_DIR)
    .filter((f) => /\.sf[23]$/.test(f))
    .sort();
const midis = ["orquestal_bach_bwv248_64.mid", "camara_beethoven_op18n1_i.mid"];

for (const f of files) {
    const file = path.join(SF_DIR, f);
    const { bank, ms } = loadBank(file);
    const r = {
        bytes_fichero: fs.statSync(file).size,
        nombre_interno: bank.soundBankInfo.name,
        presets: bank.presets.length,
        muestras: bank.samples.length,
        comprimido: bank.samples.some((s) => s.isCompressed),
        parse_ms_node: Math.round(ms),
        familias: {}
    };
    for (const [fam, ids] of Object.entries(FAMILIAS)) {
        r.familias[fam] = {};
        for (const id of ids) {
            const p = findPreset(bank, id);
            r.familias[fam][String(id)] = p ? presetStats(p) : null;
        }
    }
    results.soundfonts[f] = r;
    console.log(
        f,
        r.bytes_fichero,
        r.presets,
        "presets",
        r.muestras,
        "muestras"
    );

    // Recorte por obra: solo presets y teclas usadas, luego SF3 (Vorbis calidad 0.5 por muestra)
    for (const m of midis) {
        const mid = BasicMIDI.fromArrayBuffer(
            fs.readFileSync(path.join(LAB, "midi", m)).buffer
        );
        const { bank: b2 } = loadBank(file);
        b2.trim(mid.getUsedProgramsAndKeys(b2));
        const yaComprimido = b2.samples.some((s) => s.isCompressed);
        // Fuente PCM: se mide el SF2 recortado y luego se comprime a Vorbis (calidad 0.5).
        // Fuente ya SF3: se conservan las muestras Vorbis originales (sin recomprimir).
        const sf2Bytes = yaComprimido ? null : b2.writeSF2().byteLength;
        const t0 = performance.now();
        if (!yaComprimido) {
            await b2.setSampleFormat({
                format: "compressed",
                compressionFunction: (d, sr) => vorbis(d, sr, 0.5)
            });
        }
        const sf3 = b2.writeSF2();
        const outName = `${path.basename(f).replace(/\.sf[23]$/, "")}__${m.replace(".mid", "")}.sf3`;
        fs.writeFileSync(path.join(OUT_DIR, outName), new Uint8Array(sf3));
        results.recortes[outName] = {
            soundfont: f,
            midi: m,
            presets: b2.presets.length,
            muestras: b2.samples.length,
            bytes_sf2_pcm: sf2Bytes,
            bytes_sf3: sf3.byteLength,
            vorbis: yaComprimido
                ? "original del fichero"
                : "recomprimido q=0.5",
            ms_compresion_node: Math.round(performance.now() - t0)
        };
        console.log("  recorte", outName, results.recortes[outName]);
    }
}

fs.writeFileSync(
    path.join(LAB, "resultados/sf_stats.json"),
    JSON.stringify(results, null, 1)
);
console.log("escrito resultados/sf_stats.json");
