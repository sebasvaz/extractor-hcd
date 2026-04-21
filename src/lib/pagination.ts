/**
 * Parseo de texto de paginación del portal Mi HCD.
 *
 * Spec v1.0 §6.3.1: la línea "Mostrando del X al Y de T resultados" (con
 * tolerancia a espacios duros y variaciones menores) es la fuente canónica
 * del total. Fallback en el menú lateral "Todos los registros (N)".
 *
 * Se factoriza en su propio módulo (sin dependencias DOM) para poder
 * testearlo en Node/Vitest.
 */

import { RE_SIDEBAR_COUNT, RE_TOTAL_RECORDS } from './selectors';

export type PaginationLine = {
  from: number;
  to: number;
  total: number;
};

/** Parsea el pie "Mostrando del X al Y de T resultados". */
export function parseTotalRecordsLine(text: string): PaginationLine | null {
  const m = RE_TOTAL_RECORDS.exec(text);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  const from = parseInt(m[1], 10);
  const to = parseInt(m[2], 10);
  const total = parseInt(m[3], 10);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(total)) return null;
  return { from, to, total };
}

/** Fallback: parsea "Todos los registros (N)" en el menú lateral. */
export function parseSidebarCount(text: string): number | null {
  const m = RE_SIDEBAR_COUNT.exec(text);
  if (!m || !m[1]) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** Calcula número de página actual y cantidad de páginas a partir del pie. */
export function paginationFromLine(line: PaginationLine): { currentPage: number; numPages: number; pageSize: number } {
  const pageSize = Math.max(1, line.to - line.from + 1);
  const currentPage = Math.max(1, Math.ceil(line.from / pageSize));
  const numPages = Math.max(1, Math.ceil(line.total / pageSize));
  return { currentPage, numPages, pageSize };
}
