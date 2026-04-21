/**
 * Slugify y helpers de nomenclatura de archivos.
 *
 * Alineado a la Especificación Técnica v1.0, §8.3:
 *  - Minúsculas.
 *  - NFD + remoción de combining marks (tildes).
 *  - Reemplazo de no-[a-z0-9] por guion medio. Colapso de guiones.
 *  - Truncado a 80 chars (límite path Windows).
 *  - Sufijo -2/-3/... ante colisiones.
 */

const MAX_LEN = 80;

export function slugify(input: string): string {
  if (!input) return '';
  const decomposed = input.normalize('NFD');
  const stripped = decomposed.replace(/[\u0300-\u036f]/g, ''); // combining marks
  const lower = stripped.toLowerCase();
  const replaced = lower.replace(/[^a-z0-9]+/g, '-');
  const collapsed = replaced.replace(/^-+|-+$/g, '');
  return collapsed.slice(0, MAX_LEN);
}

/**
 * Resuelve colisiones de slugs sufijando con -2, -3, ...
 *
 * Recibe y mantiene un Set de slugs ya usados. El slug base truncado a 80
 * chars se respeta; los sufijos se adosan sin respetar el límite (OK en
 * todos los FS modernos).
 */
export function uniqueSlug(base: string, seen: Set<string>): string {
  const cleaned = base || 'evento';
  if (!seen.has(cleaned)) {
    seen.add(cleaned);
    return cleaned;
  }
  let n = 2;
  while (seen.has(`${cleaned}-${n}`)) n += 1;
  const result = `${cleaned}-${n}`;
  seen.add(result);
  return result;
}

/**
 * Nombre de archivo por evento: <fecha>_<categoria>_<descripcion>.html
 * Recibe fecha en ISO yyyy-mm-dd.
 */
export function eventFileName(parts: {
  fechaIso: string;
  categoria: string;
  descripcion: string | undefined;
  seen: Set<string>;
}): { id: string; filePath: string } {
  const base = [parts.fechaIso, slugify(parts.categoria), slugify(parts.descripcion ?? 'sin-descripcion')]
    .filter(Boolean)
    .join('_');
  const id = uniqueSlug(base, parts.seen);
  return { id, filePath: `docs/${id}.html` };
}

/**
 * Nombre de archivo para el ZIP global.
 * Patrón spec §8.1: hcd_export_<nombre>_<yyyy-mm-dd_hhmm>.zip
 */
export function zipFileName(patientSlug: string, when = new Date()): string {
  const yyyy = when.getFullYear();
  const mm = String(when.getMonth() + 1).padStart(2, '0');
  const dd = String(when.getDate()).padStart(2, '0');
  const hh = String(when.getHours()).padStart(2, '0');
  const mi = String(when.getMinutes()).padStart(2, '0');
  const slug = slugify(patientSlug) || 'paciente';
  return `hcd_export_${slug}_${yyyy}-${mm}-${dd}_${hh}${mi}.zip`;
}
