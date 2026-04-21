/**
 * Overlay flotante en el content script.
 *
 * Spec v1.0 §5.5: durante la corrida, el usuario ve un indicador no modal
 * en la esquina inferior derecha con el estado (procesados / total,
 * página actual, botón Cancelar).
 *
 * Principios:
 *  - DOM aislado: inyectamos un Shadow DOM para no colisionar con estilos
 *    del portal.
 *  - Sin dependencias externas. Todo CSS inline.
 *  - `pointer-events: auto` solo en los elementos interactivos.
 */

import type { RunProgress } from '@lib/messaging/types';

const HOST_ID = '__hcd_ips_overlay_host__';

export function showOverlay(): void {
  ensureHost();
}

export function hideOverlay(): void {
  const host = document.getElementById(HOST_ID);
  host?.remove();
}

export function updateOverlay(progress: RunProgress): void {
  const root = ensureHost();
  const title = root.getElementById('title');
  const status = root.getElementById('status');
  const counts = root.getElementById('counts');
  const page = root.getElementById('page');
  const bar = root.getElementById('bar-fill') as HTMLDivElement | null;
  const last = root.getElementById('last');

  if (title) title.textContent = 'Extractor de HCD';
  if (status) status.textContent = humanStatus(progress.status);
  if (counts) counts.textContent = `${progress.processed} / ${progress.total}`;
  if (page) page.textContent = `Página ${progress.currentPage} de ${progress.numPages}`;
  if (bar && progress.total > 0) {
    const pct = Math.min(100, Math.round((progress.processed / progress.total) * 100));
    bar.style.width = `${pct}%`;
  }
  if (last) {
    if (progress.lastDocument) {
      const mark = progress.lastDocument.ok ? '✔' : '✖';
      last.textContent = `${mark} ${progress.lastDocument.fecha} · ${progress.lastDocument.categoria}`;
    } else {
      last.textContent = '';
    }
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function ensureHost(): ShadowRoot {
  let host = document.getElementById(HOST_ID) as HTMLDivElement | null;
  if (host && host.shadowRoot) return host.shadowRoot;

  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = [
    'position: fixed',
    'right: 16px',
    'bottom: 16px',
    'z-index: 2147483647',
    'all: initial',
    'pointer-events: none',
  ].join('; ');
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = TEMPLATE_HTML;

  const cancelBtn = shadow.getElementById('cancel-btn');
  cancelBtn?.addEventListener('click', () => {
    // El content script no conoce el estado global — le avisa al background.
    void chrome.runtime.sendMessage({ type: 'CANCEL' }).catch(() => {
      /* service worker puede estar dormido; lo reintentamos vía popup */
    });
  });

  return shadow;
}

function humanStatus(s: RunProgress['status']): string {
  switch (s) {
    case 'idle':
      return 'En espera';
    case 'discovering':
      return 'Descubriendo eventos…';
    case 'running':
      return 'Extrayendo…';
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

const TEMPLATE_HTML = `
<style>
  :host, * { box-sizing: border-box; }
  .card {
    pointer-events: auto;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 12px;
    color: #1f2937;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    width: 280px;
    padding: 12px 14px;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .title {
    font-weight: 600;
    font-size: 13px;
    color: #111827;
  }
  .status {
    font-size: 11px;
    color: #6b7280;
  }
  .counts {
    font-variant-numeric: tabular-nums;
    font-size: 16px;
    font-weight: 600;
    color: #111827;
  }
  .page {
    color: #6b7280;
    font-size: 11px;
    margin-top: 2px;
  }
  .bar {
    height: 6px;
    background: #f3f4f6;
    border-radius: 4px;
    overflow: hidden;
    margin: 8px 0;
  }
  .bar-fill {
    height: 100%;
    width: 0%;
    background: #1A73E8;
    transition: width 200ms ease-out;
  }
  .last {
    font-size: 11px;
    color: #374151;
    min-height: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .actions {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
  }
  .btn {
    pointer-events: auto;
    background: #f3f4f6;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 11px;
    color: #111827;
    cursor: pointer;
  }
  .btn:hover { background: #e5e7eb; }
</style>
<div class="card">
  <div class="header">
    <span class="title" id="title">Extractor de HCD</span>
    <span class="status" id="status">En espera</span>
  </div>
  <div class="counts" id="counts">0 / 0</div>
  <div class="page" id="page">Página 0 de 0</div>
  <div class="bar"><div class="bar-fill" id="bar-fill"></div></div>
  <div class="last" id="last"></div>
  <div class="actions">
    <button class="btn" id="cancel-btn" type="button">Cancelar</button>
  </div>
</div>
`;
