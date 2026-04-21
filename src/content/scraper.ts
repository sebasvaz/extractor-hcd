/**
 * Content script — Extractor de HCD, Proyecto IPS ORT.
 *
 * Alineado a la Especificación Técnica v1.0 (sección 6).
 *
 * Rol: "ojos y manos" dentro de la sesión autenticada del titular en
 * Mi HCD. No decide qué hacer (eso es del service worker); solo ejecuta
 * comandos atómicos y reporta el resultado.
 *
 * Comandos que responde (ContentRequest):
 *   - PING
 *   - READ_TOTAL_RECORDS
 *   - LIST_EVENTS_ON_CURRENT_PAGE
 *   - GO_TO_PAGE { page }
 *   - CLICK_EVENT_BY_INDEX { index }
 *   - WAIT_FOR_DETAIL_AND_EXTRACT { meta }
 *   - NAVIGATE_BACK_TO_TIMELINE
 *   - SHOW_OVERLAY / HIDE_OVERLAY / UPDATE_OVERLAY { progress }
 *
 * Invariantes:
 *  - Todo dentro del origen https://historiaclinicadigital.gub.uy
 *  - No navega a dominios externos. No hace fetch cross-origin.
 *  - Respeta los postbacks GeneXus: usa .click() nativo, NO reemplaza forms.
 */

import type {
  AnyResponse,
  CapturedDocument,
  ContentRequest,
  EventMetadata,
} from '@lib/messaging/types';
import { err, ok } from '@lib/messaging/types';
import {
  RE_FECHA_DDMMYYYY,
  RE_TIMELINE,
  RE_VISUALIZAR,
  SEL,
  URLS,
} from '@lib/selectors';
import { parseSidebarCount, parseTotalRecordsLine } from '@lib/pagination';
import { CATEGORIAS } from '@lib/categories';
import { hideOverlay, showOverlay, updateOverlay } from './overlay';

// ---------------------------------------------------------------------------
// Solo ejecutamos la lógica en el top frame. El iframe CONTENIDOHTML también
// recibe este script (all_frames:true) pero no debe registrar handlers.
// ---------------------------------------------------------------------------

if (window.top === window) {
  chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
    void dispatch(message)
      .then((resp) => sendResponse(resp))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        sendResponse(err('CONTENT_EXCEPTION', msg));
      });
    return true; // respuesta asíncrona
  });
}

async function dispatch(message: ContentRequest): Promise<AnyResponse> {
  switch (message.type) {
    case 'PING':
      return ok({ timestamp: new Date().toISOString(), url: window.location.href });

    case 'READ_TOTAL_RECORDS': {
      const total = readTotalRecords();
      if (total === null) return err('TOTAL_NOT_FOUND', 'No se pudo leer el total de registros.');
      return ok({ total });
    }

    case 'LIST_EVENTS_ON_CURRENT_PAGE': {
      const events = listEventsOnCurrentPage();
      if (events.length === 0) {
        // Diagnóstico automático: ayuda a detectar cambios en el DOM del
        // portal cuando los selectores centrales dejan de matchear.
        const diagnostics = dumpDomDiagnostics();
        return ok({ events, diagnostics });
      }
      return ok({ events });
    }

    case 'CLICK_EVENT_BY_INDEX': {
      const done = clickEventByIndex(message.index);
      if (!done) return err('CLICK_FAILED', `No hay evento en índice ${message.index}.`);
      return ok({ clicked: true });
    }

    case 'WAIT_FOR_DETAIL_AND_EXTRACT': {
      try {
        const doc = await waitForDetailAndExtract(message.meta);
        return ok<{ doc: CapturedDocument }>({ doc });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('EXTRACT_FAILED', msg);
      }
    }

    case 'NAVIGATE_BACK_TO_TIMELINE': {
      try {
        await navigateBackToTimeline();
        return ok({ navigated: true });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('BACK_FAILED', msg);
      }
    }

    case 'GO_TO_PAGE': {
      try {
        await goToPage(message.page);
        return ok({ page: message.page });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('PAGINATION_FAILED', msg);
      }
    }

    case 'SHOW_OVERLAY':
      showOverlay();
      return ok({ shown: true });

    case 'HIDE_OVERLAY':
      hideOverlay();
      return ok({ hidden: true });

    case 'UPDATE_OVERLAY':
      updateOverlay(message.progress);
      return ok({ updated: true });

    default: {
      const _exhaustive: never = message;
      return err('UNKNOWN_MESSAGE', `Mensaje no manejado: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Lectura del total (spec §6.3.1)
// ---------------------------------------------------------------------------

function readTotalRecords(): number | null {
  const bodyText = document.body?.innerText ?? '';
  const line = parseTotalRecordsLine(bodyText);
  if (line) return line.total;
  return parseSidebarCount(bodyText);
}

// ---------------------------------------------------------------------------
// Listado de eventos en la página actual (spec §6.3.2)
// ---------------------------------------------------------------------------

type RowSnapshot = {
  anchor: HTMLAnchorElement;
  row: HTMLElement;
  meta: EventMetadata;
};

let currentRows: RowSnapshot[] = [];

function listEventsOnCurrentPage(): EventMetadata[] {
  currentRows = [];

  // Estrategia 1: anchors directos (rápido, preciso).
  const anchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(SEL.eventAnchors),
  );

  const seen: Set<string> = new Set();
  const tryAnchor = (a: HTMLAnchorElement): void => {
    const row = findRow(a);
    if (!row) return;
    const rowText = (row.innerText || row.textContent || '').trim();
    if (!rowText) return;

    const categoria = findCategoriaInText(rowText);
    if (!categoria) return; // descartamos controles de paginación, etc.

    const fechaIso = findFechaInText(rowText);
    if (!fechaIso) return;

    const descripcion = extractDescripcion(row, categoria, rowText);
    const prestador = extractCell(row, ['Prestador', 'Institución']);
    const profesional = extractCell(row, ['Profesional', 'Médico']);

    const provisionalId = `${fechaIso}_${slug(categoria)}_${slug(descripcion ?? '')}`;
    if (seen.has(provisionalId)) return;
    seen.add(provisionalId);

    const meta: EventMetadata = {
      id: provisionalId,
      categoria,
      fecha: fechaIso,
    };
    if (prestador !== undefined) meta.prestador = prestador;
    if (profesional !== undefined) meta.profesional = profesional;
    if (descripcion !== undefined) meta.descripcion = descripcion;

    currentRows.push({ anchor: a, row, meta });
  };

  anchors.forEach(tryAnchor);

  // Estrategia 2: si no encontramos nada por anchors, recorrer filas.
  if (currentRows.length === 0) {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(SEL.eventRows));
    rows.forEach((row) => {
      const a = row.querySelector<HTMLAnchorElement>(
        'a[onclick], a[href*="visualizarcda" i], a[data-gx-evt], a[data-gx-evtrow]',
      );
      if (a) tryAnchor(a);
    });
  }

  return currentRows.map((r) => r.meta);
}

// ---------------------------------------------------------------------------
// Diagnóstico del DOM (solo cuando listEventsOnCurrentPage devuelve 0)
// ---------------------------------------------------------------------------

function dumpDomDiagnostics(): Record<string, unknown> {
  const countSelector = (sel: string): number => {
    try {
      return document.querySelectorAll(sel).length;
    } catch {
      return -1;
    }
  };

  const counts = {
    tables: countSelector('table'),
    trs: countSelector('tr'),
    tbodyTrs: countSelector('tbody tr'),
    anchors: countSelector('a'),
    aDataGxEvt: countSelector('a[data-gx-evt]'),
    aDataGxEvt5: countSelector('a[data-gx-evt="5"]'),
    aOnclick: countSelector('a[onclick]'),
    aVisualizarCda: countSelector('a[href*="visualizarcda" i]'),
    dataGxRow: countSelector('[data-gx-row]'),
    dataGxEvtRow: countSelector('[data-gx-evtrow]'),
    iframes: countSelector('iframe'),
  };

  const attrNames = new Set<string>();
  document.querySelectorAll('a, tr').forEach((el) => {
    for (const attr of Array.from(el.attributes)) attrNames.add(attr.name);
  });

  const sampleRows = Array.from(document.querySelectorAll('tbody tr'))
    .slice(0, 3)
    .map((tr, i) => ({
      idx: i,
      snippet: (tr.outerHTML || '').slice(0, 600),
      text: ((tr as HTMLElement).innerText || tr.textContent || '').trim().slice(0, 200),
    }));

  const sampleAnchors = Array.from(document.querySelectorAll('a'))
    .slice(0, 10)
    .map((a, i) => {
      const el = a as HTMLAnchorElement;
      return {
        idx: i,
        text: (el.textContent || '').trim().slice(0, 80),
        href: (el.getAttribute('href') || '').slice(0, 120),
        onclick: (el.getAttribute('onclick') || '').slice(0, 120),
        attrs: Array.from(el.attributes).map((a2) => a2.name),
      };
    });

  return {
    url: window.location.href,
    counts,
    attrNames: Array.from(attrNames).sort(),
    sampleRows,
    sampleAnchors,
  };
}

function findRow(anchor: HTMLAnchorElement): HTMLElement | null {
  // El DOM de Mi HCD anida el anchor ~11 niveles dentro del <tr>
  // (component HistoryLine: a < span < p < div.gx-attribute <
  //  div#SECTIONCATEGORIA_NNNN < div.col-xs-12 < div.row <
  //  div#TABLEACCION_NNNN < div#RIGTH_NNNN < div#CONTENTGRID_NNNN < td < tr).
  //
  // Por eso `closest('tr')` (que sube a cualquier profundidad) es la
  // estrategia correcta. Fallbacks en orden de especificidad decreciente.
  const tr = anchor.closest('tr') as HTMLElement | null;
  if (tr) return tr;

  // Algunas vistas GeneXus usan data-gx-row/data-gx-evtrow en lugar de <tr>.
  const gxRow = anchor.closest(
    '[data-gx-row], [data-gx-evtrow]',
  ) as HTMLElement | null;
  if (gxRow) return gxRow;

  // Último recurso: CONTENTGRID_NNNN — contenedor por evento en Mi HCD.
  // Contiene la categoría, fecha, descripción, prestador y profesional,
  // por lo que `findCategoriaInText` + `findFechaInText` funcionan sobre él.
  const contentGrid = anchor.closest(
    'div[id^="CONTENTGRID_"], div[id^="RIGTH_"], div[id^="TABLEACCION_"]',
  ) as HTMLElement | null;
  if (contentGrid) return contentGrid;

  return null;
}

function findCategoriaInText(text: string): string | null {
  for (const c of CATEGORIAS) {
    // Coincidencia laxa por palabra (considerando tildes).
    const re = new RegExp(escapeRegex(c), 'i');
    if (re.test(text)) return c;
  }
  return null;
}

function findFechaInText(text: string): string | null {
  const m = RE_FECHA_DDMMYYYY.exec(text);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function extractDescripcion(row: HTMLElement, categoria: string, rowText: string): string | undefined {
  // La descripción suele ser la celda más "larga" de la fila que NO es la
  // fecha, categoría, prestador ni profesional. Estrategia práctica:
  //   1. Buscar celdas <td> o hijos con texto.
  //   2. Tomar la de mayor longitud que no coincida con patrones conocidos.
  const candidates = Array.from(row.querySelectorAll<HTMLElement>('td, span, div'))
    .map((c) => (c.innerText || c.textContent || '').trim())
    .filter((t) => t.length > 0 && t.length < 300);

  const blacklist = new Set([categoria.toLowerCase(), '', 'ver', 'detalle']);
  const ranked = candidates
    .filter((t) => !blacklist.has(t.toLowerCase()))
    .filter((t) => !RE_FECHA_DDMMYYYY.test(t.trim()) || t.trim().length > 10)
    .sort((a, b) => b.length - a.length);

  const best = ranked[0];
  if (!best) return undefined;
  if (best === rowText) return undefined; // evitamos dumpear toda la fila
  return best;
}

function extractCell(row: HTMLElement, hints: string[]): string | undefined {
  // Heurística: buscar una celda cuyo "header" anterior (una celda con clase
  // *label/headline*) contenga alguno de los `hints`.
  const cells = Array.from(row.querySelectorAll<HTMLElement>('td, span, div'));
  for (let i = 0; i < cells.length; i++) {
    const txt = (cells[i]!.innerText || cells[i]!.textContent || '').trim();
    for (const h of hints) {
      if (txt.toLowerCase().startsWith(h.toLowerCase() + ':')) {
        const value = txt.slice(h.length + 1).trim();
        if (value) return value;
      }
    }
  }
  return undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// Click por índice + espera por detalle (spec §6.4)
// ---------------------------------------------------------------------------

function clickEventByIndex(index: number): boolean {
  let row = currentRows[index];
  // Tras un history.back() desde el detalle, GeneXus re-renderiza la grilla
  // del timeline desde el GXState. Los anchors cacheados quedan detachados
  // del DOM en vida — un .click() sobre ellos no dispara postback y el SW
  // se queda esperando el cambio de URL hasta el timeout. Si detectamos que
  // el anchor ya no está en el árbol vivo, re-listamos y reusamos el mismo
  // índice (GeneXus conserva el orden al rehidratar).
  if (!row || !row.anchor.isConnected) {
    listEventsOnCurrentPage();
    row = currentRows[index];
    if (!row) return false;
  }
  // scrollIntoView para asegurar que el anchor esté renderizado y no virtualizado.
  row.anchor.scrollIntoView({ block: 'center', inline: 'nearest' });
  // click() nativo → dispara el postback GeneXus (evt=5) sobre el mismo form.
  row.anchor.click();
  return true;
}

async function waitForDetailAndExtract(meta: EventMetadata): Promise<CapturedDocument> {
  await waitForUrl(RE_VISUALIZAR, 15000);
  const iframe = await waitForSelector<HTMLIFrameElement>(SEL.iframeContenidoHtml, 15000);
  const capturedAt = new Date().toISOString();

  const iframeDoc = iframe.contentDocument;
  if (!iframeDoc) {
    throw new Error('No hay contentDocument en el iframe CONTENIDOHTML (posible cambio de origen).');
  }

  // Esperamos a que el body del iframe tenga texto suficiente (umbral § 6.4.2).
  // Condición relajada: si es CDA nivel 1 (tiene <pre id="b64">), el body es
  // casi vacío y el contenido real está en el base64 → aceptamos cuando
  // detectamos el <pre> con base64 no trivial.
  await waitUntil(() => {
    const len = (iframeDoc.body?.innerText || iframeDoc.body?.textContent || '').trim().length;
    if (len >= 200) return true;
    const pre = iframeDoc.getElementById('b64');
    if (pre && (pre.textContent ?? '').trim().length >= 200) return true;
    return false;
  }, 15000);

  const visualizarUrl = window.location.href;
  const captureUrl = iframe.src || visualizarUrl;

  // Detectar y extraer adjunto PDF (CDA nivel 1: VisorPDF.js + <pre id="b64">).
  const attachment = await extractCdaLevel1Attachment(iframeDoc);

  const html = attachment
    ? buildAttachmentHtml(meta, attachment.sha256)
    : serializeFullDocument(iframeDoc);

  const sha256 = await sha256OfString(html);

  const captured: CapturedDocument = {
    id: meta.id,
    categoria: meta.categoria,
    fecha: meta.fecha,
    ...(meta.prestador !== undefined ? { prestador: meta.prestador } : {}),
    ...(meta.profesional !== undefined ? { profesional: meta.profesional } : {}),
    ...(meta.descripcion !== undefined ? { descripcion: meta.descripcion } : {}),
    visualizarUrl,
    captureUrl,
    capturedAt,
    html,
    sha256,
  };

  if (attachment) {
    captured.attachmentBase64 = attachment.base64;
    captured.attachmentMime = 'application/pdf';
    captured.attachmentSha256 = attachment.sha256;
  }

  return captured;
}

type CdaLevel1Attachment = {
  base64: string; // sin data-url prefix, sólo el payload base64
  sha256: string; // hash hex de los bytes del PDF
};

/**
 * Detecta el patrón de CDA nivel 1 del portal (Laboratorio y algunos otros):
 * el iframe CONTENIDOHTML trae un `<pre id="b64" style="display:none">` con
 * el PDF codificado en base64, más un `<script src="VisorPDF.js">` que lo
 * materializa en tiempo real en el viewer. Nos importa el payload crudo, no
 * el visor — extraemos el PDF para guardarlo como archivo separado.
 *
 * Devuelve null si no es CDA nivel 1 o si los bytes no pasan la validación
 * mágica `%PDF`. Un documento sin PDF adjunto se capturará por la rama
 * normal (HTML serializado del iframe).
 */
async function extractCdaLevel1Attachment(doc: Document): Promise<CdaLevel1Attachment | null> {
  const pre = doc.getElementById('b64');
  if (!pre) return null;
  const raw = (pre.textContent ?? '').replace(/\s+/g, '');
  if (raw.length < 100) return null;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(raw);
  } catch {
    return null;
  }
  // Magic number: %PDF-
  if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return null;
  }
  // Re-encodeamos desde bytes (normaliza: el <pre> podía traer whitespace
  // ignorable por atob pero que alteraría un hash posterior).
  const base64 = bytesToBase64(bytes);
  const sha256 = await sha256HexOfBytes(bytes);
  return { base64, sha256 };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunk a 32 KiB para evitar "argument list too large" en fromCharCode.
  const CHUNK = 0x8000;
  const pieces: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    pieces.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, end)) as number[]));
  }
  return btoa(pieces.join(''));
}

async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  // Copiamos a un ArrayBuffer concreto — TS 5.x distingue entre
  // Uint8Array<ArrayBuffer> y Uint8Array<ArrayBufferLike> y crypto.subtle
  // solo acepta el primero. El .slice() produce un ArrayBuffer "puro".
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', ab);
  const out = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < out.length; i++) hex += out[i]!.toString(16).padStart(2, '0');
  return hex;
}

/**
 * HTML mínimo standalone que reemplaza al visor JS del portal. Incluye los
 * metadatos del evento y un <embed> al PDF adjunto (ruta relativa dentro
 * del mismo directorio `docs/`). Si el browser no soporta inline PDF,
 * muestra el link de fallback.
 */
function buildAttachmentHtml(meta: EventMetadata, attachmentSha256: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pdfName = `${meta.id}.pdf`;
  const desc = meta.descripcion ? esc(meta.descripcion) : '';
  const prest = meta.prestador ? esc(meta.prestador) : '';
  const prof = meta.profesional ? esc(meta.profesional) : '';
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(meta.categoria)} — ${esc(meta.fecha)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; background:#f5f5f5; }
  header { background:#fff; padding:16px; border-radius:8px; margin-bottom:12px; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  h1 { margin:0 0 8px 0; font-size:20px; }
  dl { margin:0; display:grid; grid-template-columns: max-content 1fr; gap:4px 12px; }
  dt { font-weight:600; color:#555; }
  embed, object { width:100%; height:85vh; border:0; background:#fff; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .fallback { padding:16px; background:#fff; border-radius:8px; }
</style>
</head>
<body>
<header>
  <h1>${esc(meta.categoria)} — ${esc(meta.fecha)}</h1>
  <dl>
    ${desc ? `<dt>Descripción</dt><dd>${desc}</dd>` : ''}
    ${prest ? `<dt>Prestador</dt><dd>${prest}</dd>` : ''}
    ${prof ? `<dt>Profesional</dt><dd>${prof}</dd>` : ''}
    <dt>Tipo</dt><dd>CDA nivel 1 — PDF adjunto</dd>
    <dt>Archivo</dt><dd><a href="./${pdfName}">${pdfName}</a></dd>
    <dt>SHA-256</dt><dd><code>${attachmentSha256}</code></dd>
  </dl>
</header>
<embed src="./${pdfName}" type="application/pdf">
<noscript class="fallback"><a href="./${pdfName}">Descargar ${pdfName}</a></noscript>
</body>
</html>`;
}

async function sha256OfString(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0');
  return out;
}

function serializeFullDocument(doc: Document): string {
  // outerHTML del <html> + doctype si existe.
  const dt = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}${doc.doctype.publicId ? ` PUBLIC "${doc.doctype.publicId}"` : ''}${doc.doctype.systemId ? ` "${doc.doctype.systemId}"` : ''}>`
    : '<!DOCTYPE html>';
  const root = doc.documentElement?.outerHTML ?? '';
  // Mi HCD sirve el CDA con `<meta charset=ISO-8859-1>`, pero Chrome ya lo
  // tiene parseado en memoria como UTF-16 y cuando lo serializamos a string
  // los bytes que JSZip graba son UTF-8. Si dejáramos la meta tag original,
  // cualquier visor que abra el HTML standalone re-decodificaría los bytes
  // UTF-8 como ISO-8859-1 → mojibake en todas las tildes y ñ. Reescribimos
  // la meta a UTF-8 para que el archivo sea auto-descriptivo correctamente.
  return `${dt}\n${rewriteCharsetToUtf8(root)}`;
}

/**
 * Normaliza la declaración de charset del HTML a UTF-8, sea que venga como
 * `<meta charset="X">` (HTML5) o `<meta http-equiv="Content-Type"
 * content="text/html; charset=X">` (legacy). Si no hubiera ninguna meta,
 * inyecta una en el `<head>`.
 */
function rewriteCharsetToUtf8(html: string): string {
  let out = html.replace(
    /<meta\s+charset\s*=\s*(["'])?[^"'>\s]+\1?\s*\/?>/gi,
    '<meta charset="utf-8">',
  );
  out = out.replace(
    /<meta\s+http-equiv\s*=\s*(["'])?content-type\1?\s+content\s*=\s*(["'])[^"']*\2\s*\/?>/gi,
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
  );
  if (!/charset\s*=\s*["']?utf-?8/i.test(out)) {
    out = out.replace(/<head(\b[^>]*)>/i, '<head$1>\n<meta charset="utf-8">');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Navegación de retorno (spec §6.5)
// ---------------------------------------------------------------------------

async function navigateBackToTimeline(): Promise<void> {
  if (RE_TIMELINE.test(window.location.pathname)) return; // ya estamos
  // Estrategia principal: history.back(). El portal retiene paginación +
  // filtros en GXState de forma estable.
  history.back();
  try {
    await waitForUrl(RE_TIMELINE, 8000);
  } catch {
    // Fallback: navegación explícita al timeline.
    window.location.assign(URLS.TIMELINE);
    await waitForUrl(RE_TIMELINE, 10000);
  }
}

// ---------------------------------------------------------------------------
// Paginación (spec §6.3.3)
// ---------------------------------------------------------------------------

/**
 * PageSize nominal del portal Mi HCD. La línea "Mostrando del X al Y de T"
 * de la última página reporta a menudo Y-X+1 < 10 (ej. "del 41 al 45 de 45")
 * y eso confundiría el cálculo de currentPage si usáramos Y-X+1 como
 * pageSize. Asumimos 10 como constante del portal y derivamos la página
 * actual con `ceil(X/10)`.
 */
const PAGE_SIZE_NOMINAL = 10;

function readCurrentPageNumber(): number | null {
  const bodyText = document.body?.innerText ?? '';
  const line = parseTotalRecordsLine(bodyText);
  if (!line) return null;
  return Math.max(1, Math.ceil(line.from / PAGE_SIZE_NOMINAL));
}

/**
 * Idempotente: avanza el timeline hasta quedar en `targetPage`. Si ya
 * estamos ahí, no hace nada. Si estamos atrás, clickea "Siguiente" las
 * veces necesarias. Si estamos adelante, tira `BACKWARD_NAVIGATION` y el
 * service worker lo maneja haciendo un reset-to-TIMELINE y llamando de
 * nuevo (la URL del timeline resetea a pág 1).
 *
 * Motivación (bug de history.back): el postback de "Siguiente" NO hace
 * history.push, pero la navegación a /visualizarcda SÍ. Después de un
 * history.back desde el detalle, el DOM vuelve al estado previo en history
 * — que suele ser TIMELINE pág 1, incluso si el SW creía estar en pág 3.
 * goToPage idempotente reconcilia esa discrepancia antes de cada evento.
 */
async function goToPage(targetPage: number): Promise<void> {
  const MAX_HOPS = 50; // safety: timeline real tiene decenas de páginas como techo
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const current = readCurrentPageNumber();
    if (current === null) {
      throw new Error('No se pudo leer la página actual (falta "Mostrando del X al Y").');
    }
    if (current === targetPage) return;
    if (current > targetPage) {
      // El portal no soporta retroceso por postback — el SW debe hacer reset.
      throw new Error(
        `BACKWARD_NAVIGATION: estamos en página ${current} y piden página ${targetPage}.`,
      );
    }
    // Avanzar una página más.
    const next = findNextPageButton();
    if (!next) {
      throw new Error(`Botón "Siguiente" no encontrado (página ${current} → ${targetPage}).`);
    }
    next.scrollIntoView({ block: 'center' });
    next.click();
    // Esperar a que cambie el "Mostrando del X al Y" (postback GeneXus terminó).
    const fromBefore = parseTotalRecordsLine(document.body?.innerText ?? '')?.from ?? -1;
    await waitUntil(() => {
      const line = parseTotalRecordsLine(document.body?.innerText ?? '');
      return line !== null && line.from !== fromBefore;
    }, 10_000);
  }
  throw new Error(`goToPage no convergió tras ${MAX_HOPS} saltos.`);
}

/**
 * Busca el botón "Siguiente" primero por selectores CSS y, si ninguno matchea,
 * por contenido textual. El portal puede renderizarlo como <a>, <button> o
 * incluso como <img> dentro de un anchor.
 */
function findNextPageButton(): HTMLElement | null {
  const byCss = document.querySelector<HTMLElement>(SEL.nextPageButton);
  if (byCss) return byCss;
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('a, button, input[type="button"], input[type="submit"]'),
  );
  for (const el of candidates) {
    const text = (
      (el as HTMLInputElement).value ||
      el.textContent ||
      el.getAttribute('title') ||
      el.getAttribute('aria-label') ||
      ''
    )
      .trim()
      .toLowerCase();
    if (!text) continue;
    if (
      text === 'siguiente' ||
      text === 'siguiente »' ||
      text === 'siguiente →' ||
      text === '»' ||
      text === '→' ||
      text.startsWith('siguiente')
    ) {
      return el;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Esperas (spec §6.7)
// ---------------------------------------------------------------------------

async function waitForUrl(pattern: RegExp, timeoutMs: number): Promise<void> {
  await waitUntil(() => pattern.test(window.location.pathname + window.location.search), timeoutMs);
}

async function waitForSelector<T extends Element>(selector: string, timeoutMs: number): Promise<T> {
  let found = document.querySelector<T>(selector);
  if (found) return found;
  return new Promise<T>((resolve, reject) => {
    const to = setTimeout(() => {
      obs.disconnect();
      reject(new Error(`Timeout esperando selector ${selector}`));
    }, timeoutMs);
    const obs = new MutationObserver(() => {
      found = document.querySelector<T>(selector);
      if (found) {
        clearTimeout(to);
        obs.disconnect();
        resolve(found);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, intervalMs = 200): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (predicate()) return;
    } catch {
      // ignoramos errores transitorios durante la carga
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timeout (${timeoutMs}ms) esperando condición.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
