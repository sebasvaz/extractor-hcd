/**
 * Visor local de la HCD — `visor.html` dentro del ZIP.
 *
 * El titular descomprime el ZIP y abre `visor.html` con doble click: ve toda
 * su historia como una línea de tiempo filtrable y con búsqueda de texto,
 * sin instalar nada y sin conexión a internet.
 *
 * Decisiones:
 *  - Un único HTML autocontenido: CSS y JS van inline (importados `?raw`),
 *    nada se carga desde la red. La CSP del propio visor bloquea `connect-src`.
 *  - El índice (metadata y HTML de cada documento) va embebido como JSON en
 *    un `<script type="application/json">`, con `<` escapado. Así el visor no
 *    necesita `fetch` (bloqueado en `file://` por los navegadores) y extrae en
 *    el navegador el texto, el cabezal, vacunas, diagnósticos y medicamentos
 *    con el mismo código que el visor suelto (viewer-extract.js).
 *  - Los documentos se muestran en un `<iframe sandbox>` apuntando al HTML
 *    original de `docs/`: el visor no los reescribe y los scripts que pudiera
 *    traer el HTML del portal no se ejecutan.
 *  - Con anonimización activada no se muestra `patient.displayName` (que en
 *    `metadata.json` queda en claro): el visor no debe reintroducir el nombre
 *    en un HTML que el pipeline de la plataforma escanea por PII residual.
 *  - El HTML embebido es el mismo de `docs/` (ya anonimizado si corresponde) y
 *    va dentro de `<script>` con `<` escapado: el escaneo de PII de la
 *    plataforma ignora ese bloque, y el contenido ya se escanea en `docs/`.
 */

import type { CapturedDocument } from '../messaging/types';
import type { HCDExportMetadata } from '../zip-builder';

import pkg from '../../../package.json';

import viewerCss from './viewer.css?raw';
import viewerJs from './viewer-client.js?raw';
import viewerLoaderJs from './viewer-loader.js?raw';
import viewerExtractJs from './viewer-extract.js?raw';
import viewerNormalizeJs from './viewer-normalize.js?raw';

/** Versión del visor (la de la extensión que lo generó). */
export const VIEWER_VERSION: string = pkg.version;

/** Nombre del visor dentro del ZIP (raíz). */
export const VIEWER_FILE = 'visor.html';

/** Shape del JSON embebido que consume `viewer-client.js`. */
export type ViewerData = {
  exportedAt: string;
  exportId?: string;
  /** Versión de la extensión que generó el ZIP, si se conoce. */
  extensionVersion?: string;
  /** Versión del visor que muestra los datos. */
  viewerVersion: string;
  anonymized: boolean;
  /** Nombre del titular; `null` si el paquete es anonimizado o no se detectó. */
  patientName: string | null;
  totals: HCDExportMetadata['totals'];
  documents: Array<{
    id: string;
    file: string;
    categoria: string;
    fecha: string;
    prestador?: string;
    profesional?: string;
    descripcion?: string;
    /** Ruta del PDF adjunto (CDA nivel 1); el visor lo muestra en lugar del HTML. */
    pdf?: string;
    /**
     * HTML del documento. El visor extrae de acá, en el navegador, el texto
     * de búsqueda, el cabezal, vacunas, diagnósticos y medicamentos
     * (viewer-extract.js), y lo descarta. Ausente para PDFs.
     */
    html?: string;
  }>;
  errors: HCDExportMetadata['errors'];
};

export type ViewerOptions = {
  /** Versión de la extensión (chrome.runtime.getManifest().version). */
  extensionVersion?: string;
};

export function buildViewerData(
  metadata: HCDExportMetadata,
  documents: CapturedDocument[],
  opts: ViewerOptions = {},
): ViewerData {
  const htmlById = new Map(documents.map((d) => [d.id, d.html]));
  const anonymized = Boolean(metadata.anonymized);
  const name = metadata.patient.displayName.trim();
  const extensionVersion = opts.extensionVersion ?? metadata.anonymization?.version;
  return {
    exportedAt: metadata.exportedAt,
    exportId: metadata.exportId,
    ...(extensionVersion ? { extensionVersion } : {}),
    viewerVersion: VIEWER_VERSION,
    anonymized,
    patientName: anonymized || !name || name === 'paciente' ? null : name,
    totals: metadata.totals,
    documents: metadata.documents.map((d) => {
      const out: ViewerData['documents'][number] = {
        id: d.id,
        file: d.file,
        categoria: d.categoria,
        fecha: d.fecha,
      };
      if (d.prestador !== undefined) out.prestador = d.prestador;
      if (d.profesional !== undefined) out.profesional = d.profesional;
      if (d.descripcion !== undefined) out.descripcion = d.descripcion;
      if (d.attachmentFile !== undefined) {
        out.pdf = d.attachmentFile;
      } else {
        out.html = htmlById.get(d.id) ?? '';
      }
      return out;
    }),
    errors: metadata.errors,
  };
}

/** Arma el `visor.html` completo. */
export function buildViewerHtml(
  metadata: HCDExportMetadata,
  documents: CapturedDocument[],
  opts: ViewerOptions = {},
): string {
  const data = buildViewerData(metadata, documents, opts);
  // `<` escapado: el JSON no puede cerrar el <script> que lo contiene.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return page({
    frameSrc: "'self' file:",
    body: `<script type="application/json" id="hcd-data">${json}</script>
<script>
${viewerExtractJs}
</script>
<script>
${viewerNormalizeJs}
</script>
<script>
${viewerJs}
</script>`,
  });
}

/** Nombre del visor suelto que se publica con cada release. */
export const STANDALONE_VIEWER_FILE = 'visor-hc.html';

/**
 * Visor suelto para ZIPs descargados antes de que el paquete trajera
 * `visor.html`: el titular abre `visor-hc.html` y elige su ZIP, que se lee en
 * el navegador con JSZip (inline, `jszipSource` = `jszip.min.js`) sin salir
 * de la computadora. Los documentos se muestran con `srcdoc` (HTML) o URLs
 * `blob:` (PDF), así que no hace falta descomprimir nada.
 */
export function buildStandaloneViewerHtml(jszipSource: string): string {
  return page({
    // data: para imágenes y PDF que el propio documento embebe en un iframe.
    frameSrc: 'blob: data:',
    body: `<script>window.HCD_VIEWER_VERSION = ${JSON.stringify(VIEWER_VERSION)};</script>
<script>
${jszipSource.replace(/<\/script/gi, '<\\/script')}
</script>
<script>
${viewerExtractJs}
</script>
<script>
${viewerNormalizeJs}
</script>
<script>
${viewerJs}
</script>
<script>
${viewerLoaderJs}
</script>`,
  });
}

function page(opts: { frameSrc: string; body: string }): string {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    `frame-src ${opts.frameSrc}`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<title>Mi historia clínica</title>
<style>
${viewerCss}
</style>
</head>
<body>
<noscript><p class="noscript">El visor necesita JavaScript. Los documentos también pueden abrirse uno por uno desde la carpeta <code>docs/</code>.</p></noscript>
<div id="app"></div>
${opts.body}
</body>
</html>
`;
}
