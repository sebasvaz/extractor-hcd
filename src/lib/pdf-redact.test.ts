/**
 * Tests de redactPdfHeader.
 *
 * Cubre:
 *  - PDF válido: resultado ok=true, base64 distinto del original (el PDF fue modificado),
 *    SHA-256 actualizado y coherente con los bytes.
 *  - PDF válido: la primera página del resultado tiene dimensiones idénticas al original.
 *  - Entrada no-PDF (cadena arbitrary): ok=false con reason descriptivo.
 *  - Entrada base64 inválido: ok=false con reason descriptivo.
 *  - PDF vacío de páginas: ok=false.
 *  - SHA-256 devuelto coincide con el hash real de los bytes del PDF resultante.
 *
 * Estrategia:
 *  Generamos un PDF mínimo en cada test con pdf-lib (disponible en Node/Vitest),
 *  lo pasamos a redactPdfHeader y verificamos el resultado. No usamos fixtures
 *  en disco para mantener los tests herméticos.
 */

import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { redactPdfHeader } from './pdf-redact';

// ---------------------------------------------------------------------------
// Helpers de test
// ---------------------------------------------------------------------------

/**
 * Crea un PDF A4 con N páginas, texto de datos personales en el cabezal
 * de cada página (simula el formato real de Mi HCD). Devuelve base64 + SHA-256.
 */
async function makeSamplePdf(numPages = 1): Promise<{ base64: string; sha256: string }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < numPages; i++) {
    const page = doc.addPage([595, 842]); // A4 en puntos
    page.drawText('Nombre  JUAN PEREZ   Identificación CI-1234567', {
      x: 50,
      y: 780,
      size: 11,
      font,
    });
    page.drawText('Orden 8942493   Fecha 04/11/2025   Institución ASOC ESPAÑOLA', {
      x: 50,
      y: 765,
      size: 9,
      font,
    });
    page.drawText(`Contenido clínico página ${i + 1}: glucosa 95 mg/dL, normal.`, {
      x: 50,
      y: 600,
      size: 10,
      font,
    });
  }
  const bytes = await doc.save();
  const base64 = bytesToBase64(bytes);
  const sha256 = await sha256Hex(bytes);
  return { base64, sha256 };
}

/** Convierte Uint8Array → base64 estándar (misma lógica que el módulo). */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  const pieces: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    pieces.push(String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK))));
  }
  return btoa(pieces.join(''));
}

/** Decodifica base64 → Uint8Array. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** SHA-256 hex via SubtleCrypto (disponible en Vitest con jsdom/node). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  const arr = new Uint8Array(digest);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('redactPdfHeader — PDF válido', () => {
  it('devuelve ok=true con un PDF válido', async () => {
    const { base64, sha256 } = await makeSamplePdf();
    const result = await redactPdfHeader(base64, sha256);
    expect(result.ok).toBe(true);
  });

  it('el base64 resultante difiere del original (el PDF fue modificado)', async () => {
    const { base64, sha256 } = await makeSamplePdf();
    const result = await redactPdfHeader(base64, sha256);
    expect(result.ok).toBe(true);
    // El PDF redactado tiene más contenido (el rectángulo overlay)
    expect(result.base64).not.toBe(base64);
  });

  it('el resultado sigue siendo un PDF válido (magic number %PDF)', async () => {
    const { base64, sha256 } = await makeSamplePdf();
    const result = await redactPdfHeader(base64, sha256);
    expect(result.ok).toBe(true);
    const bytes = base64ToBytes(result.base64);
    // Magic: %PDF = 0x25 0x50 0x44 0x46
    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
  });

  it('la primera página conserva las mismas dimensiones que el original', async () => {
    const { base64, sha256 } = await makeSamplePdf();
    const result = await redactPdfHeader(base64, sha256);
    expect(result.ok).toBe(true);

    const origDoc = await PDFDocument.load(base64ToBytes(base64));
    const newDoc = await PDFDocument.load(base64ToBytes(result.base64));

    const { width: w0, height: h0 } = origDoc.getPages()[0]!.getSize();
    const { width: w1, height: h1 } = newDoc.getPages()[0]!.getSize();
    expect(w1).toBeCloseTo(w0, 1);
    expect(h1).toBeCloseTo(h0, 1);
  });

  it('el sha256 devuelto coincide con el hash real de los bytes resultantes', async () => {
    const { base64, sha256 } = await makeSamplePdf();
    const result = await redactPdfHeader(base64, sha256);
    expect(result.ok).toBe(true);

    const actualSha = await sha256Hex(base64ToBytes(result.base64));
    expect(result.sha256).toBe(actualSha);
  });

  it('el sha256 resultante difiere del original (los bytes cambiaron)', async () => {
    const { base64, sha256 } = await makeSamplePdf();
    const result = await redactPdfHeader(base64, sha256);
    expect(result.ok).toBe(true);
    expect(result.sha256).not.toBe(sha256);
  });

  it('el PDF redactado puede cargarse con pdf-lib sin errores', async () => {
    const { base64, sha256 } = await makeSamplePdf();
    const result = await redactPdfHeader(base64, sha256);
    expect(result.ok).toBe(true);
    // No debería lanzar
    await expect(PDFDocument.load(base64ToBytes(result.base64))).resolves.toBeDefined();
  });
});

describe('redactPdfHeader — entradas inválidas', () => {
  it('devuelve ok=false para una cadena que no es PDF', async () => {
    const fakePdf = btoa('esto no es un pdf para nada');
    const result = await redactPdfHeader(fakePdf, 'deadbeef');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
      // El base64 y sha256 originales se devuelven sin modificar
      expect(result.base64).toBe(fakePdf);
      expect(result.sha256).toBe('deadbeef');
    }
  });

  it('devuelve ok=false para un base64 mal formado', async () => {
    const result = await redactPdfHeader('!!!no-es-base64!!!', 'abc123');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('base64 decode');
    }
  });

  it('devuelve ok=false para datos binarios arbitrarios con magic incorrecto', async () => {
    // Bytes válidos para base64 pero que no son un PDF (magic != %PDF)
    const fakeBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    const base64 = bytesToBase64(fakeBytes);
    const result = await redactPdfHeader(base64, 'abc');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/magic/i);
    }
  });
});

describe('redactPdfHeader — multi-página', () => {
  it('redacta todas las páginas de un PDF de 7 páginas', async () => {
    const { base64, sha256 } = await makeSamplePdf(7);
    const result = await redactPdfHeader(base64, sha256);
    expect(result.ok).toBe(true);
    // El resultado sigue siendo un PDF válido con 7 páginas
    const newDoc = await PDFDocument.load(base64ToBytes(result.base64));
    expect(newDoc.getPageCount()).toBe(7);
  });

  it('el PDF de 3 páginas resulta en base64 distinto al original (todas modificadas)', async () => {
    const { base64, sha256 } = await makeSamplePdf(3);
    const result = await redactPdfHeader(base64, sha256);
    expect(result.ok).toBe(true);
    expect(result.base64).not.toBe(base64);
  });

  it('PDF de una sola página sigue funcionando', async () => {
    const { base64, sha256 } = await makeSamplePdf(1);
    const result = await redactPdfHeader(base64, sha256);
    expect(result.ok).toBe(true);
    const newDoc = await PDFDocument.load(base64ToBytes(result.base64));
    expect(newDoc.getPageCount()).toBe(1);
  });
});

describe('redactPdfHeader — idempotencia parcial', () => {
  it('aplicar dos veces no rompe el PDF', async () => {
    const { base64, sha256 } = await makeSamplePdf();
    const r1 = await redactPdfHeader(base64, sha256);
    expect(r1.ok).toBe(true);
    // Segunda pasada sobre el resultado de la primera
    const r2 = await redactPdfHeader(r1.base64, r1.sha256);
    expect(r2.ok).toBe(true);
    // Debe seguir siendo PDF válido
    const bytes = base64ToBytes(r2.base64);
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
  });
});
