/**
 * Tests de timeline-row.ts con filas sintéticas que reproducen la forma
 * real del `innerText` de una fila del timeline de Mi HCD.
 */

import { describe, expect, it } from 'vitest';

import { fixMojibake, parseTimelineRow } from './timeline-row';

/** Texto UTF-8 leído como Latin-1, como lo muestra el portal. */
const roto = (s: string) => String.fromCharCode(...new TextEncoder().encode(s));

const FILA = [
  'Policlínica',
  '23/03/2026\t\tHOSPITAL CENTRAL\t\t\t\t\tNombre completo del prestador\tSociedad Hospital Central del Uruguay',
  'Profesional: JUAN PÉREZ',
  'Descripción: servicio de urología',
].join('\n');

describe('parseTimelineRow', () => {
  it('separa prestador, nombre completo, profesional y descripción', () => {
    expect(parseTimelineRow(FILA)).toEqual({
      prestador: 'HOSPITAL CENTRAL',
      prestadorNombre: 'Sociedad Hospital Central del Uruguay',
      profesional: 'JUAN PÉREZ',
      descripcion: 'servicio de urología',
    });
  });

  it('con el profesional vacío, no le pasa la descripción', () => {
    const r = parseTimelineRow('Emergencia\n01/02/2025\tASSE\nProfesional: Descripción: servicio de emergencia');
    expect(r.profesional).toBeUndefined();
    expect(r.descripcion).toBe('servicio de emergencia');
    expect(r.prestador).toBe('ASSE');
  });

  it('repara los acentos rotos del portal', () => {
    const r = parseTimelineRow(roto('Profesional: MARÍA GÓMEZ\nDescripción: servicio de cardiología'));
    expect(r.profesional).toBe('MARÍA GÓMEZ');
    expect(r.descripcion).toBe('servicio de cardiología');
  });

  it('una fila sin rótulos no inventa campos', () => {
    expect(parseTimelineRow('Laboratorio')).toEqual({});
  });
});

describe('fixMojibake', () => {
  it('repara texto codificado dos veces y no toca texto sano', () => {
    expect(fixMojibake(roto(roto('cardiología')))).toBe('cardiología');
    expect(fixMojibake('Ñandú – ok')).toBe('Ñandú – ok');
  });
});
