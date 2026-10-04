/**
 * Lectura de una fila del timeline de Mi HCD.
 *
 * Hasta v1.8.0 el scraper tomaba como `descripcion` el bloque de texto más
 * largo de la fila (la línea con fecha, sigla del prestador y "Nombre
 * completo del prestador"), dejaba `prestador` vacío y en `profesional`
 * arrastraba la línea "Descripción: servicio de …" (docs/PLAN_VISOR.md,
 * problema A). Las 1494 filas de la muestra real tienen esta forma (el
 * `innerText` de la fila):
 *
 *   Policlínica
 *   23/03/2026\t\tHOSPITAL BRITÁNICO\t\t\t\t\tNombre completo del prestador\tLa Sociedad Hospital Británico en el Uruguay
 *   Profesional: EMMANUEL MONTAÑA
 *   Descripción: servicio de urología
 *
 * Esta función lee la fila por rótulos y por línea, sin depender de la
 * estructura del DOM, y repara el texto que el portal muestra con los
 * acentos rotos (UTF-8 leído como Latin-1).
 */

export type TimelineRow = {
  /** Prestador como lo muestra el timeline (sigla o nombre corto). */
  prestador?: string;
  /** Nombre completo del prestador. */
  prestadorNombre?: string;
  profesional?: string;
  /** Servicio o descripción del evento ("servicio de urología"). */
  descripcion?: string;
};

const FECHA = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const ROTULO = /^(profesional|m[eé]dico|descripci[oó]n|prestador|instituci[oó]n)\s*:\s*(.*)$/i;

/**
 * "Profesional: NOMBRE" o, si el profesional viene vacío, "Profesional:
 * Descripción: servicio de X" en la misma línea: el valor que empieza con
 * otro rótulo se lee como ese rótulo.
 */
function leerRotulos(texto: string, out: TimelineRow): void {
  const m = ROTULO.exec(texto);
  if (!m) return;
  const clave = m[1]!.toLowerCase();
  const valor = m[2]!.trim();
  if (!valor) return;
  if (ROTULO.test(valor)) {
    leerRotulos(valor, out);
    return;
  }
  if (/^(profesional|m[eé]dico)$/.test(clave)) out.profesional ??= valor;
  else if (/^descripci/.test(clave)) out.descripcion ??= valor;
  else out.prestador ??= valor;
}

export function parseTimelineRow(rowText: string): TimelineRow {
  const out: TimelineRow = {};
  const lineas = fixMojibake(rowText).split(/\r?\n/).map((l) => l.replace(/ /g, ' '));

  for (const linea of lineas) {
    const limpia = linea.trim();
    if (!limpia) continue;

    if (ROTULO.test(limpia)) {
      leerRotulos(limpia, out);
      continue;
    }

    // Línea con columnas (tabulaciones): fecha, prestador, "Nombre completo del prestador", nombre.
    if (linea.includes('\t')) {
      const cols = linea.split('\t').map((c) => c.trim()).filter(Boolean);
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i]!;
        if (FECHA.test(c)) continue;
        if (/^nombre completo del prestador:?$/i.test(c)) {
          const nombre = cols[i + 1];
          if (nombre) out.prestadorNombre ??= nombre;
          break;
        }
        out.prestador ??= c;
      }
    }
  }
  return out;
}

/**
 * Repara texto UTF-8 que se decodificó como Latin-1 ("cardiologÃ­a"),
 * también si pasó dos veces por el error. Igual que `fixMojibake` de
 * viewer-normalize.js.
 */
export function fixMojibake(s: string): string {
  let actual = s;
  for (let i = 0; i < 3; i++) {
    const r = fixUnaVez(actual);
    if (r === actual) break;
    actual = r;
  }
  return actual;
}

function fixUnaVez(s: string): string {
  if (!/[ÃÂ][\u0080-¿]/.test(s)) return s;
  let soloLatin1 = true;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) {
      soloLatin1 = false;
      break;
    }
    bytes[i] = c;
  }
  if (soloLatin1) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // mezcla de texto bien y mal codificado: se reparan solo las secuencias
    }
  }
  return s.replace(/[Â-ß][\u0080-¿]/g, (par) =>
    String.fromCharCode(((par.charCodeAt(0) & 0x1f) << 6) | (par.charCodeAt(1) & 0x3f)),
  );
}
