/**
 * Tests de pdf-analitos.ts: un PDF de laboratorio mínimo generado con
 * pdf-lib, leído con pdf.js como en el service worker.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { analitosDePdf } from './pdf-analitos';

async function pdfBase64(filas: Array<[string, number][]>): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  filas.forEach((fila, i) => {
    for (const [texto, x] of fila) page.drawText(texto, { x, y: 760 - i * 20, size: 10, font });
  });
  return Buffer.from(await doc.save()).toString('base64');
}

describe('analitosDePdf', () => {
  it('lee nombre, valor, unidad y referencia, sin el resto del texto', async () => {
    const b64 = await pdfBase64([
      [['Paciente: NOMBRE DE PRUEBA', 40]],
      [['Glucemia', 40], ['112', 220], ['mg/dl', 280], ['70 - 110', 360]],
      [['Colesterol total', 40], ['180', 220], ['mg/dl', 280], ['Hasta 200', 360]],
    ]);
    const a = await analitosDePdf(b64);
    expect(a.map((x) => [x.nombre, x.valor, x.unidad, x.fuera])).toEqual([
      ['Glucemia', 112, 'mg/dl', 'alto'],
      ['Colesterol total', 180, 'mg/dl', ''],
    ]);
    expect(JSON.stringify(a)).not.toContain('NOMBRE DE PRUEBA');
  });

  it('ante un PDF inválido devuelve [] sin lanzar', async () => {
    await expect(analitosDePdf(Buffer.from('no es un pdf').toString('base64'))).resolves.toEqual([]);
  });
});
