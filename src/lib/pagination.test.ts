/**
 * Tests para src/lib/pagination.ts.
 * Spec v1.0 §6.3.1.
 */

import { describe, expect, it } from 'vitest';

import { paginationFromLine, parseSidebarCount, parseTotalRecordsLine } from './pagination';

describe('parseTotalRecordsLine', () => {
  it('parsea el pie canónico', () => {
    expect(parseTotalRecordsLine('Mostrando del 1 al 10 de 45 resultados')).toEqual({
      from: 1,
      to: 10,
      total: 45,
    });
  });

  it('tolera espacios múltiples', () => {
    expect(parseTotalRecordsLine('Mostrando  del   11  al   20  de  45  resultados')).toEqual({
      from: 11,
      to: 20,
      total: 45,
    });
  });

  it('es case-insensitive', () => {
    expect(parseTotalRecordsLine('MOSTRANDO DEL 1 AL 5 DE 5 RESULTADOS')).toEqual({
      from: 1,
      to: 5,
      total: 5,
    });
  });

  it('devuelve null sobre texto sin match', () => {
    expect(parseTotalRecordsLine('Sin paginación')).toBeNull();
  });

  it('funciona si el pie está embebido en un cuerpo más grande', () => {
    const body = 'Bienvenido\nBlah blah\nMostrando del 21 al 30 de 123 resultados\nFooter';
    expect(parseTotalRecordsLine(body)?.total).toBe(123);
  });
});

describe('parseSidebarCount', () => {
  it('parsea el contador del menú lateral', () => {
    expect(parseSidebarCount('Todos los registros (45)')).toBe(45);
  });

  it('devuelve null si no hay paréntesis', () => {
    expect(parseSidebarCount('Todos los registros')).toBeNull();
  });
});

describe('paginationFromLine', () => {
  it('primera página: pageSize 10, 45 registros → 5 páginas', () => {
    expect(paginationFromLine({ from: 1, to: 10, total: 45 })).toEqual({
      currentPage: 1,
      numPages: 5,
      pageSize: 10,
    });
  });

  it('página intermedia se calcula bien', () => {
    expect(paginationFromLine({ from: 21, to: 30, total: 45 })).toEqual({
      currentPage: 3,
      numPages: 5,
      pageSize: 10,
    });
  });

  it('última página "incompleta" (pageSize inferido de la ventana)', () => {
    // Si la última página muestra 41..45 sobre 45 totales, pageSize inferido = 5,
    // numPages = 45/5 = 9, currentPage = ceil(41/5) = 9. Este caso demuestra
    // por qué el SW nunca infiere pageSize de la última página: siempre usa el
    // de la primera página.
    expect(paginationFromLine({ from: 41, to: 45, total: 45 })).toEqual({
      currentPage: 9,
      numPages: 9,
      pageSize: 5,
    });
  });

  it('página única (total ≤ pageSize)', () => {
    expect(paginationFromLine({ from: 1, to: 3, total: 3 })).toEqual({
      currentPage: 1,
      numPages: 1,
      pageSize: 3,
    });
  });
});
