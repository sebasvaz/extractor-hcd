/**
 * Constructor del paquete ZIP de salida.
 *
 * Alineado a la Especificación Técnica v1.0, sección 8 y Anexo A.
 *
 * Estructura generada:
 *   hcd_export_<slug>_<yyyy-mm-dd_hhmm>.zip
 *   ├── metadata.json     (schema v1.0 — Anexo A)
 *   ├── log.txt           (log circular de la corrida)
 *   ├── README.txt        (instrucciones humanas)
 *   └── docs/
 *       └── <fecha>_<categoria>_<descripcion>.html   (un archivo por evento)
 *
 * Decisiones:
 *  - JSZip 3.x (MIT) — bundleado, NUNCA desde CDN (spec §9.3 CSP estricta).
 *  - DEFLATE nivel 6 (balance tamaño/velocidad).
 *  - Los HTML ya vienen "self-contained" desde el content script — este
 *    módulo no modifica su contenido.
 *  - `metadata.json` incluye errors[] para trazabilidad total, incluso
 *    cuando la corrida termina incompleta (spec §5.4 — descarga parcial).
 */

import JSZip from 'jszip';

import type { CapturedDocument, CaptureError, LogEntry } from './messaging/types';
import { slugify, zipFileName } from './slug';

// ---------------------------------------------------------------------------
// Tipos alineados al JSON Schema del Anexo A
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = '1.0';

export type HCDExportMetadata = {
  schemaVersion: '1.0';
  exportId: string;
  exportedAt: string;
  startedAt: string;
  source: {
    portal: string;
    baseUrl: string;
  };
  patient: {
    displayName: string;
    documentHash?: string;
  };
  /**
   * Si la corrida aplicó anonimización, queda registrado a nivel paquete.
   * `anonymizationScope` indica el nivel aplicado (por ahora solo `'basic'`
   * — ver `lib/anonymization`). Ausente cuando el usuario optó por no
   * anonimizar.
   */
  anonymized?: boolean;
  anonymizationScope?: 'basic';
  totals: {
    expected: number;
    captured: number;
    failed: number;
  };
  documents: Array<{
    id: string;
    file: string;
    categoria: string;
    fecha: string;
    prestador?: string;
    profesional?: string;
    descripcion?: string;
    visualizarUrl: string;
    captureUrl: string;
    capturedAt: string;
    sha256: string;
    /**
     * Adjunto opcional (CDA nivel 1: PDF embebido). Presente cuando el
     * documento original venía como `<pre id="b64">` + VisorPDF.js. El HTML
     * de `file` incluye un link al adjunto para que el corpus sea legible
     * sin JavaScript. `attachmentSha256` es hash de los bytes del PDF.
     */
    attachmentFile?: string;
    attachmentMime?: string;
    attachmentSha256?: string;
  }>;
  errors: Array<{
    categoria?: string;
    fecha?: string;
    descripcion?: string;
    url?: string;
    message: string;
    occurredAt: string;
  }>;
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export type BuildZipArgs = {
  patient: { displayName: string; documentHash?: string };
  expected: number;
  documents: CapturedDocument[];
  errors: CaptureError[];
  log: LogEntry[];
  startedAt: string;
  /**
   * Anonimización: si verdadero, el HTML de `documents` ya viene con los
   * identificadores sustituidos por tokens (ver `lib/anonymization`). El
   * metadata.json resultante lleva `anonymized: true` y el scope aplicado.
   * Si se omite, el paquete se emite sin esos campos (no-anonimizado).
   */
  anonymized?: boolean;
  anonymizationScope?: 'basic';
  /** Opcional: sobreescribir el reloj (para tests). */
  now?: Date;
};

export type BuildZipResult = {
  blob: Blob;
  filename: string;
  metadata: HCDExportMetadata;
};

/**
 * Arma el ZIP completo y devuelve el Blob listo para descargar.
 *
 * No dispara chrome.downloads — de eso se encarga el service worker
 * (separación de responsabilidades; `zip-builder` es testeable en Node).
 */
export async function buildZip(args: BuildZipArgs): Promise<BuildZipResult> {
  const now = args.now ?? new Date();
  const metadata = buildMetadata(args, now);
  const zip = new JSZip();

  // Top-level
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));
  zip.file('log.txt', serializeLog(args.log));
  zip.file('README.txt', readme(now, Boolean(args.anonymized)));

  // docs/
  const docsFolder = zip.folder('docs');
  if (!docsFolder) {
    throw new Error('No se pudo crear la carpeta docs/ en el ZIP.');
  }
  for (const doc of args.documents) {
    const relative = filePathFromMetadata(metadata, doc.id);
    // filePathFromMetadata devuelve "docs/<id>.html"; quitamos el prefijo
    // porque estamos dentro de docsFolder.
    const inFolder = relative.replace(/^docs\//, '');
    docsFolder.file(inFolder, doc.html);
    // Adjunto (CDA nivel 1): base64 → bytes → docs/<id>.pdf.
    if (doc.attachmentBase64 && doc.attachmentMime === 'application/pdf') {
      const pdfName = `${doc.id}.pdf`;
      docsFolder.file(pdfName, doc.attachmentBase64, { base64: true });
    }
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/zip',
  });

  const filename = zipFileName(slugify(args.patient.displayName) || 'paciente', now);

  return { blob, filename, metadata };
}

/**
 * Construye el objeto `metadata.json` sin generar el ZIP.
 * Expuesto para test unitario del shape.
 */
export function buildMetadata(args: BuildZipArgs, now: Date = new Date()): HCDExportMetadata {
  const captured = args.documents.length;
  const failed = args.errors.length;

  const documentsOut: HCDExportMetadata['documents'] = args.documents.map((d) => {
    const out: HCDExportMetadata['documents'][number] = {
      id: d.id,
      file: `docs/${d.id}.html`,
      categoria: d.categoria,
      fecha: d.fecha,
      visualizarUrl: d.visualizarUrl,
      captureUrl: d.captureUrl,
      capturedAt: d.capturedAt,
      sha256: d.sha256,
    };
    if (d.prestador !== undefined) out.prestador = d.prestador;
    if (d.profesional !== undefined) out.profesional = d.profesional;
    if (d.descripcion !== undefined) out.descripcion = d.descripcion;
    if (d.attachmentBase64 && d.attachmentMime === 'application/pdf') {
      out.attachmentFile = `docs/${d.id}.pdf`;
      out.attachmentMime = 'application/pdf';
      if (d.attachmentSha256) out.attachmentSha256 = d.attachmentSha256;
    }
    return out;
  });

  const errorsOut: HCDExportMetadata['errors'] = args.errors.map((e) => {
    const out: HCDExportMetadata['errors'][number] = {
      message: e.message,
      occurredAt: e.occurredAt,
    };
    if (e.meta.categoria !== undefined) out.categoria = e.meta.categoria;
    if (e.meta.fecha !== undefined) out.fecha = e.meta.fecha;
    if (e.meta.descripcion !== undefined) out.descripcion = e.meta.descripcion;
    if (e.url !== undefined) out.url = e.url;
    return out;
  });

  const patient: HCDExportMetadata['patient'] = {
    displayName: args.patient.displayName,
  };
  if (args.patient.documentHash !== undefined) {
    patient.documentHash = args.patient.documentHash;
  }

  const out: HCDExportMetadata = {
    schemaVersion: SCHEMA_VERSION,
    exportId: uuidv4(),
    exportedAt: now.toISOString(),
    startedAt: args.startedAt,
    source: {
      portal: 'Mi HCD — historiaclinicadigital.gub.uy',
      baseUrl: 'https://historiaclinicadigital.gub.uy',
    },
    patient,
    totals: {
      expected: args.expected,
      captured,
      failed,
    },
    documents: documentsOut,
    errors: errorsOut,
  };
  if (args.anonymized) {
    out.anonymized = true;
    out.anonymizationScope = args.anonymizationScope ?? 'basic';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filePathFromMetadata(meta: HCDExportMetadata, id: string): string {
  const found = meta.documents.find((d) => d.id === id);
  return found?.file ?? `docs/${id}.html`;
}

function serializeLog(entries: LogEntry[]): string {
  return (
    entries
      .map((e) => {
        const ctx = e.context ? ' ' + JSON.stringify(e.context) : '';
        return `${e.timestamp} ${e.level.padEnd(5)} ${e.message}${ctx}`;
      })
      .join('\n') + '\n'
  );
}

/**
 * UUID v4 usando crypto.randomUUID() si está disponible; si no, fallback
 * sobre crypto.getRandomValues.
 */
function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Version + variant bits
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function readme(now: Date, anonymized: boolean): string {
  const anonBlock = anonymized
    ? `Anonimización: ACTIVADA (nivel básico)
  - Se sustituyeron en los HTML los siguientes identificadores directos:
    nombre del paciente, cédula UY, teléfono UY, correo electrónico.
  - No se anonimizan: profesionales, prestadores, fechas, texto clínico libre.
  - Alcance best-effort (regex). Revisá el paquete antes de compartirlo si
    necesitás garantía formal de desidentificación. Ver README de la
    extensión para limitaciones.
  - IMPORTANTE — PDFs embebidos: los documentos de Laboratorio (CDA nivel 1)
    incluyen un PDF adjunto que CONSERVA el nombre y la CI del titular.
    El HTML-wrapper asociado sí está anonimizado, pero el PDF no. Si vas a
    compartir el ZIP fuera del circuito médico, redactá o excluí los PDFs
    de docs/ antes de enviarlo.

`
    : `Anonimización: desactivada (el paquete contiene datos personales en claro).
  Manejalo como información sensible de salud (Ley N° 18.331, art. 18).

`;
  return `Extractor de HCD — corpus del titular
=====================================

Este paquete fue generado por la extensión "Extractor de HCD" a partir de
la sesión autenticada del titular en el portal Mi HCD
(historiaclinicadigital.gub.uy).

Contenido:
  - metadata.json : índice completo de la corrida (schema v1.0).
  - log.txt       : log de operación (sin contenido clínico).
  - docs/         : un archivo HTML por evento asistencial capturado.
                    Para CDA nivel 1 (laboratorio, etc.), además del HTML se
                    incluye el PDF original como <id>.pdf en la misma carpeta.

${anonBlock}Base legal: los datos aquí contenidos pertenecen al titular que ejecutó la
extensión en su propia sesión (Ley N° 18.331, Uruguay — derecho de acceso
del titular, art. 14). El paquete es responsabilidad exclusiva de quien lo
generó y de quien lo custodie.

Herramienta desarrollada en el marco del Proyecto Final de la Lic. en
Sistemas, Universidad ORT Uruguay. Uso no comercial.

Generado: ${now.toISOString()}
`;
}

