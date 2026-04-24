/**
 * Redacción visual del cabezal de PDFs (CDA nivel 1).
 *
 * Contexto:
 *  Los documentos de Laboratorio del portal Mi HCD se entregan como CDA
 *  nivel 1: un PDF embebido en `<pre id="b64">` con base64. Ese PDF contiene
 *  en su cabezal los datos personales del titular (nombre, cédula, fecha de
 *  nacimiento) tal como los emite el prestador sanitario. El motor de
 *  anonimización textual (`lib/anonymization`) opera sobre el HTML wrapper y
 *  no sobre el binario del PDF — este módulo cubre ese gap.
 *
 * Estrategia — redacción visual (rectangle overlay):
 *  Superponemos un rectángulo blanco opaco sobre la franja de datos del
 *  paciente en cada página. No parseamos content streams ni fuentes
 *  (complejidad inmanejable en un Service Worker MV3); en cambio cubrimos
 *  una banda fija posicionada entre el encabezado del prestador (que queda
 *  visible) y los títulos clínicos del estudio (que también quedan
 *  visibles), donde universalmente aparecen los datos del paciente en los
 *  PDFs del portal.
 *
 *  Limitaciones declaradas (best-effort, igual que el anonymizer HTML):
 *   - Redacción visual, no semántica: los bytes del texto original siguen en
 *     el content stream PDF y podrían recuperarse con herramientas forenses.
 *   - Si un prestador emite el PDF con el cabezal en otra posición (ej. pie
 *     de página), esa instancia no queda cubierta.
 *   - Funciona para PDFs no cifrados. PDFs con protección de escritura son
 *     devueltos sin modificar (con advertencia en el resultado).
 *
 *  Para un corpus de investigación donde se requiera desidentificación formal
 *  se recomienda una segunda pasada con pymupdf en el pipeline Python, sobre
 *  los PDFs ya redactados visualmente aquí.
 *
 * Dependencia: pdf-lib (MIT) — bundleado con la extensión, sin CDN.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Constantes de redacción
// ---------------------------------------------------------------------------

/**
 * Offset desde el borde superior de la página hasta el tope de la banda de
 * redacción, en puntos PDF (1 pt ≈ 0.353 mm).
 *
 * Deja visible el encabezado institucional del prestador (logo, nombre del
 * laboratorio, dirección, web, directora técnica, fecha de emisión) — esta
 * información NO es dato personal y sirve como contexto clínico.
 *
 * Medido sobre los PDFs reales de Mi HCD (Asociación Española, A4 = 842pt):
 *   - Logo + título + dirección + web + directora técnica + fecha: ~60pt
 *   → Usamos 62pt para asegurar que el logo queda íntegro.
 */
const HEADER_REDACT_TOP_OFFSET_PT = 62;

/**
 * Altura de la banda de redacción en puntos PDF.
 *
 * Cubre únicamente la tabla de datos del paciente (Nombre, Identificación,
 * Orden, Matrícula, Prestador, Fecha del estudio, Institución, Médico
 * Solicitante, Procedencia, Piso-Cama). NO se extiende hasta los títulos
 * clínicos del estudio (CORE / HEMOGRAMA / etc.), que deben permanecer
 * legibles para que el IPS tenga trazabilidad de qué sección se está
 * transcribiendo.
 *
 * Medido sobre los PDFs reales de Mi HCD:
 *   - Tabla paciente completa (3 filas + separadores): ~65pt
 *   → Usamos 70pt con un pequeño margen de tolerancia.
 *
 * NOTA IMPORTANTE — redacción visual vs. redacción real:
 *   Este rectángulo superpone visualmente el cabezal pero NO elimina el texto
 *   del content stream del PDF. El texto sigue siendo seleccionable y copiable
 *   con un visor PDF estándar. Para redacción real (eliminación del stream)
 *   se requiere pymupdf en el backend Python (page.apply_redactions()) o
 *   renderizar las páginas a imagen antes de re-emitir el PDF.
 *   Ver decisión arquitectónica en la sección de anonimización del README.
 */
const HEADER_REDACT_HEIGHT_PT = 70;

/**
 * Margen lateral de la banda de redacción (cubre de borde a borde).
 * En 0: el rectángulo va de x=0 al ancho total de la página.
 */
const HEADER_REDACT_X_MARGIN_PT = 0;

/**
 * Color del rectángulo de redacción (blanco opaco).
 */
const REDACT_COLOR = rgb(1, 1, 1);

/**
 * Texto descriptivo pequeño que se imprime sobre la banda redactada.
 * Ayuda a que el lector entienda que el dato fue eliminado intencionalmente
 * (y no que el PDF está corrupto).
 */
const REDACT_LABEL = '[DATOS PERSONALES REDACTADOS]';

// ---------------------------------------------------------------------------
// Tipos de resultado
// ---------------------------------------------------------------------------

export type PdfRedactResult =
  | {
      ok: true;
      /** Base64 estándar del PDF resultante (sin data-url prefix). */
      base64: string;
      /** SHA-256 hex de los bytes redactados (para actualizar attachmentSha256). */
      sha256: string;
    }
  | {
      ok: false;
      /** Base64 original sin modificar. */
      base64: string;
      /** SHA-256 original (el que venía en CapturedDocument). */
      sha256: string;
      /** Motivo por el que no se pudo redactar. */
      reason: string;
    };

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Recibe el PDF como base64 estándar (sin prefijo `data:`), superpone un
 * rectángulo blanco opaco sobre el cabezal de la primera página y devuelve
 * el PDF resultante como base64 + su SHA-256 actualizado.
 *
 * Si el PDF no puede cargarse (corrupto, cifrado, etc.) devuelve
 * `{ ok: false, base64: original, sha256: original, reason }` para que el
 * caller pueda loguear y continuar sin perder el adjunto.
 *
 * @param base64   - Bytes del PDF codificados en base64 estándar.
 * @param sha256In - Hash SHA-256 del PDF original (para el fallback).
 */
export async function redactPdfHeader(
  base64: string,
  sha256In: string,
): Promise<PdfRedactResult> {
  // 1. Decodificar base64 → Uint8Array
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = base64ToBytes(base64);
  } catch (e) {
    return { ok: false, base64, sha256: sha256In, reason: `base64 decode falló: ${String(e)}` };
  }

  // 2. Verificar magic number PDF (%PDF)
  if (
    pdfBytes.length < 4 ||
    pdfBytes[0] !== 0x25 || // %
    pdfBytes[1] !== 0x50 || // P
    pdfBytes[2] !== 0x44 || // D
    pdfBytes[3] !== 0x46    // F
  ) {
    return { ok: false, base64, sha256: sha256In, reason: 'No es un PDF válido (magic number incorrecto)' };
  }

  // 3. Cargar con pdf-lib
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, {
      // ignoreEncryption: true haría que intentemos cargar PDFs cifrados
      // pero pdf-lib igualmente no puede modificar contenido cifrado con
      // contraseña de propietario — mejor fallar limpiamente y avisar.
      ignoreEncryption: false,
    });
  } catch (e) {
    return {
      ok: false,
      base64,
      sha256: sha256In,
      reason: `pdf-lib no pudo cargar el PDF (¿cifrado/corrupto?): ${String(e)}`,
    };
  }

  // 4. Operar sobre TODAS las páginas.
  // Los PDFs de Mi HCD repiten el cabezal con datos del paciente en cada
  // página — redactar solo la primera dejaría las demás sin cubrir.
  const pages = pdfDoc.getPages();
  if (pages.length === 0) {
    return { ok: false, base64, sha256: sha256In, reason: 'El PDF no tiene páginas' };
  }

  // Embebemos la fuente una sola vez (es un recurso del documento, no de la página).
  let labelFont: Awaited<ReturnType<PDFDocument['embedFont']>> | null = null;
  try {
    labelFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  } catch {
    // Fuente no disponible — seguimos sin etiqueta
  }

  for (const page of pages) {
    const { width, height } = page.getSize();

    // Banda de redacción: franja intermedia de cada página.
    // En coordenadas PDF el origen está en la esquina inferior-izquierda,
    // por eso el tope de la banda queda en y = height - TOP_OFFSET y el
    // piso en y = height - TOP_OFFSET - HEIGHT. Esto deja visible el logo
    // del prestador por arriba y los títulos clínicos del estudio por debajo.
    const rectX = HEADER_REDACT_X_MARGIN_PT;
    const rectY = height - HEADER_REDACT_TOP_OFFSET_PT - HEADER_REDACT_HEIGHT_PT;
    const rectW = width - 2 * HEADER_REDACT_X_MARGIN_PT;
    const rectH = HEADER_REDACT_HEIGHT_PT;

    // Rectángulo blanco opaco
    page.drawRectangle({
      x: rectX,
      y: rectY,
      width: rectW,
      height: rectH,
      color: REDACT_COLOR,
      opacity: 1,
    });

    // Etiqueta de redacción (texto pequeño centrado en la banda)
    if (labelFont) {
      try {
        const fontSize = 7;
        const textWidth = labelFont.widthOfTextAtSize(REDACT_LABEL, fontSize);
        const textX = rectX + (rectW - textWidth) / 2;
        const textY = rectY + rectH / 2 - fontSize / 2;
        page.drawText(REDACT_LABEL, {
          x: textX,
          y: textY,
          size: fontSize,
          font: labelFont,
          color: rgb(0.5, 0.5, 0.5),
          opacity: 0.8,
        });
      } catch {
        // La etiqueta es cosmética — si falla en alguna página, ignoramos
        // y el rectángulo blanco ya cubre los datos.
      }
    }
  }

  // 5. Serializar PDF modificado
  let newBytes: Uint8Array;
  try {
    newBytes = await pdfDoc.save();
  } catch (e) {
    return {
      ok: false,
      base64,
      sha256: sha256In,
      reason: `pdf-lib no pudo serializar el PDF modificado: ${String(e)}`,
    };
  }

  // 6. Base64 + SHA-256 del resultado
  const newBase64 = bytesToBase64(newBytes);
  const newSha256 = await sha256Hex(newBytes);

  return { ok: true, base64: newBase64, sha256: newSha256 };
}

// ---------------------------------------------------------------------------
// Helpers de encoding (sin FileReader ni Node buffers — SW MV3 compatible)
// ---------------------------------------------------------------------------

/**
 * Decodifica base64 estándar a Uint8Array.
 * Usa `atob` (disponible en SW) + mapeo de char codes.
 */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/**
 * Codifica Uint8Array a base64 estándar.
 * Procesa en chunks de 32 KiB para evitar stack overflow con buffers grandes.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  const pieces: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    pieces.push(String.fromCharCode(...Array.from(bytes.subarray(i, end))));
  }
  return btoa(pieces.join(''));
}

/**
 * SHA-256 hex de un Uint8Array usando SubtleCrypto (disponible en SW MV3).
 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  const arr = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}
