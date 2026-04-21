/**
 * UI del popup — orquesta el estado visible de la corrida.
 *
 * Alineado a la Especificación Técnica v1.0 (sección 5.2).
 *
 * Flujo:
 *  1. Al abrir, validamos que la pestaña activa sea Mi HCD.
 *  2. Pedimos GET_STATE al SW y pintamos progreso.
 *  3. Botones:
 *      - Iniciar → START (incluye tabId)
 *      - Cancelar → CANCEL
 *      - Descargar ZIP → DOWNLOAD_ZIP (con partial=true si corrida no completada)
 *      - Ver log → GET_LOG → renderiza panel
 *  4. Un poll cada 1 s mientras la corrida está activa refresca progreso.
 */

import type {
  AnyResponse,
  LogEntry,
  RunProgress,
} from '@lib/messaging/types';

const MIHCD_HOST = 'historiaclinicadigital.gub.uy';
const POLL_MS = 1000;
/**
 * Preferencia local del toggle de anonimización. Usamos storage.local (no
 * session) porque es una preferencia de UX, no un dato clínico — queremos
 * que sobreviva al reinicio del browser.
 */
const PREF_KEY_ANON = 'hcd:pref:anonymize';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} no encontrado en popup.html`);
  return el as T;
};

let pollHandle: number | null = null;
let currentTabId: number | null = null;

document.addEventListener('DOMContentLoaded', () => {
  void init();
});

async function init() {
  $('ext-version').textContent = chrome.runtime.getManifest().version;

  const tab = await getActiveTab();
  if (!tab?.url || new URL(tab.url).host !== MIHCD_HOST) {
    show('not-on-mihcd');
    return;
  }
  currentTabId = tab.id ?? null;
  show('main-section');
  wireButtons();

  // Restaurar preferencia del toggle.
  try {
    const got = await chrome.storage.local.get(PREF_KEY_ANON);
    const pref = got[PREF_KEY_ANON];
    if (typeof pref === 'boolean') {
      $<HTMLInputElement>('anon-toggle').checked = pref;
    }
  } catch {
    /* sin preferencia guardada — defecto del HTML */
  }

  // Ping al content script para verificar sesión / script cargado.
  await refreshSessionDot();
  await refreshProgress();
  startPolling();
}

function wireButtons() {
  $<HTMLButtonElement>('start-button').addEventListener('click', () => {
    void onStart();
  });
  $<HTMLButtonElement>('cancel-button').addEventListener('click', () => {
    void onCancel();
  });
  $<HTMLButtonElement>('download-button').addEventListener('click', () => {
    void onDownload();
  });
  $<HTMLButtonElement>('log-button').addEventListener('click', () => {
    void onShowLog();
  });
  $<HTMLButtonElement>('log-close').addEventListener('click', () => {
    hide('log-section');
    show('main-section');
  });
  $<HTMLInputElement>('anon-toggle').addEventListener('change', (e) => {
    const val = (e.target as HTMLInputElement).checked;
    void chrome.storage.local.set({ [PREF_KEY_ANON]: val }).catch(() => undefined);
  });
}

async function onStart() {
  if (currentTabId === null) {
    alert('No hay pestaña activa.');
    return;
  }
  // Al iniciar una nueva corrida, ocultamos el panel persistente de la
  // corrida anterior — el usuario lo pidió explícitamente: "reiniciar la
  // búsqueda" limpia el estado visible.
  hide('done-panel');
  const anonymize = $<HTMLInputElement>('anon-toggle').checked;
  const res = await send({ type: 'START', tabId: currentTabId, anonymize });
  if (res.type === 'ERROR') {
    alert(`No se pudo iniciar: ${res.message}`);
    return;
  }
  startPolling();
}

async function onCancel() {
  await send({ type: 'CANCEL' });
  await refreshProgress();
}

async function onDownload() {
  const stateRes = await send({ type: 'GET_STATE' });
  const partial =
    stateRes.type === 'OK' &&
    (stateRes.data as { progress: RunProgress }).progress.status !== 'completed';
  const res = await send({ type: 'DOWNLOAD_ZIP', partial });
  if (res.type === 'ERROR') {
    alert(`No se pudo generar el ZIP: ${res.message}`);
    return;
  }
  const data = res.data as { filename: string };
  // Chrome mostró el diálogo de Guardar; le avisamos al usuario.
  alert(`Descargando: ${data.filename}`);
}

async function onShowLog() {
  const res = await send({ type: 'GET_LOG' });
  if (res.type === 'ERROR') {
    alert(`No se pudo leer el log: ${res.message}`);
    return;
  }
  const entries = (res.data as { entries: LogEntry[] }).entries;
  const pre = $<HTMLPreElement>('log-pre');
  pre.textContent = entries
    .map((e) => {
      const ctx = e.context ? ' ' + JSON.stringify(e.context) : '';
      return `${e.timestamp} ${e.level.padEnd(5)} ${e.message}${ctx}`;
    })
    .join('\n') || '(log vacío)';
  hide('main-section');
  show('log-section');
}

// ---------------------------------------------------------------------------
// Polling de progreso
// ---------------------------------------------------------------------------

function startPolling() {
  if (pollHandle !== null) return;
  pollHandle = window.setInterval(() => {
    void refreshProgress();
  }, POLL_MS);
}

function stopPolling() {
  if (pollHandle !== null) {
    window.clearInterval(pollHandle);
    pollHandle = null;
  }
}

async function refreshProgress() {
  const res = await send({ type: 'GET_STATE' });
  if (res.type !== 'OK') return;
  const progress = (res.data as { progress: RunProgress }).progress;
  paintProgress(progress);

  // Parar polling si la corrida terminó (estados terminales).
  if (
    progress.status === 'completed' ||
    progress.status === 'cancelled' ||
    progress.status === 'error' ||
    progress.status === 'idle'
  ) {
    // dejamos un último refresh para dar tiempo a la última escritura
    window.setTimeout(() => stopPolling(), POLL_MS * 2);
  }
}

function paintProgress(p: RunProgress) {
  $('run-status').textContent = humanStatus(p.status);
  $('run-counts').textContent = `${p.processed} / ${p.total}`;
  $('run-page').textContent = `${p.currentPage} / ${p.numPages}`;

  const bar = $<HTMLDivElement>('bar-fill');
  if (p.total > 0) {
    const pct = Math.min(100, Math.round((p.processed / p.total) * 100));
    bar.style.width = `${pct}%`;
  } else {
    bar.style.width = '0%';
  }

  // Botones
  const running = p.status === 'running' || p.status === 'discovering' || p.status === 'paused';
  $<HTMLButtonElement>('start-button').disabled = running;
  $<HTMLButtonElement>('cancel-button').disabled = !running;
  const canDownload = p.processed > 0 || p.status === 'completed';
  $<HTMLButtonElement>('download-button').disabled = !canDownload;
  // Toggle de anonimización: bloqueado durante una corrida activa — cambiar
  // a la mitad de la extracción dejaría mitad del ZIP anonimizado y mitad no.
  $<HTMLInputElement>('anon-toggle').disabled = running;

  // Panel persistente de "Corrida completada" — visible en estados
  // terminales y solo si hay un ZIP disponible. Se limpia al apretar
  // "Iniciar extracción" (ver onStart()).
  const terminal = p.status === 'completed' || p.status === 'cancelled';
  if (terminal && p.zipAvailable) {
    paintDonePanel(p);
    show('done-panel');
  } else if (!terminal) {
    hide('done-panel');
  }

  // Errores
  if (p.errors && p.errors.length > 0) {
    show('errors-container');
    const ul = $('errors-list');
    ul.innerHTML = '';
    for (const e of p.errors.slice(-5)) {
      const li = document.createElement('li');
      li.textContent = `[${e.meta.categoria ?? '?'}] ${e.meta.fecha ?? ''} — ${e.message}`;
      ul.appendChild(li);
    }
  }

  // Último documento → prepend a la lista
  if (p.lastDocument) {
    prependEvent(p.lastDocument);
  }
}

function paintDonePanel(p: RunProgress): void {
  const title = p.status === 'completed' ? 'Corrida completada' : 'Corrida cancelada';
  $('done-title').textContent = title;
  const zip = p.zipAvailable;
  if (zip) {
    $('done-filename').textContent = zip.filename;
    $('done-filename').title = zip.filename;
    $('done-size').textContent = formatBytes(zip.bytes);
  }
  if (p.completedAt) {
    const d = new Date(p.completedAt);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    $('done-when').textContent = `${d.toLocaleDateString()} ${hh}:${mm}`;
  }
  const anonRow = $('done-anon-row');
  if (p.anonymized) {
    anonRow.hidden = false;
  } else {
    anonRow.hidden = true;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

const seenEvents = new Set<string>();
function prependEvent(last: NonNullable<RunProgress['lastDocument']>) {
  if (seenEvents.has(last.id)) return;
  seenEvents.add(last.id);
  const ul = $('events-list');
  // borrar placeholder si existe
  const empty = ul.querySelector('.empty');
  empty?.remove();

  const li = document.createElement('li');
  const mark = document.createElement('span');
  mark.className = last.ok ? 'ev-ok' : 'ev-fail';
  mark.textContent = last.ok ? '✔' : '✖';
  const tag = document.createElement('span');
  tag.className = 'cat-tag';
  tag.textContent = last.categoria;
  const text = document.createElement('span');
  text.textContent = `${last.fecha} · ${last.id}`;
  li.appendChild(mark);
  li.appendChild(tag);
  li.appendChild(text);
  ul.insertBefore(li, ul.firstChild);

  // Tope 20 elementos (spec §5.2)
  while (ul.children.length > 20) ul.removeChild(ul.lastChild!);
}

async function refreshSessionDot() {
  const dot = $('session-dot');
  const status = $('session-status');
  if (currentTabId === null) {
    dot.className = 'dot dot-bad';
    status.textContent = 'Sin pestaña activa';
    return;
  }
  try {
    const resp = (await chrome.tabs.sendMessage(currentTabId, { type: 'PING' })) as AnyResponse;
    if (resp.type === 'OK') {
      dot.className = 'dot dot-ok';
      status.textContent = `Conectado a ${MIHCD_HOST}`;
    } else {
      dot.className = 'dot dot-bad';
      status.textContent = 'Content script no respondió';
    }
  } catch {
    dot.className = 'dot dot-bad';
    status.textContent = 'Recargue Mi HCD para inyectar el extractor';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanStatus(s: RunProgress['status']): string {
  switch (s) {
    case 'idle':
      return 'En espera';
    case 'discovering':
      return 'Descubriendo…';
    case 'running':
      return 'Extrayendo';
    case 'paused':
      return 'Pausado';
    case 'cancelled':
      return 'Cancelado';
    case 'completed':
      return 'Completado';
    case 'error':
      return 'Error';
  }
}

function show(id: string) {
  $(id).hidden = false;
}

function hide(id: string) {
  $(id).hidden = true;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(msg: unknown): Promise<AnyResponse> {
  return chrome.runtime.sendMessage(msg) as Promise<AnyResponse>;
}
