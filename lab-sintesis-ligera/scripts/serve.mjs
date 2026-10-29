// Servidor estático mínimo para la demo y los benchmarks.
// Sirve la raíz del repositorio (para alcanzar node_modules/) con COOP/COEP,
// de modo que la página quede "crossOriginIsolated" (temporizadores finos y
// performance.measureUserAgentSpecificMemory()).
// Uso: node lab-sintesis-ligera/scripts/serve.mjs [puerto]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
);
const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".css": "text/css",
    ".wasm": "application/wasm",
    ".mid": "audio/midi"
};

export function startServer(port = 0) {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://x");
        const file = path.normalize(
            path.join(ROOT, decodeURIComponent(url.pathname))
        );
        if (
            !file.startsWith(ROOT) ||
            !fs.existsSync(file) ||
            fs.statSync(file).isDirectory()
        ) {
            res.writeHead(404).end("no encontrado");
            return;
        }
        res.writeHead(200, {
            "Content-Type":
                TYPES[path.extname(file)] ?? "application/octet-stream",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cache-Control": "no-store"
        });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve) =>
        server.listen(port, "127.0.0.1", () => resolve(server))
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const server = await startServer(Number(process.argv[2] ?? 8123));
    const { port } = server.address();
    console.log(
        `Demo: http://127.0.0.1:${port}/lab-sintesis-ligera/demo/index.html`
    );
}
