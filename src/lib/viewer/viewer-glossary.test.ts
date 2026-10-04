/**
 * Tests de viewer-glossary.js: siglas, búsqueda con sinónimos y "¿Quisiste decir…?".
 */

import { beforeAll, describe, expect, it } from 'vitest';

import glossarySrc from './viewer-glossary.js?raw';

type Glossary = {
  SIGLAS: Record<string, string>;
  partes(t: string): Array<{ text?: string; sigla?: string; title?: string }>;
  contar(t: string): Record<string, number>;
  variantes(q: string): string[][];
  distancia(a: string, b: string, max: number): number;
  sugerir(t: string[], vocab: Record<string, number>): string | null;
};
let G: Glossary;
beforeAll(() => {
  new Function(glossarySrc)();
  G = (globalThis as unknown as { HCDGlossary: Glossary }).HCDGlossary;
});

describe('siglas', () => {
  it('reconoce siglas aisladas y en mayúsculas', () => {
    expect(G.partes('Paciente con HTA y DM2.')).toEqual([
      { text: 'Paciente con ' },
      { sigla: 'HTA', title: 'Hipertensión arterial' },
      { text: ' y ' },
      { sigla: 'DM2', title: 'Diabetes mellitus tipo 2' },
      { text: '.' },
    ]);
  });

  it('no confunde palabras que contienen una sigla ni minúsculas', () => {
    expect(G.partes('pepino Pep PEPE hta')).toEqual([{ text: 'pepino Pep PEPE hta' }]);
  });

  it('cuenta las siglas de un texto', () => {
    expect(G.contar('HTA, EPOC. Control de HTA')).toEqual({ HTA: 2, EPOC: 1 });
  });

  it('las expansiones vienen del seed de la plataforma, con tildes', () => {
    expect(G.SIGLAS.EPOC).toBe('Enfermedad pulmonar obstructiva crónica');
    expect(Object.keys(G.SIGLAS).every((k) => k.length >= 3)).toBe(true);
  });
});

describe('búsqueda con sinónimos', () => {
  it('sigla → también su significado', () => {
    expect(G.variantes('HTA')).toEqual([['hta'], ['hipertension', 'arterial']]);
  });

  it('significado → también la sigla', () => {
    expect(G.variantes('Hipertensión arterial')).toContainEqual(['hta']);
  });

  it('una palabra del significado también trae la sigla', () => {
    expect(G.variantes('tuberculosis')).toContainEqual(['tbc']);
  });

  it('sin sinónimos, una sola variante', () => {
    expect(G.variantes('hemoglobina')).toEqual([['hemoglobina']]);
  });
});

describe('¿Quisiste decir…?', () => {
  const vocab = { hemoglobina: 4, hemograma: 6, glucemia: 3, urologia: 2 };

  it('corrige un error de tipeo', () => {
    expect(G.sugerir(['hemoglovina'], vocab)).toBe('hemoglobina');
    expect(G.sugerir(['urolgia'], vocab)).toBe('urologia');
  });

  it('no sugiere si la palabra existe o no hay nada parecido', () => {
    expect(G.sugerir(['glucemia'], vocab)).toBeNull();
    expect(G.sugerir(['xyzxyz'], vocab)).toBeNull();
  });
});
