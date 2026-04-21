/**
 * Contratos tipados de mensajería entre popup, service worker y content script.
 *
 * Alineado a la Especificación Técnica v1.0 (sección 5.2).
 *
 * Buses:
 *  - popup ↔ service worker  (runtime.sendMessage / port)
 *  - service worker ↔ content (tabs.sendMessage)
 *
 * Mantener este archivo como única fuente de verdad. Cualquier cambio fuerza
 * a los consumidores por el type checker.
 */

// ---------------------------------------------------------------------------
// Tipos de dominio compartidos
// ---------------------------------------------------------------------------

export type RunStatus =
  | 'idle'
  | 'discovering'
  | 'running'
  | 'paused'
  | 'cancelled'
  | 'completed'
  | 'error';

export type EventMetadata = {
  /** ID estable del evento en la corrida (slug). */
  id: string;
  categoria: string; // e.g. "Vacunas", "Policlínica"…
  fecha: string; // ISO yyyy-mm-dd
  prestador?: string;
  profesional?: string;
  descripcion?: string;
};

export type CapturedDocument = EventMetadata & {
  visualizarUrl: string; // URL contenedora al capturar (cambia por sesión)
  captureUrl: string; // src del iframe CONTENIDOHTML al capturar
  capturedAt: string; // ISO-8601
  html: string; // HTML completo, self-contained
  sha256: string; // hash del HTML
  /**
   * CDA nivel 1 — los estudios de laboratorio y algunos otros documentos se
   * entregan como un PDF embebido en el HTML vía `<pre id="b64">...base64...</pre>`
   * + VisorPDF.js. Cuando detectamos ese patrón extraemos los bytes del PDF
   * y los adjuntamos aparte. El HTML se deja con un link al PDF para que el
   * corpus sea legible standalone sin el visor JavaScript del portal.
   *
   * `attachmentBase64` es base64 standard (sin data-url prefix). Indefinido
   * si el documento no es CDA nivel 1.
   */
  attachmentBase64?: string;
  attachmentMime?: string; // por ahora siempre 'application/pdf' cuando presente
  attachmentSha256?: string; // hash de los bytes del adjunto (no del base64)
};

export type CaptureError = {
  meta: Partial<EventMetadata>;
  url?: string;
  message: string;
  occurredAt: string;
};

export type RunProgress = {
  status: RunStatus;
  processed: number;
  total: number;
  currentPage: number;
  numPages: number;
  lastDocument?: {
    id: string;
    categoria: string;
    fecha: string;
    ok: boolean;
  };
  errors: CaptureError[];
  /** true si la corrida está aplicando anonimización. Alimenta el badge del popup. */
  anonymized?: boolean;
  /** ISO-8601 del momento en que la corrida alcanzó un estado terminal. */
  completedAt?: string;
  /** Nombre y tamaño del ZIP disponible para descargar (si persistió en session storage). */
  zipAvailable?: {
    filename: string;
    bytes: number;
    savedAt: string;
  };
};

// ---------------------------------------------------------------------------
// popup → background
// ---------------------------------------------------------------------------

export type PopupRequest =
  | {
      type: 'START';
      tabId: number;
      /**
       * Cuando es `true`, el service worker aplica el motor de anonimización
       * (ver `lib/anonymization`) sobre el HTML de cada documento antes de
       * sumarlo al corpus. El ZIP resultante queda marcado como anonimizado
       * en `metadata.json` (`anonymized: true`, `anonymizationScope: 'basic'`).
       * Ver alcance y limitaciones en README §Anonimización.
       */
      anonymize?: boolean;
    }
  | { type: 'CANCEL' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'GET_STATE' }
  | { type: 'DOWNLOAD_ZIP'; partial?: boolean }
  | { type: 'GET_LOG' };

// ---------------------------------------------------------------------------
// background → content (tabs.sendMessage)
// ---------------------------------------------------------------------------

export type ContentRequest =
  | { type: 'PING' }
  | { type: 'READ_TOTAL_RECORDS' }
  | { type: 'LIST_EVENTS_ON_CURRENT_PAGE' }
  | { type: 'GO_TO_PAGE'; page: number }
  | { type: 'CLICK_EVENT_BY_INDEX'; index: number }
  | { type: 'WAIT_FOR_DETAIL_AND_EXTRACT'; meta: EventMetadata }
  | { type: 'NAVIGATE_BACK_TO_TIMELINE' }
  | { type: 'SHOW_OVERLAY' }
  | { type: 'HIDE_OVERLAY' }
  | { type: 'UPDATE_OVERLAY'; progress: RunProgress };

// ---------------------------------------------------------------------------
// content → background (runtime.sendMessage)
// ---------------------------------------------------------------------------

export type ContentEvent =
  | { type: 'DOC_READY'; doc: CapturedDocument }
  | { type: 'DOC_FAILED'; error: CaptureError }
  | { type: 'SESSION_LOST'; atUrl: string };

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export type OkResponse<T = Record<string, unknown>> = {
  type: 'OK';
  data: T;
};
export type ErrResponse = {
  type: 'ERROR';
  code: string;
  message: string;
};

export type AnyResponse<T = Record<string, unknown>> =
  | OkResponse<T>
  | ErrResponse;

// Helpers de construcción (útiles en handlers).
export const ok = <T extends Record<string, unknown>>(data: T): OkResponse<T> => ({
  type: 'OK',
  data,
});
export const err = (code: string, message: string): ErrResponse => ({
  type: 'ERROR',
  code,
  message,
});

// ---------------------------------------------------------------------------
// Log de operación (spec §5.3)
// ---------------------------------------------------------------------------

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export type LogEntry = {
  timestamp: string; // ISO-8601
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
};
