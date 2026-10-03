/**
 * Genera el visor suelto `visor-hc.html` (ver `buildStandaloneViewerHtml`):
 * un HTML único, con JSZip inline, para abrir ZIPs descargados con versiones
 * de la extensión que todavía no traían visor.html.
 *
 * Uso: npm run build:visor [-- <carpeta-salida>]   (por defecto: release/)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { buildStandaloneViewerHtml, STANDALONE_VIEWER_FILE } from '../src/lib/viewer';

const outDir = process.argv[2] ?? 'release';
const require = createRequire(import.meta.url);
const jszip = readFileSync(require.resolve('jszip/dist/jszip.min.js'), 'utf8');

mkdirSync(outDir, { recursive: true });
const out = join(outDir, STANDALONE_VIEWER_FILE);
writeFileSync(out, buildStandaloneViewerHtml(jszip));
console.log(out);
