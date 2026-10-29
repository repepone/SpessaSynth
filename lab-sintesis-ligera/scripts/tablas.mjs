// Convierte resultados/*.json en tablas Markdown (resultados/tablas.md) para el informe.
// Uso: node lab-sintesis-ligera/scripts/tablas.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RES = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../resultados"
);
const read = (f) =>
    fs.existsSync(path.join(RES, f))
        ? JSON.parse(fs.readFileSync(path.join(RES, f), "utf8"))
        : null;
const MB = (b) => (b / 2 ** 20).toFixed(1);
const KB = (b) => (b / 1024).toFixed(0);
const f1 = (x) => (x === null || x === undefined ? "—" : Number(x).toFixed(1));
const f2 = (x) => (x === null || x === undefined ? "—" : Number(x).toFixed(2));
const short = {
    "orquestal_bach_bwv248_64.mid": "Bach (orq.)",
    "camara_beethoven_op18n1_i.mid": "Beethoven (cám.)",
    "estres_tutti_sintetico.mid": "Estrés sintético"
};
const out = [];
const table = (head, rows) => {
    out.push(
        `| ${head.join(" | ")} |`,
        `|${head.map(() => "---").join("|")}|`,
        ...rows.map((r) => `| ${r.join(" | ")} |`),
        ""
    );
};

const sf = read("sf_stats.json");
if (sf) {
    out.push("## Soundfonts: ficheros", "");
    table(
        [
            "Fichero",
            "Nombre interno",
            "MB",
            "Presets",
            "Muestras",
            "Comprimido",
            "Parse Node (ms)"
        ],
        Object.entries(sf.soundfonts).map(([f, s]) => [
            f,
            s.nombre_interno,
            MB(s.bytes_fichero),
            s.presets,
            s.muestras,
            s.comprimido ? "sí (Vorbis)" : "no (PCM)",
            s.parse_ms_node
        ])
    );
    out.push(
        "## Soundfonts: por familia (suma de los presets de la familia)",
        ""
    );
    const rows = [];
    for (const [f, s] of Object.entries(sf.soundfonts)) {
        for (const [fam, ps] of Object.entries(s.familias)) {
            const list = Object.values(ps).filter(Boolean);
            const kb = list.reduce((a, p) => a + p.bytes_en_fichero, 0);
            const mem = list.reduce(
                (a, p) => a + p.bytes_float32_en_memoria,
                0
            );
            const muestras = list.map((p) => p.muestras).join("/");
            const vel = Math.max(...list.map((p) => p.capas_velocidad));
            const fsMin = Math.min(...list.map((p) => p.fs_min ?? p.fs_max));
            const seg = list.map((p) => p.segundos_audio).join("/");
            rows.push([
                f,
                fam,
                `${list.length}/${Object.keys(ps).length}`,
                muestras,
                seg,
                vel,
                fsMin,
                KB(kb),
                MB(mem)
            ]);
        }
    }
    table(
        [
            "Soundfont",
            "Familia",
            "Presets hallados",
            "Muestras por preset",
            "Segundos de audio por preset",
            "Máx. capas de velocidad",
            "fs mínima (Hz)",
            "KB en fichero",
            "MB en memoria (Float32)"
        ],
        rows
    );
    out.push("## Recortes por obra", "");
    table(
        ["Recorte", "Presets", "Muestras", "KB SF2 PCM", "KB SF3", "Vorbis"],
        Object.entries(sf.recortes).map(([k, r]) => [
            k,
            r.presets,
            r.muestras,
            r.bytes_sf2_pcm ? KB(r.bytes_sf2_pcm) : "—",
            KB(r.bytes_sf3),
            r.vorbis
        ])
    );
}

const off = read("bench_offline.json");
if (off) {
    out.push("## Render offline con el AudioWorklet (obra completa)", "");
    table(
        [
            "Obra",
            "Soundfont",
            "Audio (s)",
            "Preparación (ms)",
            "Render (ms)",
            "× tiempo real",
            "% de un núcleo (=100/×)"
        ],
        off.resultados.map((r) => [
            short[r.midi],
            r.soundfont,
            f1(r.segundos_audio),
            r.ms_preparacion.toFixed(0),
            r.ms_render.toFixed(0),
            f1(r.veces_tiempo_real),
            f2(100 / r.veces_tiempo_real)
        ])
    );
}

const bl = read("bench_bloques.json");
if (bl) {
    out.push("## Coste por bloque de 128 muestras (presupuesto 2,90 ms)", "");
    table(
        [
            "Obra",
            "Soundfont",
            "Opciones",
            "Throttling",
            "Media ms",
            "p99 ms",
            "p99,9 ms",
            "Máx ms",
            "Máx ms sin 2 s iniciales",
            "Bloques > presupuesto",
            "Carga media %",
            "Voces máx"
        ],
        bl.resultados.map((r) => {
            const o = r.opciones;
            const opt = [
                o.effects ? "efectos" : "sin efectos",
                o.interpolation === 0 ? "lineal" : "hermite",
                o.voiceCap !== 350 ? `máx ${o.voiceCap} voces` : ""
            ]
                .filter(Boolean)
                .join(", ");
            return [
                short[r.midi],
                r.soundfont,
                opt,
                `${r.throttling_cpu}×`,
                r.bloque_ms.media.toFixed(3),
                r.bloque_ms.p99.toFixed(3),
                r.bloque_ms.p999.toFixed(2),
                r.bloque_ms.max.toFixed(2),
                r.bloque_ms_sin_2s_iniciales.max.toFixed(2),
                `${r.bloques_sobre_presupuesto} (${r.pct_bloques_sobre_presupuesto.toFixed(2)} %)`,
                f1(r.carga_media_pct),
                r.voces_max
            ];
        })
    );
}

const mem = read("bench_memoria.json");
if (mem) {
    out.push("## Memoria (tras GC, sintetizador vivo)", "");
    const base = mem.resultados[0];
    const baseR = Math.max(
        ...base.procesos
            .filter((p) => p.tipo === "renderer")
            .map((p) => p.rss ?? 0)
    );
    out.push(
        `Referencia, página vacía: montón JS ${MB(base.heap.usedSize)} MB, RSS del renderer ${MB(baseR)} MB.`,
        ""
    );
    table(
        [
            "Obra",
            "Soundfont",
            "Montón JS usado (MB)",
            "ArrayBuffers (MB)",
            "RSS renderer (MB)"
        ],
        mem.resultados
            .slice(1)
            .map((r) => [
                short[r.midi],
                r.soundfont,
                MB(r.heap.usedSize),
                r.heap.backingStorageSize !== undefined
                    ? MB(r.heap.backingStorageSize)
                    : "—",
                MB(
                    Math.max(
                        ...r.procesos
                            .filter((p) => p.tipo === "renderer")
                            .map((p) => p.rss ?? 0)
                    )
                )
            ])
    );
}

const rt = read("bench_tiemporeal.json");
if (rt) {
    out.push(
        "## Tiempo real: CPU por proceso durante 30 s (% de un núcleo)",
        ""
    );
    const types = [
        ...new Set(rt.resultados.flatMap((r) => r.procesos.map((p) => p.tipo)))
    ];
    table(
        [
            "Caso",
            "Soundfont",
            ...types.map((t) => `${t} %`),
            "Total %",
            "Voces máx",
            "Carga soundfont (ms)"
        ],
        rt.resultados.map((r) => {
            const by = (t) =>
                r.procesos
                    .filter((p) => p.tipo === t)
                    .reduce((a, p) => a + (p.cpu_pct_un_nucleo ?? 0), 0);
            const tot = r.procesos.reduce(
                (a, p) => a + (p.cpu_pct_un_nucleo ?? 0),
                0
            );
            return [
                `${r.caso}${r.midi ? ` (${short[r.midi]})` : ""}`,
                r.soundfont ?? "—",
                ...types.map((t) => f1(by(t))),
                f1(tot),
                r.fin?.voces_max ?? "—",
                r.inicio ? r.inicio.ms_carga_soundfont.toFixed(0) : "—"
            ];
        })
    );
}

const tm = read("bench_temporizado.json");
if (tm) {
    out.push("## Temporizado (muestras a 44,1 kHz)", "");
    table(
        [
            "Prueba",
            "Clics detectados",
            "Retardo del 1er ataque",
            "Error mín",
            "Error máx",
            "Fases distintas módulo 128"
        ],
        Object.entries(tm.resultados).map(([k, v]) => [
            k,
            `${v.clics_detectados}/${v.clics_esperados}`,
            v.retardo_ataque_muestras,
            Math.min(...v.error_muestras_lista),
            Math.max(...v.error_muestras_lista),
            v.ataques_mod_128_distintos
        ])
    );
}

const sy = read("bench_sincronia.json");
if (sy) {
    out.push("## Sincronía con reloj externo (tiempo real, 24 s)", "");
    table(
        [
            "Estrategia",
            "Desvío del visor",
            "Clics",
            "Error abs. medio ms",
            "p95 ms",
            "Máx ms",
            "Saltos",
            "Reloj audio vs performance.now (ms por s)",
            "Residuo máx. del ajuste (ms)"
        ],
        sy.resultados.map((r) => [
            r.estrategia,
            r.skew,
            r.clics_detectados,
            f1(r.error_abs_ms.media),
            f1(r.error_abs_ms.p95),
            f1(r.error_abs_ms.max),
            r.correcciones.saltos,
            r.ms_perf_por_s_audio.toFixed(2),
            f1(r.residuo_max_ms_ajuste_reloj)
        ])
    );
}

fs.writeFileSync(
    path.join(RES, "tablas.md"),
    `# Tablas generadas desde resultados/*.json\n\n${out.join("\n")}`
);
console.log(out.join("\n"));
