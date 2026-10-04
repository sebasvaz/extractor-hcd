/**
 * Tests de viewer-lab.js: armado de líneas desde pdf.js y extracción de
 * analitos con las formas reales de los informes de laboratorio.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import labSrc from './viewer-lab.js?raw';

type Analito = { nombre: string; valor: number; texto: string; unidad: string; ref: { min: number | null; max: number | null } | null; fuera: string };
type Lab = {
  agrupar(items: Array<{ str: string; transform: number[]; width: number }>): string[];
  analitos(ls: string[]): Analito[];
};
let L: Lab;
beforeAll(() => {
  new Function(labSrc)();
  L = (globalThis as unknown as { HCDLab: Lab }).HCDLab;
});

const it_ = (str: string, x: number, y: number, width = str.length * 5) => ({ str, transform: [1, 0, 0, 1, x, y], width });

describe('agrupar', () => {
  it('arma líneas por altura y separa columnas por distancia', () => {
    const lineas = L.agrupar([
      it_('Hemoglobina', 40, 700), it_('13,5', 200, 700), it_('g/dL', 260, 700), it_('12 - 16', 340, 700),
      it_('Glucemia', 40, 680), it_('98', 200, 680.8), it_('mg/dl', 260, 680),
    ]);
    expect(lineas).toEqual(['Hemoglobina | 13,5 | g/dL | 12 - 16', 'Glucemia | 98 | mg/dl']);
  });
});

describe('analitos', () => {
  it('nombre | valor | unidad | referencia', () => {
    expect(L.analitos(['Hemoglobina | 13,5 | g/dL | 12 - 16'])).toEqual([
      { nombre: 'Hemoglobina', valor: 13.5, texto: '13,5', unidad: 'g/dL', ref: { min: 12, max: 16, texto: '12 - 16' }, fuera: '' },
    ]);
  });

  it('valor con unidad en la misma columna y referencia con texto', () => {
    const [a] = L.analitos(['GLUCEMIA | 132 mg/dl | Referencia: 70 a 110 mg/dl']);
    expect(a).toMatchObject({ valor: 132, unidad: 'mg/dl', ref: { min: 70, max: 110 }, fuera: 'alto' });
  });

  it('valor con prefijo "RESULTADO" y referencia "hasta"', () => {
    const [a] = L.analitos(['TSH ULTRASENSIBLE | RESULTADO 2.1 uU/ml | Normal: hasta 4.5']);
    expect(a).toMatchObject({ valor: 2.1, unidad: 'uU/ml', ref: { min: null, max: 4.5 }, fuera: '' });
  });

  it('marca valores bajos', () => {
    expect(L.analitos(['Hierro | 40 | ug/dl | 60 - 170'])[0]!.fuera).toBe('bajo');
  });

  it('descarta encabezados, fechas, páginas y datos del paciente', () => {
    expect(L.analitos(['Edad: | 54 | Años', 'Página | 1 | de 1', 'Fecha | 12/03/2026', 'Cantidad | 1', 'Solo texto'])).toEqual([]);
  });
});
