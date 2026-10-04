/**
 * Tests de viewer-normalize.js con datos sintéticos que reproducen las
 * formas reales de los ZIP ≤ 1.4.0 (docs/PLAN_VISOR.md, problemas A y B).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import normalizeSrc from './viewer-normalize.js?raw';

type Doc = Record<string, unknown>;
type Normalize = {
  fixMojibake(s: string): string;
  titleCase(s: string): string;
  normalizeDoc(d: Doc): Doc;
  normalizeError(e: Record<string, string>): Record<string, string>;
  unifyPrestadores(docs: Doc[]): Doc[];
  unifyEspecialidades(docs: Doc[]): Doc[];
};

let N: Normalize;
beforeAll(() => {
  new Function(normalizeSrc)();
  N = (globalThis as unknown as { HCDNormalize: Normalize }).HCDNormalize;
});

const FILA = '23/03/2026\t\tHOSPITAL CENTRAL\t\t\t\t\tNombre completo del prestador\tSociedad Hospital Central del Uruguay';

describe('fixMojibake', () => {
  it('repara UTF-8 leído como Latin-1', () => {
    expect(N.fixMojibake('cardiologÃ­a')).toBe('cardiología');
    expect(N.fixMojibake('ginecotocologÃ­a y pediatrÃ­a')).toBe('ginecotocología y pediatría');
  });
  it('repara aunque el texto tenga caracteres fuera de Latin-1', () => {
    expect(N.fixMojibake('cardiologÃ\u00ada — control')).toBe('cardiología — control');
  });

  it('repara texto codificado dos veces', () => {
    expect(N.fixMojibake('cardiologÃ\u0083Â\u00ada')).toBe('cardiología');
  });

  it('no toca texto sano', () => {
    expect(N.fixMojibake('Ñandú, cardiología')).toBe('Ñandú, cardiología');
  });
});

describe('titleCase', () => {
  it('pasa nombres en mayúsculas a mayúscula inicial', () => {
    expect(N.titleCase('JUAN PÉREZ DE LA FUENTE')).toBe('Juan Pérez de la Fuente');
  });
  it('respeta textos que ya vienen mezclados', () => {
    expect(N.titleCase('Juan Pérez')).toBe('Juan Pérez');
  });
});

describe('normalizeDoc', () => {
  it('saca prestador, profesional y especialidad de los campos corridos', () => {
    const d = N.normalizeDoc({
      categoria: 'Policlínica',
      descripcion: FILA,
      profesional: 'JUAN PÉREZ\nDescripción: servicio de urología',
      text: '',
    });
    expect(d.prestador).toBe('Hospital Central');
    expect(d.prestadorNombre).toBe('Sociedad Hospital Central del Uruguay');
    expect(d.profesional).toBe('Juan Pérez');
    expect(d.especialidad).toBe('Urología');
    expect(d.descripcion).toBe('');
    expect(d.titulo).toBe('Urología');
  });

  it('lee el formato limpio de la extensión v1.9 (servicio → especialidad)', () => {
    const d = N.normalizeDoc({
      categoria: 'Policlínica',
      prestador: 'HOSPITAL CENTRAL',
      prestadorNombre: 'Sociedad Hospital Central del Uruguay',
      profesional: 'JUAN PÉREZ',
      descripcion: 'servicio de urología',
      text: '',
    });
    expect(d.prestador).toBe('Hospital Central');
    expect(d.prestadorNombre).toBe('Sociedad Hospital Central del Uruguay');
    expect(d.profesional).toBe('Juan Pérez');
    expect(d.especialidad).toBe('Urología');
    expect(d.titulo).toBe('Urología');
  });

  it('mantiene siglas cortas', () => {
    const d = N.normalizeDoc({ categoria: 'Policlínica', descripcion: '01/02/2024\t\tCASMU\t\tNombre completo del prestador\tX', text: '' });
    expect(d.prestador).toBe('CASMU');
  });

  it('descarta un OID como título y usa el cabezal del documento', () => {
    const d = N.normalizeDoc({
      categoria: 'Vacunas',
      descripcion: '2.16.858.2.10002661.67430.20260427112602.13002639',
      profesional: 'Descripción: Servicio de vacunaciones',
      text: '',
      cda: { titulo: 'Historial de Vacunación', prestador: 'Ministerio de Salud Pública', profesional: 'ANA GÓMEZ,', fechaHora: 'Abril 27, 2026, 09:39:27' },
    });
    expect(d.titulo).toBe('Vacunaciones');
    expect(d.tipo).toBe('Historial de vacunación');
    expect(d.prestador).toBe('Ministerio de Salud Pública');
    expect(d.profesional).toBe('Ana Gómez');
    expect(d.hora).toBe('09:39');
    expect(d.cda).toBeUndefined();
  });

  it('sin especialidad ni descripción, titula con el cabezal o la categoría', () => {
    expect(N.normalizeDoc({ categoria: 'Laboratorio', text: '', cda: { titulo: 'Consulta no urgente' } }).titulo).toBe('Consulta no urgente');
    expect(N.normalizeDoc({ categoria: 'Laboratorio', text: '' }).titulo).toBe('Laboratorio');
  });

  it('respeta una descripción real (ZIPs bien formados)', () => {
    const d = N.normalizeDoc({ categoria: 'Policlínica', descripcion: 'Control anual', prestador: 'ASSE', profesional: 'Dra. Ana Gómez', text: '' });
    expect(d.titulo).toBe('Control anual');
    expect(d.prestador).toBe('ASSE');
    expect(d.profesional).toBe('Dra. Ana Gómez');
  });

  it('no inventa hora con medianoche', () => {
    expect(N.normalizeDoc({ categoria: 'Vacunas', text: '', cda: { fechaHora: '2026-04-27 00:00:00' } }).hora).toBe('');
  });
});

describe('normalizeError', () => {
  it('deja fecha, categoría y prestador legibles', () => {
    const e = N.normalizeError({ fecha: '2024-02-01', categoria: 'Laboratorio', descripcion: FILA, message: 'Fallaron todos los reintentos.' });
    expect(e).toMatchObject({ fecha: '2024-02-01', categoria: 'Laboratorio', prestador: 'Hospital Central', descripcion: '' });
  });
});

describe('unifyPrestadores', () => {
  it('usa la sigla también en los documentos que solo traían el nombre completo', () => {
    const a = N.normalizeDoc({ categoria: 'Policlínica', descripcion: FILA, text: '' });
    const b = N.normalizeDoc({ categoria: 'Laboratorio', text: '', cda: { prestador: 'Sociedad Hospital Central del Uruguay' } });
    N.unifyPrestadores([a, b]);
    expect(b.prestador).toBe('Hospital Central');
    expect(b.prestadorNombre).toBe('Sociedad Hospital Central del Uruguay');
  });
});

describe('unifyEspecialidades', () => {
  it('agrupa variantes y usa la forma con tildes y sin paréntesis', () => {
    const docs: Doc[] = [
      { especialidad: 'Siquiatria (psiquiatria)' },
      { especialidad: 'Psiquiatría' },
      { especialidad: 'Cardiologia' },
      { especialidad: 'Cardiología' },
      { especialidad: 'Cardiologia' },
    ];
    N.unifyEspecialidades(docs);
    expect(docs.map((d) => d.especialidad)).toEqual(['Psiquiatría', 'Psiquiatría', 'Cardiología', 'Cardiología', 'Cardiología']);
  });
});
