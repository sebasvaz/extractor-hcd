/**
 * Analitos de un PDF de laboratorio, al descargar (service worker).
 *
 * Usa pdf.js (build legacy, sin DOM, en el hilo del service worker) y el
 * mismo parser del visor (`viewer/viewer-lab.js`) para que el ZIP traiga en
 * `metadata.json` los resultados de cada informe: así el visor dentro del ZIP
 * también grafica "Mis análisis", sin leer los PDF.
 *
 * Solo se guardan los analitos (nombre, valor, unidad, referencia), nunca el
 * texto completo del PDF: en los paquetes anonimizados el cabezal del PDF se
 * tapa visualmente pero su texto sigue ahí, y copiarlo al índice
 * reintroduciría el nombre y la cédula del titular.
 */

// pdf.js usa el "worker" en el mismo hilo si encuentra `globalThis.pdfjsWorker`.
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

// Define globalThis.HCDLab (parser compartido con el visor).
import './viewer/viewer-lab.js';

export type Analito = {
  nombre: string;
  valor: number;
  texto: string;
  unidad: string;
  ref: { min: number | null; max: number | null; texto: string } | null;
  fuera: '' | 'alto' | 'bajo';
};

type Lab = {
  lineas(bytes: Uint8Array): Promise<string[]>;
  analitos(lineas: string[]): Analito[];
};

let listo = false;
function preparar(): Lab | null {
  const g = globalThis as unknown as { pdfjsWorker?: unknown; pdfjsLib?: unknown; HCDLab?: Lab };
  if (!listo) {
    g.pdfjsWorker = pdfjsWorker;
    g.pdfjsLib = pdfjsLib;
    listo = true;
  }
  return g.HCDLab ?? null;
}

/** Máximo de analitos por informe: acota el tamaño de metadata.json ante un PDF raro. */
const MAX_POR_PDF = 200;

/**
 * Analitos del PDF (base64 sin prefijo). Nunca lanza: ante cualquier error
 * devuelve `[]` y la descarga sigue igual.
 */
export async function analitosDePdf(base64: string): Promise<Analito[]> {
  try {
    const lab = preparar();
    if (!lab) return [];
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const lineas = await lab.lineas(bytes);
    return lab.analitos(lineas).slice(0, MAX_POR_PDF);
  } catch {
    return [];
  }
}
