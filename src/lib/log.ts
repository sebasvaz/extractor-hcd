/**
 * Log circular en memoria.
 *
 * Spec v1.0 §5.3: durante una corrida se mantiene un log acotado en el
 * service worker. Al finalizar se serializa a `log.txt` dentro del ZIP
 * y también se expone al popup (botón "Ver log").
 *
 * Decisiones:
 *  - Buffer circular (FIFO) para no crecer sin límite en corridas largas.
 *    Tamaño por defecto 2000 entradas ≈ suficiente para algunos centenares
 *    de eventos con ~5-7 líneas cada uno.
 *  - No persiste a chrome.storage entre ejecuciones (por diseño: si el SW se
 *    hiberna, la corrida se considera terminada).
 *  - Nunca contiene el contenido clínico — solo trazas de operación.
 */

import type { LogEntry, LogLevel } from './messaging/types';

const DEFAULT_CAPACITY = 2000;

export class CircularLog {
  private readonly capacity: number;
  private buffer: LogEntry[] = [];

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  append(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context !== undefined ? { context } : {}),
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
    // Eco a consola del SW — visible en chrome://extensions "Ver vistas".
    const line = formatEntry(entry);
    switch (level) {
      case 'ERROR':
        console.error('[HCD]', line);
        break;
      case 'WARN':
        console.warn('[HCD]', line);
        break;
      case 'DEBUG':
        console.debug('[HCD]', line);
        break;
      default:
        console.info('[HCD]', line);
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.append('INFO', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.append('WARN', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.append('ERROR', message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.append('DEBUG', message, context);
  }

  snapshot(): LogEntry[] {
    return this.buffer.slice();
  }

  clear(): void {
    this.buffer = [];
  }

  /** Serializa el log a texto plano estilo syslog para incluir en el ZIP. */
  serialize(): string {
    return this.buffer.map(formatEntry).join('\n') + '\n';
  }
}

function formatEntry(entry: LogEntry): string {
  const ctx = entry.context ? ' ' + JSON.stringify(entry.context) : '';
  return `${entry.timestamp} ${entry.level.padEnd(5)} ${entry.message}${ctx}`;
}
