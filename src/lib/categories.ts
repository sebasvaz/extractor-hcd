/**
 * Categorías conocidas de eventos asistenciales en Mi HCD.
 * Extraídas de la Especificación Técnica v1.0, Anexo B.
 *
 * Se usan para filtrar los anchors `a[data-gx-evt="5"]` descartando los que
 * corresponden a paginación u otros controles GeneXus.
 */

export const CATEGORIAS = [
  'Imagenología',
  'Internación',
  'Laboratorio',
  'Policlínica',
  'Procedimientos médicos',
  'Procedimientos quirúrgicos',
  'Urgencia y emergencia',
  'Vacunas',
  'Teleconsulta',
  'Otros',
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

const CATEGORIAS_SET = new Set<string>(CATEGORIAS);

export function isCategoria(value: string): value is Categoria {
  return CATEGORIAS_SET.has(value.trim());
}
