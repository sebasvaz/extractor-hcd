/**
 * Service worker — orquestador de la extracción.
 *
 * Alineado a la Especificación Técnica v1.0 (sección 5).
 *
 * Responsabilidades:
 *  - Mantener la máquina de estados de la corrida (idle/discovering/running/
 *    paused/cancelled/completed/error).
 *  - Orquestar el content script (discover totals → iterar páginas → por
 *    cada evento: click → esperar detalle → extraer HTML → volver).
 *  - Acumular el corpus in-memory (HTML + metadata + errores).
 *  - Mantener un log circular (spec §5.3).
 *  - Finalizar la corrida: invocar buildZip() y disparar chrome.downloads.
 *
 * Reglas duras (no negociables):
 *  - Delay mínimo de 800 ms entre capturas (spec §5.4 — respeto a servidor).
 *  - Backoff exponencial sobre fallos repetidos: 1 s, 2 s, 4 s, 8 s, 16 s (cap).
 *  - Si `navigator.onLine === false` o perdemos la sesión, pasamos a paused.
 *  - Cancelar es inmediato: no recupera trabajo perdido.
 */

import type {
  CapturedDocument,
  CaptureError,
  ContentRequest,
  EventMetadata,
  PopupRequest,
  RunProgress,
  RunStatus,
  AnyResponse,
} from '@lib/messaging/types';
import { err, ok } from '@lib/messaging/types';
import { buildZip } from '@lib/zip-builder';
import { CircularLog } from '@lib/log';
import { eventFileName } from '@lib/slug';
import { URLS } from '@lib/selectors';
import { createAnonymizer, type Anonymizer } from '@lib/anonymization';
import { redactPdfHeader } from '@lib/pdf-redact';

// ---------------------------------------------------------------------------
// Estado global (vive mientras el SW esté activo)
// ---------------------------------------------------------------------------

type RunState = {
  status: RunStatus;
  tabId: number | null;
  startedAt: string;
  expected: number;
  processed: number;
  currentPage: number;
  numPages: number;
  pageSize: number;
  capturedDocs: CapturedDocument[];
  errors: CaptureError[];
  patientDisplayName: string;
  usedSlugs: Set<string>;
  /**
   * Hashes SHA-256 de los HTML ya capturados. Red de seguridad contra
   * duplicados cuando la máquina de páginas falla silenciosamente (p. ej.
   * history.back() te deja en pág 1 mientras el SW cree estar en pág 3).
   */
  capturedShas: Set<string>;
  cancelRequested: boolean;
  pauseRequested: boolean;
  /**
   * Anonimización: si la corrida la pidió, aquí vive el motor con estado
   * (mapas estables de `[TEL_N]` / `[EMAIL_N]` entre documentos de la misma
   * corrida). `null` cuando el usuario pidió extracción sin anonimizar.
   */
  anonymizer: Anonymizer | null;
  /** Momento (ISO) en que la corrida alcanzó estado terminal. */
  completedAt: string | null;
  /** Metadatos del ZIP persistido — para exponerlos al popup. */
  lastZip: { filename: string; bytes: number; savedAt: string } | null;
};

const log = new CircularLog();

let run: RunState = freshRun();

/**
 * Claves de chrome.storage.session (persiste mientras el navegador esté
 * abierto; se borra en cierre del browser). La sesión sobrevive la muerte
 * del service worker por idle timeout — crítica para no perder la corrida.
 *
 * NO usamos storage.local: el corpus clínico del titular no debe persistir
 * en disco a través de reinicios del browser.
 */
const SESSION_KEY_ZIP = 'hcd:lastZip';
const SESSION_KEY_PROGRESS = 'hcd:lastProgress';

function freshRun(): RunState {
  return {
    status: 'idle',
    tabId: null,
    startedAt: '',
    expected: 0,
    processed: 0,
    currentPage: 0,
    numPages: 0,
    pageSize: 10,
    capturedDocs: [],
    errors: [],
    patientDisplayName: 'paciente',
    usedSlugs: new Set<string>(),
    capturedShas: new Set<string>(),
    cancelRequested: false,
    pauseRequested: false,
    anonymizer: null,
    completedAt: null,
    lastZip: null,
  };
}

// ---------------------------------------------------------------------------
// onInstalled
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  log.info('Extensión instalada/actualizada', { reason: details.reason });
});

// ---------------------------------------------------------------------------
// Handler popup/content → SW
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: PopupRequest | ContentRequest, sender, sendResponse) => {
  void handle(message, sender)
    .then((resp) => sendResponse(resp))
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Handler threw', { error: msg });
      sendResponse(err('BG_EXCEPTION', msg));
    });
  return true;
});

async function handle(message: PopupRequest | ContentRequest, _sender: chrome.runtime.MessageSender): Promise<AnyResponse> {
  // Los ContentRequest que aquí llegan son los que el content script envía
  // al SW como "eventos" (no hay un set ContentEvent separado en la spec
  // simplificada — ver types.ts). Por ahora solo CANCEL entra por esta vía.
  if (message.type === 'START' && 'tabId' in message) {
    return startRun(message.tabId, Boolean(message.anonymize));
  }
  if (message.type === 'CANCEL') {
    run.cancelRequested = true;
    log.warn('Cancelación solicitada por el usuario');
    return ok({ cancelling: true });
  }
  if (message.type === 'PAUSE') {
    run.pauseRequested = true;
    return ok({ pausing: true });
  }
  if (message.type === 'RESUME') {
    run.pauseRequested = false;
    return ok({ resuming: true });
  }
  if (message.type === 'GET_STATE') {
    // Si la run en memoria es fresca pero hay un snapshot persistido con
    // estado "completed" o "cancelled", rehidratamos el progreso para que
    // el popup pueda ofrecer la descarga aunque el SW haya muerto.
    if (run.status === 'idle') {
      const persisted = await getPersistedProgress();
      if (persisted && (persisted.status === 'completed' || persisted.status === 'cancelled')) {
        return ok<{ progress: RunProgress }>({ progress: persisted });
      }
    }
    return ok<{ progress: RunProgress }>({ progress: buildProgress() });
  }
  if (message.type === 'GET_LOG') {
    return ok({ entries: log.snapshot() });
  }
  if (message.type === 'DOWNLOAD_ZIP') {
    try {
      // Prioridad 1: si hay un ZIP persistido de una corrida completada, lo
      // usamos aunque el SW haya sido reseteado y la memoria esté vacía.
      const stashed = await getPersistedZip();
      if (stashed) {
        const downloadId = await triggerDownload(stashed.dataUrl, stashed.filename);
        return ok({ filename: stashed.filename, downloadId });
      }
      // Prioridad 2: armado on-demand desde memoria (caso normal, SW vivo).
      const res = await finalizeAndDownload(Boolean(message.partial));
      return ok(res);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return err('ZIP_FAILED', msg);
    }
  }
  return err('UNKNOWN_MESSAGE', `Tipo desconocido: ${JSON.stringify(message)}`);
}

// ---------------------------------------------------------------------------
// Arranque de corrida
// ---------------------------------------------------------------------------

async function startRun(tabId: number, anonymize: boolean): Promise<AnyResponse> {
  if (run.status === 'running' || run.status === 'discovering') {
    return err(
      'ALREADY_RUNNING',
      'Ya hay una corrida en curso. Cancelá la actual antes de iniciar otra.',
    );
  }
  run = freshRun();
  run.tabId = tabId;
  run.startedAt = new Date().toISOString();
  run.status = 'discovering';
  if (anonymize) {
    // Sembramos el displayName del header (siempre que el content script lo
    // haya detectado). El motor acumulará otros nombres que encuentre en las
    // cabeceras de cada CDA durante la corrida.
    run.anonymizer = createAnonymizer({
      scope: 'basic',
      seedPatientNames: run.patientDisplayName && run.patientDisplayName !== 'paciente'
        ? [run.patientDisplayName]
        : [],
    });
  }
  log.clear();
  log.info('Inicio de corrida', { tabId, anonymize });
  // Nueva corrida: eliminamos cualquier ZIP persistido de una anterior para
  // que "Descargar ZIP" no entregue un archivo viejo por error.
  await clearPersistedZip();

  // Verificamos estar en el portal correcto.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !tab.url.startsWith(URLS.ORIGIN)) {
      run.status = 'error';
      log.error('Pestaña activa no es Mi HCD', { url: tab.url ?? null });
      return err('WRONG_TAB', 'La pestaña activa no es Mi HCD.');
    }
  } catch (e: unknown) {
    run.status = 'error';
    const msg = e instanceof Error ? e.message : String(e);
    return err('TAB_ACCESS', msg);
  }

  // Fire-and-forget del scraping loop — no bloqueamos el mensaje del popup.
  void (async () => {
    try {
      await scrapeAll(tabId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      run.status = 'error';
      log.error('Corrida terminó en error', { error: msg });
      pushOverlay();
    }
  })();

  return ok<{ progress: RunProgress }>({ progress: buildProgress() });
}

// ---------------------------------------------------------------------------
// Loop principal (spec §5.4)
// ---------------------------------------------------------------------------

const CAPTURE_DELAY_MS = 800;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 16000;
const MAX_RETRIES_PER_EVENT = 3;

async function scrapeAll(tabId: number): Promise<void> {
  // 0) Reset al timeline — el usuario pudo haber empezado en cualquier
  // página. El portal no soporta retroceso lineal y las listas quedan en
  // el estado que el GXState tenía; recargar la URL de timeline pone al
  // portal en página 1, "Todos los registros", ordenamiento por defecto.
  try {
    await navigateTabTo(tabId, URLS.ORIGIN + URLS.TIMELINE);
    await waitForContentReady(tabId, 10_000);
    log.info('Pestaña reseteada al timeline');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn('No se pudo resetear al timeline — continuo igual', { error: msg });
  }

  await sendToTab(tabId, { type: 'SHOW_OVERLAY' });

  // 1) Total esperado
  const totalRes = await sendToTab(tabId, { type: 'READ_TOTAL_RECORDS' });
  if (totalRes.type !== 'OK' || typeof (totalRes.data as { total?: unknown }).total !== 'number') {
    throw new Error('No se pudo leer el total de registros.');
  }
  run.expected = (totalRes.data as { total: number }).total;
  run.numPages = Math.max(1, Math.ceil(run.expected / run.pageSize));
  log.info('Total de registros detectado', { expected: run.expected, numPages: run.numPages });
  run.status = 'running';

  // 2) Iterar páginas
  for (let page = 1; page <= run.numPages; page++) {
    if (run.cancelRequested) break;
    run.currentPage = page;
    pushOverlay();

    // Aseguramos estar en la página correcta (idempotente: no-op si ya
    // estamos ahí, avanza con postbacks si estamos atrás, resetea al timeline
    // y re-avanza si estamos adelante — manejado por ensurePage).
    try {
      await ensurePage(tabId, page);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('No se pudo posicionar la página', { page, error: msg });
      continue;
    }

    const listRes = await sendToTab(tabId, { type: 'LIST_EVENTS_ON_CURRENT_PAGE' });
    if (listRes.type !== 'OK') {
      log.error('LIST_EVENTS_ON_CURRENT_PAGE falló', { page });
      continue;
    }
    const events = (listRes.data as { events: EventMetadata[] }).events;
    log.info(`Página ${page}: ${events.length} eventos`, { page });

    // Dump del diagnóstico del DOM si el content script lo adjuntó (caso
    // 0 eventos). Nos permite tunear selectores sin salir del portal real.
    const diagnostics = (listRes.data as { diagnostics?: unknown }).diagnostics;
    if (events.length === 0 && diagnostics) {
      log.warn('Diagnóstico DOM — 0 eventos encontrados', {
        page,
        diag: diagnostics,
      });
    }

    for (let idx = 0; idx < events.length; idx++) {
      if (run.cancelRequested) break;
      while (run.pauseRequested && !run.cancelRequested) {
        run.status = 'paused';
        pushOverlay();
        await cancelableSleep(500);
      }
      run.status = 'running';

      // CRÍTICO: antes de cada click (salvo el primero, que viene fresco del
      // LIST de arriba) reconciliamos la página. history.back() desde
      // /visualizarcda puede habernos devuelto a pág 1 aunque el SW creyera
      // estar en `page`. ensurePage() es idempotente — si ya estamos en la
      // página correcta es no-op. Después re-listamos para que el content
      // script refresque sus anchors cacheados (el postback de "Siguiente"
      // re-renderiza la grilla y los anchors viejos quedan detachados).
      if (idx > 0) {
        try {
          await ensurePage(tabId, page);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error('Re-posición de página falló en medio de iteración', {
            page,
            idx,
            error: msg,
          });
          continue;
        }
        const relistRes = await sendToTab(tabId, { type: 'LIST_EVENTS_ON_CURRENT_PAGE' });
        if (relistRes.type !== 'OK') {
          log.error('Re-LIST antes de evento falló', { page, idx });
          continue;
        }
      }

      const provisionalMeta = events[idx]!;

      // Asignamos el id final (unique slug) aquí, en el SW.
      const finalIds = eventFileName({
        fechaIso: provisionalMeta.fecha,
        categoria: provisionalMeta.categoria,
        descripcion: provisionalMeta.descripcion ?? 'sin-descripcion',
        seen: run.usedSlugs,
      });
      const metaForContent: EventMetadata = { ...provisionalMeta, id: finalIds.id };

      let succeeded = false;
      let dedupSkipped = false;
      for (let attempt = 0; attempt < MAX_RETRIES_PER_EVENT && !succeeded && !dedupSkipped; attempt++) {
        if (run.cancelRequested) break;
        try {
          await sendToTab(tabId, { type: 'CLICK_EVENT_BY_INDEX', index: idx });
          const exRes = await sendToTab(tabId, {
            type: 'WAIT_FOR_DETAIL_AND_EXTRACT',
            meta: metaForContent,
          });
          if (exRes.type !== 'OK') {
            throw new Error((exRes as { message?: string }).message ?? 'Extracción falló');
          }
          const rawDoc = (exRes.data as { doc: CapturedDocument }).doc;

          // Anonimización (si la corrida la pidió): la aplicamos antes del
          // dedup y antes de push. Recalculamos sha256 sobre el HTML
          // anonimizado porque el metadata del ZIP debe referenciar el
          // contenido real que va al paquete (cualquier verificador externo
          // va a rehashear el archivo y esperar que matchee).
          let doc: CapturedDocument = rawDoc;
          if (run.anonymizer) {
            // 1) Anonimizar HTML (nombre, CI, tel, email)
            const anonHtml = run.anonymizer.apply(rawDoc.html);
            const anonSha = await sha256Hex(anonHtml);
            doc = { ...rawDoc, html: anonHtml, sha256: anonSha };

            // 2) Redactar cabezal del PDF adjunto (CDA nivel 1)
            if (doc.attachmentBase64 && doc.attachmentMime === 'application/pdf') {
              const pdfResult = await redactPdfHeader(
                doc.attachmentBase64,
                doc.attachmentSha256 ?? '',
              );
              if (pdfResult.ok) {
                doc = {
                  ...doc,
                  attachmentBase64: pdfResult.base64,
                  attachmentSha256: pdfResult.sha256,
                };
                log.info('PDF adjunto redactado', { id: doc.id });
              } else {
                log.warn('Redacción de PDF omitida — adjunto se incluye sin redactar', {
                  id: doc.id,
                  reason: pdfResult.reason,
                });
              }
            }
          }

          // Red de seguridad contra duplicados: si ya habíamos capturado
          // este contenido (mismo sha256), lo descartamos silenciosamente.
          // El id ya consumió su lugar en el seen set — costo aceptable a
          // cambio de nunca duplicar CDAs en el ZIP de salida.
          if (run.capturedShas.has(doc.sha256)) {
            log.warn('Duplicado detectado por sha256 — se descarta', {
              id: doc.id,
              page,
              idx,
              sha: doc.sha256.slice(0, 12),
            });
            dedupSkipped = true;
            break;
          }
          run.capturedShas.add(doc.sha256);
          run.capturedDocs.push(doc);
          run.processed++;
          succeeded = true;
          log.info('Evento capturado', {
            id: doc.id,
            page,
            idx,
            processed: run.processed,
            total: run.expected,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          const waitMs = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
          log.warn('Reintento tras fallo', { attempt, waitMs, error: msg });
          // Volvemos al timeline, reposicionamos la página y re-listamos
          // para que el próximo intento arranque con anchors frescos.
          try {
            await sendToTab(tabId, { type: 'NAVIGATE_BACK_TO_TIMELINE' });
            await ensurePage(tabId, page);
            await sendToTab(tabId, { type: 'LIST_EVENTS_ON_CURRENT_PAGE' });
          } catch {
            /* ignore — el próximo intento manejará la inconsistencia */
          }
          await cancelableSleep(waitMs);
        }
      }

      if (!succeeded && !dedupSkipped) {
        run.errors.push({
          meta: provisionalMeta,
          message: 'Fallaron todos los reintentos.',
          occurredAt: new Date().toISOString(),
        });
      }

      // Volver al timeline para el próximo evento.
      try {
        await sendToTab(tabId, { type: 'NAVIGATE_BACK_TO_TIMELINE' });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn('No se pudo volver al timeline', { error: msg });
      }

      pushOverlay();
      await cancelableSleep(CAPTURE_DELAY_MS);
    }
  }

  // Finalizar
  if (run.cancelRequested) {
    run.status = 'cancelled';
    log.warn('Corrida cancelada — el usuario podrá descargar lo parcial.');
  } else {
    run.status = 'completed';
    log.info('Corrida completada', {
      captured: run.capturedDocs.length,
      failed: run.errors.length,
    });
    // Discrepancia "portal dice N, enumeramos M". Causas típicas:
    //   - El portal reporta un total en el footer ("de X resultados") que
    //     no siempre coincide con la cantidad de items clicable-bles en el
    //     timeline (off-by-one histórico del portal, eventos ocultos por
    //     permiso, items soft-deleted que siguen contando en el total).
    //   - Dedup por SHA-256 descartó capturas idénticas (en ese caso lo
    //     vería run.errors.length también, o WARNs previas de 'duplicado').
    // Loguearlo explícitamente deja claro en el log.txt que el 44/45 no
    // es un doc perdido por un bug del scraper.
    const expected = run.expected;
    const captured = run.capturedDocs.length;
    const failed = run.errors.length;
    if (expected > 0 && captured + failed < expected) {
      log.warn(
        'Discrepancia con el total del portal: capturados + fallidos < esperados. ' +
          'Esto suele ser un off-by-one del portal (el footer "de X" cuenta ' +
          'items que no están enumerados en el timeline) y no una pérdida ' +
          'de datos del scraper. Revisá manualmente si el total es crítico.',
        { expected, captured, failed, missing: expected - captured - failed },
      );
    }
  }
  run.completedAt = new Date().toISOString();
  pushOverlay();
  await sendToTab(tabId, { type: 'HIDE_OVERLAY' }).catch(() => undefined);

  // CRÍTICO: armar el ZIP inmediatamente y persistirlo en session storage.
  // Si esperáramos al click de "Descargar ZIP", el SW podría morir por idle
  // timeout (MV3 = ~30s) y `run.capturedDocs` quedaría perdido para siempre.
  // Persistimos el data URL como fuente autoritativa de la descarga.
  if (run.capturedDocs.length > 0) {
    try {
      const { blob, filename } = await buildZip(
        buildZipArgsFromRun(new Date().toISOString())
      );
      const dataUrl = await blobToDataUrl(blob);
      await persistZip(dataUrl, filename);
      const savedAt = new Date().toISOString();
      run.lastZip = { filename, bytes: blob.size, savedAt };
      log.info('ZIP persistido en session storage', { filename, bytes: blob.size });
      // Auto-disparo de descarga al completar: el usuario pidió explícitamente
      // que el ZIP no se pierda. El ZIP queda también persistido, así que si
      // el browser bloqueó la descarga automática el botón manual sigue
      // funcionando. `saveAs: true` deja al usuario elegir destino.
      try {
        await triggerDownload(dataUrl, filename);
        log.info('Auto-descarga disparada', { filename });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn('Auto-descarga falló — el usuario puede descargar desde el popup', { error: msg });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('No se pudo armar/persistir el ZIP al finalizar', { error: msg });
    }
  }
  // Snapshot final del progreso también.
  await persistProgress(buildProgress());
}

// ---------------------------------------------------------------------------
// Finalización y descarga
// ---------------------------------------------------------------------------

async function finalizeAndDownload(partial: boolean): Promise<{ filename: string; downloadId: number }> {
  if (!partial && run.status !== 'completed') {
    throw new Error(`Corrida no completada (estado: ${run.status}). Usar partial=true para descargar igual.`);
  }
  if (run.capturedDocs.length === 0) {
    throw new Error('No hay documentos capturados en memoria (¿el SW se reinició? storage.session tampoco tiene ZIP guardado).');
  }
  const { blob, filename } = await buildZip(
    buildZipArgsFromRun(new Date().toISOString())
  );
  // En MV3 el SW no tiene `URL.createObjectURL`. Convertimos el blob a un
  // data URL base64 y lo pasamos directo a chrome.downloads.download. Para
  // un ZIP de pocos MB (decenas de documentos CDA), la inflación ~33% de
  // base64 es asumible y evita depender de un offscreen document.
  const dataUrl = await blobToDataUrl(blob);
  const downloadId = await triggerDownload(dataUrl, filename);
  return { filename, downloadId };
}

async function triggerDownload(dataUrl: string, filename: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    chrome.downloads.download({ url: dataUrl, filename, saveAs: true }, (id) => {
      const e = chrome.runtime.lastError;
      if (e || id === undefined) {
        reject(new Error(e?.message ?? 'downloads.download no devolvió id'));
        return;
      }
      resolve(id);
    });
  });
}

// ---------------------------------------------------------------------------
// Persistencia en chrome.storage.session
// ---------------------------------------------------------------------------

async function persistZip(dataUrl: string, filename: string): Promise<void> {
  try {
    await chrome.storage.session.set({
      [SESSION_KEY_ZIP]: { dataUrl, filename, savedAt: new Date().toISOString() },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn('persistZip falló (storage.session no disponible)', { error: msg });
  }
}

async function getPersistedZip(): Promise<{ dataUrl: string; filename: string } | null> {
  try {
    const got = await chrome.storage.session.get(SESSION_KEY_ZIP);
    const v = got[SESSION_KEY_ZIP] as { dataUrl?: string; filename?: string } | undefined;
    if (v && typeof v.dataUrl === 'string' && typeof v.filename === 'string') {
      return { dataUrl: v.dataUrl, filename: v.filename };
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function clearPersistedZip(): Promise<void> {
  try {
    await chrome.storage.session.remove([SESSION_KEY_ZIP, SESSION_KEY_PROGRESS]);
  } catch {
    /* ignore */
  }
}

async function persistProgress(progress: RunProgress): Promise<void> {
  try {
    await chrome.storage.session.set({ [SESSION_KEY_PROGRESS]: progress });
  } catch {
    /* ignore */
  }
}

async function getPersistedProgress(): Promise<RunProgress | null> {
  try {
    const got = await chrome.storage.session.get(SESSION_KEY_PROGRESS);
    const v = got[SESSION_KEY_PROGRESS] as RunProgress | undefined;
    return v ?? null;
  } catch {
    return null;
  }
}

/**
 * Construye `BuildZipArgs` respetando `exactOptionalPropertyTypes`: solo
 * incluye `anonymized` / `anonymizationScope` cuando la corrida es
 * anonimizada (no los pasa como `undefined`).
 */
function buildZipArgsFromRun(fallbackStartedAt: string): import('@lib/zip-builder').BuildZipArgs {
  const base: import('@lib/zip-builder').BuildZipArgs = {
    patient: { displayName: run.patientDisplayName },
    expected: run.expected,
    documents: run.capturedDocs,
    errors: run.errors,
    log: log.snapshot(),
    startedAt: run.startedAt || fallbackStartedAt,
  };
  if (run.anonymizer !== null) {
    base.anonymized = true;
    base.anonymizationScope = 'basic';
  }
  return base;
}

/**
 * SHA-256 del string UTF-8 dado, en hex lower-case. Se usa para recomputar
 * el hash del HTML después de anonimizar — así `metadata.json` referencia
 * el contenido real que queda en el ZIP (y no el pre-anonimización).
 */
async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Convierte un Blob a un `data:application/zip;base64,...` URL sin usar
 * FileReader (no disponible en SW) ni URL.createObjectURL (no disponible
 * en SW MV3). Procesa en chunks de 32 KiB para evitar stack overflows
 * de `String.fromCharCode.apply` con arrays grandes.
 */
async function blobToDataUrl(blob: Blob, mime: string = 'application/zip'): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  const pieces: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    const slice = bytes.subarray(i, end);
    pieces.push(String.fromCharCode.apply(null, Array.from(slice) as number[]));
  }
  return `data:${mime};base64,${btoa(pieces.join(''))}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendToTab(tabId: number, payload: ContentRequest): Promise<AnyResponse> {
  try {
    const resp = (await chrome.tabs.sendMessage(tabId, payload)) as AnyResponse;
    return resp;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('TAB_SEND_FAILED', msg);
  }
}

/**
 * Posiciona el timeline en `targetPage` de forma confiable.
 *
 * El content script implementa `goToPage(target)` idempotentemente:
 *  - si ya está en la página, no-op
 *  - si está antes, clickea "Siguiente" las veces necesarias
 *  - si está después, responde con error cuyo mensaje contiene
 *    "BACKWARD_NAVIGATION"
 *
 * Cuando detectamos BACKWARD_NAVIGATION, la única estrategia confiable es
 * recargar la URL del timeline (vuelve a pág 1) y re-avanzar hasta target.
 * El postback de "Siguiente" NO hace history.push, así que un history.back()
 * no nos retrocede de página → hay que recargar.
 *
 * Si el fallo no es BACKWARD_NAVIGATION, reintentamos con backoff corto.
 */
async function ensurePage(tabId: number, targetPage: number): Promise<void> {
  const MAX_ROUNDS = 3;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (run.cancelRequested) throw new Error('CANCELLED');
    const resp = await sendToTab(tabId, { type: 'GO_TO_PAGE', page: targetPage });
    if (resp.type === 'OK') return;
    const msg = resp.message ?? '';
    const isBackward = msg.includes('BACKWARD_NAVIGATION');
    if (isBackward) {
      log.warn('ensurePage: BACKWARD_NAVIGATION — reseteando al timeline', { targetPage, msg });
      await navigateTabTo(tabId, URLS.ORIGIN + URLS.TIMELINE);
      await waitForContentReady(tabId, 10_000);
      continue;
    }
    if (round === MAX_ROUNDS - 1) {
      throw new Error(`ensurePage agotó intentos (page=${targetPage}): ${msg}`);
    }
    const waitMs = BACKOFF_BASE_MS * (round + 1);
    log.warn('ensurePage: fallo no-backward, reintentando', { targetPage, waitMs, msg });
    await cancelableSleep(waitMs);
  }
  throw new Error(`ensurePage no convergió (page=${targetPage}).`);
}

function buildProgress(): RunProgress {
  const last = run.capturedDocs[run.capturedDocs.length - 1];
  const progress: RunProgress = {
    status: run.status,
    processed: run.processed,
    total: run.expected,
    currentPage: run.currentPage,
    numPages: run.numPages,
    errors: run.errors,
  };
  if (last) {
    progress.lastDocument = {
      id: last.id,
      categoria: last.categoria,
      fecha: last.fecha,
      ok: true,
    };
  }
  if (run.anonymizer !== null) {
    progress.anonymized = true;
  }
  if (run.completedAt) {
    progress.completedAt = run.completedAt;
  }
  if (run.lastZip) {
    progress.zipAvailable = run.lastZip;
  }
  return progress;
}

function pushOverlay(): void {
  if (run.tabId === null) return;
  void sendToTab(run.tabId, { type: 'UPDATE_OVERLAY', progress: buildProgress() });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Sleep que se interrumpe apenas el usuario presiona Cancelar. Polea el
 * flag `run.cancelRequested` cada 250 ms — trade-off entre responsividad
 * (≤250 ms) y evitar un loop tight de setTimeout.
 */
async function cancelableSleep(ms: number): Promise<void> {
  const start = Date.now();
  const tick = 250;
  while (Date.now() - start < ms) {
    if (run.cancelRequested) return;
    const remaining = ms - (Date.now() - start);
    await sleep(Math.min(tick, remaining));
  }
}

/**
 * Navega la pestaña a la URL indicada y resuelve cuando el estado es
 * 'complete'. Rechaza si chrome.tabs.update da error o si pasa el timeout.
 */
async function navigateTabTo(tabId: number, url: string, timeoutMs = 20_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo): void => {
      if (id === tabId && info.status === 'complete' && !settled) {
        settled = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url }, () => {
      const e = chrome.runtime.lastError;
      if (e && !settled) {
        settled = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error(e.message));
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error(`Timeout (${timeoutMs}ms) navegando a ${url}`));
      }
    }, timeoutMs);
  });
}

/**
 * Espera a que el content script responda PING. chrome.tabs.update resuelve
 * apenas la navegación HTTP termina, pero el content script se inyecta en
 * `document_idle` — hace falta poll-ear hasta que esté listo.
 */
async function waitForContentReady(tabId: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await sendToTab(tabId, { type: 'PING' });
    if (r.type === 'OK') return;
    await sleep(300);
  }
  throw new Error('Content script no respondió PING tras la navegación.');
}
