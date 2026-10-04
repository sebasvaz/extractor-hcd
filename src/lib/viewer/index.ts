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
 *  - El índice (metadata de cada documento + texto plano para la búsqueda)
 *    va embebido como JSON en un `<script type="application/json">`. Así el
 *    visor no necesita `fetch` (bloqueado en `file://` por los navegadores).
 *  - Los documentos se muestran en un `<iframe sandbox>` apuntando al HTML
 *    original de `docs/`: el visor no los reescribe y los scripts que pudiera
 *    traer el HTML del portal no se ejecutan.
 *  - Con anonimización activada no se muestra `patient.displayName` (que en
 *    `metadata.json` queda en claro): el visor no debe reintroducir el nombre
 *    en un HTML que el pipeline de la plataforma escanea por PII residual.
 *  - El texto de búsqueda sale del HTML ya anonimizado (si corresponde) y va
 *    dentro de `<script>`, que el escaneo de PII de la plataforma ignora; el
 *    mismo texto ya está en los `docs/*.html` que sí se escanean.
 */

import type { CapturedDocument } from '../messaging/types';
import type { HCDExportMetadata } from '../zip-builder';

import pkg from '../../../package.json';

import viewerCss from './viewer.css?raw';
import viewerJs from './viewer-client.js?raw';
import viewerLoaderJs from './viewer-loader.js?raw';
import viewerNormalizeJs from './viewer-normalize.js?raw';

/** Versión del visor (la de la extensión que lo generó). */
export const VIEWER_VERSION: string = pkg.version;

/** Nombre del visor dentro del ZIP (raíz). */
export const VIEWER_FILE = 'visor.html';

/** Tope de texto indexado por documento, para acotar el tamaño del visor. */
export const MAX_TEXT_CHARS = 30_000;

/** Datos del cabezal CDA que usa el visor. Nunca los del paciente. */
export type CdaHeader = {
  titulo?: string;
  prestador?: string;
  profesional?: string;
  fechaHora?: string;
};

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
    /** Texto plano del documento para la búsqueda. Vacío para PDFs. */
    text: string;
    /** Cabezal del documento; el cliente lo usa para normalizar y lo descarta. */
    cda?: CdaHeader;
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
        text: '',
      };
      if (d.prestador !== undefined) out.prestador = d.prestador;
      if (d.profesional !== undefined) out.profesional = d.profesional;
      if (d.descripcion !== undefined) out.descripcion = d.descripcion;
      if (d.attachmentFile !== undefined) {
        out.pdf = d.attachmentFile;
      } else {
        const html = htmlById.get(d.id) ?? '';
        out.text = htmlToPlainText(html).slice(0, MAX_TEXT_CHARS);
        const cda = extractCdaHeader(html);
        if (Object.keys(cda).length) out.cda = cda;
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

// ---------------------------------------------------------------------------
// Cabezal CDA (sin DOM: corre en el service worker)
// ---------------------------------------------------------------------------

const CDA_LABELS: Record<string, keyof CdaHeader> = {
  prestador: 'prestador',
  profesional: 'profesional',
  'fecha del evento': 'fechaHora',
};

/**
 * Título, prestador, profesional y fecha del evento del cabezal del CDA de
 * Mi HCD (`<td><span class="td_label">Prestador</span></td><td>…</td>`).
 * A propósito no lee Nombre, Documento, Fecha de nacimiento ni Sexo.
 */
export function extractCdaHeader(html: string): CdaHeader {
  const out: CdaHeader = {};
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title) {
    const t = htmlToPlainText(title[1] ?? '');
    if (t) out.titulo = t;
  }
  const row = /<td[^>]*>\s*(?:<span[^>]*\btd_label\b[^>]*>)?\s*([^<]{3,40}?)\s*(?:<\/span>)?\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = row.exec(html))) {
    const key = CDA_LABELS[(m[1] ?? '').trim().toLowerCase()];
    if (!key || out[key]) continue;
    const value = htmlToPlainText(m[2] ?? '');
    if (value) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTML → texto plano (sin DOM: corre en el service worker)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü',
  ordm: 'º', ordf: 'ª', deg: '°', middot: '·', laquo: '«', raquo: '»',
  iquest: '¿', iexcl: '¡', ndash: '–', mdash: '—', hellip: '…', micro: 'µ',
};

/**
 * Texto visible de un HTML, con espacios colapsados. Quita `<head>`,
 * `<script>`, `<style>` y comentarios; los tags de bloque se convierten en
 * saltos para que las palabras de celdas contiguas no queden pegadas.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<pre\b[^>]*\bid=["']?b64\b[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
      if (ent[0] === '#') {
        const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
      }
      return NAMED_ENTITIES[ent] ?? whole;
    })
    .replace(/[\s ]+/g, ' ')
    .trim();
}
