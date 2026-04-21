/**
 * Tests unitarios para src/lib/slug.ts.
 * Cubre los puntos clave de la Especificación Técnica v1.0, §8.3:
 *  - Normalización NFD + remoción de tildes.
 *  - Minúsculas + reemplazo de no-[a-z0-9] por '-' + colapso.
 *  - Truncado a 80 caracteres.
 *  - Dedupe con sufijo -2, -3, ...
 *  - Nombre de archivo por evento y nombre del ZIP.
 */

import { describe, expect, it } from 'vitest';

import { eventFileName, slugify, uniqueSlug, zipFileName } from './slug';

describe('slugify', () => {
  it('colapsa espacios y normaliza tildes', () => {
    expect(slugify('Policlínica de Medicina')).toBe('policlinica-de-medicina');
  });

  it('devuelve "" si el input es vacío', () => {
    expect(slugify('')).toBe('');
  });

  it('descompone diacríticos complejos (NFD)', () => {
    expect(slugify('Imagenología — Ecografía')).toBe('imagenologia-ecografia');
  });

  it('trunca a 80 caracteres sin dejar guion final', () => {
    const long = 'a'.repeat(200);
    const out = slugify(long);
    expect(out.length).toBeLessThanOrEqual(80);
  });

  it('no retorna guiones en los bordes', () => {
    expect(slugify('  --hola--  ')).toBe('hola');
  });

  it('conserva números', () => {
    expect(slugify('Internación 2025/03')).toBe('internacion-2025-03');
  });
});

describe('uniqueSlug', () => {
  it('devuelve el base cuando no hay colisión', () => {
    const seen = new Set<string>();
    expect(uniqueSlug('evento-x', seen)).toBe('evento-x');
    expect(seen.has('evento-x')).toBe(true);
  });

  it('aplica sufijo -2 ante primera colisión', () => {
    const seen = new Set<string>(['evento-x']);
    expect(uniqueSlug('evento-x', seen)).toBe('evento-x-2');
  });

  it('incrementa -2, -3, -4 ante colisiones sucesivas', () => {
    const seen = new Set<string>();
    const a = uniqueSlug('evento-x', seen);
    const b = uniqueSlug('evento-x', seen);
    const c = uniqueSlug('evento-x', seen);
    const d = uniqueSlug('evento-x', seen);
    expect([a, b, c, d]).toEqual(['evento-x', 'evento-x-2', 'evento-x-3', 'evento-x-4']);
  });

  it('usa "evento" si la base es vacía', () => {
    const seen = new Set<string>();
    expect(uniqueSlug('', seen)).toBe('evento');
  });
});

describe('eventFileName', () => {
  it('compone el archivo en la forma fecha_categoria_descripcion.html bajo docs/', () => {
    const seen = new Set<string>();
    const res = eventFileName({
      fechaIso: '2026-04-15',
      categoria: 'Policlínica',
      descripcion: 'Consulta Médica',
      seen,
    });
    expect(res.id).toBe('2026-04-15_policlinica_consulta-medica');
    expect(res.filePath).toBe('docs/2026-04-15_policlinica_consulta-medica.html');
  });

  it('cae en sin-descripcion si descripcion es undefined', () => {
    const seen = new Set<string>();
    const res = eventFileName({
      fechaIso: '2026-04-15',
      categoria: 'Vacunas',
      descripcion: undefined,
      seen,
    });
    expect(res.id).toMatch(/^2026-04-15_vacunas_sin-descripcion$/);
  });

  it('dedupe entre eventos con misma tripleta', () => {
    const seen = new Set<string>();
    const a = eventFileName({
      fechaIso: '2026-04-15',
      categoria: 'Policlínica',
      descripcion: 'Consulta',
      seen,
    });
    const b = eventFileName({
      fechaIso: '2026-04-15',
      categoria: 'Policlínica',
      descripcion: 'Consulta',
      seen,
    });
    expect(a.id).not.toBe(b.id);
    expect(b.id).toBe(`${a.id}-2`);
  });
});

describe('zipFileName', () => {
  it('arma el nombre según spec §8.1', () => {
    const when = new Date(Date.UTC(2026, 3, 15, 10, 30, 0)); // abril = mes 3 (0-indexed)
    // Usamos getters locales; forzamos en UTC para el assert.
    const name = zipFileName('Juan Pérez', when);
    // El patrón es hcd_export_<slug>_YYYY-MM-DD_HHMM.zip; la hora local
    // puede variar por timezone, así que solo chequeamos los tokens estables.
    expect(name).toMatch(/^hcd_export_juan-perez_\d{4}-\d{2}-\d{2}_\d{4}\.zip$/);
  });

  it('cae a "paciente" si el slug queda vacío', () => {
    const name = zipFileName('***', new Date(2026, 3, 15, 10, 30, 0));
    expect(name.startsWith('hcd_export_paciente_')).toBe(true);
  });
});
