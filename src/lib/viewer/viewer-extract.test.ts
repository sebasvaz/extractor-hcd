// @vitest-environment happy-dom
/**
 * Tests de viewer-extract.js con HTML sintético que replica las estructuras
 * reales de los documentos de Mi HCD (ver docs/PLAN_VISOR.md, fase 5).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import extractSrc from './viewer-extract.js?raw';

type Extracted = {
  text: string;
  cda: Record<string, string>;
  vacunas: Array<Record<string, string>>;
  diagnosticos: string[];
  medicamentos: string[];
};
let extract: (html: string) => Extracted;

beforeAll(() => {
  new Function(extractSrc)();
  extract = (window as unknown as { HCDExtract: { extract: typeof extract } }).HCDExtract.extract;
});

const CABEZAL = `<title>Consulta no urgente</title>
<table>
<tr><td><span class="td_label">Nombre</span></td><td>[PACIENTE]</td></tr>
<tr><td><span class="td_label">Fecha de nacimiento</span></td><td>Enero 1, 1950</td></tr>
<tr><td><span class="td_label">Sexo</span></td><td>Femenino</td></tr>
<tr><td><span class="td_label">Prestador</span></td><td>Hospital Central</td></tr>
<tr><td><span class="td_label">Profesional</span></td><td>ANA GÓMEZ</td></tr>
<tr><td><span class="td_label">Fecha del evento</span></td><td>Marzo 23, 2026, 09:45:00</td></tr>
</table>`;

const page = (body: string): string => `<!DOCTYPE html><html><head>${CABEZAL.split('\n')[0]}</head><body>${CABEZAL.split('\n').slice(1).join('\n')}${body}</body></html>`;

describe('cabezal y texto', () => {
  it('lee título, prestador, profesional y fecha del evento', () => {
    const r = extract(page('<p>Control.</p>'));
    expect(r.cda).toEqual({
      titulo: 'Consulta no urgente',
      prestador: 'Hospital Central',
      profesional: 'ANA GÓMEZ',
      fechaHora: 'Marzo 23, 2026, 09:45:00',
    });
  });

  it('nunca lee los datos del paciente en el cabezal', () => {
    expect(JSON.stringify(extract(page('')).cda)).not.toMatch(/PACIENTE|1950|Femenino/);
  });

  it('el texto de búsqueda no incluye scripts ni el base64 de un PDF', () => {
    const r = extract(page('<script>var secreto = 1;</script><pre id="b64">JVBERi0xLjQK</pre><p>Hemoglobina 13,2</p>'));
    expect(r.text).toContain('Hemoglobina 13,2');
    expect(r.text).not.toMatch(/secreto|JVBERi/);
  });
});

describe('vacunas', () => {
  const HIST = `<h2>HISTORIAL DE VACUNAS</h2>
<ul><li><h3>ANTIGRIPAL 2026</h3></li></ul>
<ul><ul><li>Fecha: 2026-04-27 00:00:00</li><li>Número de dosis: 1</li><li>Vía de administración: inyectable</li><li>Vacunatorio: Vacunatorio Central</li></ul><br></ul>
<ul><li><h3>COVID 19</h3></li></ul>
<ul><ul><li>Fecha: 2021-05-08 00:00:00</li><li>Número de dosis: 1</li><li>Vía de administración: inyectable</li><li>Vacunatorio: Centro A</li></ul><br>
<ul><li>Fecha: 2021-06-05 00:00:00</li><li>Número de dosis: 2</li><li>Vía de administración: inyectable</li><li>Vacunatorio: Centro A</li></ul><br></ul>
<hr>`;

  it('saca cada dosis con vacuna, fecha, dosis, vía y vacunatorio', () => {
    const r = extract(page(HIST));
    expect(r.vacunas).toEqual([
      { vacuna: 'ANTIGRIPAL 2026', fecha: '2026-04-27', dosis: '1', via: 'inyectable', vacunatorio: 'Vacunatorio Central' },
      { vacuna: 'COVID 19', fecha: '2021-05-08', dosis: '1', via: 'inyectable', vacunatorio: 'Centro A' },
      { vacuna: 'COVID 19', fecha: '2021-06-05', dosis: '2', via: 'inyectable', vacunatorio: 'Centro A' },
    ]);
  });
});

describe('diagnósticos', () => {
  it('tabla con encabezado: toma la primera columna y saltea el encabezado', () => {
    const r = extract(page(`<h3><a>Diagnósticos</a></h3><div><table>
<tr><td>Diagnóstico</td><td>Estado</td><td>Severidad</td><td>Fecha inicio</td></tr>
<tr><td>Clasificación: No</td><td></td><td></td><td></td></tr>
<tr><td>HIPERTENSION ARTERIAL</td><td>Activo</td><td>Leve</td><td>01/02/24</td></tr>
</table></div><h3>Otra sección</h3>`));
    expect(r.diagnosticos).toEqual(['HIPERTENSION ARTERIAL']);
  });

  it('tabla de dos columnas con encabezado no se confunde con clave-valor', () => {
    const r = extract(page(`<h3><a>Diagnósticos</a></h3><div><table>
<tr><td>Diagnóstico</td><td>Estado</td></tr><tr><td>ASMA BRONQUIAL</td><td>Activo</td></tr></table></div>`));
    expect(r.diagnosticos).toEqual(['ASMA BRONQUIAL']);
  });

  it('tabla clave-valor: toma el valor de la descripción', () => {
    const r = extract(page(`<h3><a>Diagnósticos</a></h3><div><table>
<tr><td>Descripción del diagnóstico</td><td>control de salud</td></tr>
<tr><td>Fecha de inicio</td><td>[ID]</td></tr>
</table></div>`));
    expect(r.diagnosticos).toEqual(['control de salud']);
  });

  it('lista con rótulo: quita "DIAGNÓSTICO PRINCIPAL::"', () => {
    const r = extract(page(`<h3><a>Diagnósticos</a></h3><div><ul><li>DIAGNÓSTICO PRINCIPAL:: Rinitis alérgica.</li></ul></div>`));
    expect(r.diagnosticos).toEqual(['Rinitis alérgica']);
  });

  it('acepta el título con la codificación rota', () => {
    const r = extract(page(`<h3><a>Diagn�sticos</a></h3><div><ul><li>Asma</li></ul></div>`));
    expect(r.diagnosticos).toEqual(['Asma']);
  });

  it('no confunde "Diagnósticos de complicaciones" con diagnósticos', () => {
    const r = extract(page(`<h3><a>Diagnósticos de complicaciones</a></h3><div><ul><li>Ninguna complicación</li></ul></div>`));
    expect(r.diagnosticos).toEqual([]);
  });
});

describe('medicamentos', () => {
  it('lista "Clave: valor": se queda con el fármaco y descarta el resto', () => {
    const r = extract(page(`<h3><a>Tratamiento farmacológico indicado al final de la asistencia</a></h3><div><ul>
<li>Fármaco: AMOXICILINA 500 MG COMPRIMIDOS</li><li>Vía de administración: ORAL</li><li>Dosis: 1 COMPRIMIDO</li>
<li>Observaciones relevantes:</li></ul></div>`));
    expect(r.medicamentos).toEqual(['AMOXICILINA 500 MG COMPRIMIDOS']);
  });

  it('tabla de prescripción: saltea filas de <th> aunque no vayan primeras', () => {
    const r = extract(page(`<h3><a>Prescripciones de Medicamentos</a></h3><div><table>
<tr><td colspan="6">TRATAMIENTO CRÓNICO</td></tr>
<tr><th>Fármaco</th><th>Vía</th><th>Dosis</th><th>Observaciones relevantes</th></tr>
<tr><td>ENALAPRIL 10 MG</td><td>ORAL</td><td>1</td><td>Cantidad: 1</td></tr>
</table></div>`));
    expect(r.medicamentos).toEqual(['TRATAMIENTO CRÓNICO', 'ENALAPRIL 10 MG']);
  });

  it('descarta indicaciones en texto libre', () => {
    const r = extract(page(`<h3><a>Prescripciones de Medicamentos</a></h3><div><ul>
<li>Repetir tto de 10 días por 3 meses</li><li>Ibuprofeno 400 mg</li></ul></div>`));
    expect(r.medicamentos).toEqual(['Ibuprofeno 400 mg']);
  });

  it('limpia los puntos de campos vacíos', () => {
    const r = extract(page(`<h3><a>Diagnósticos</a></h3><div><ul><li>. . queratosis</li><li>OTITIS. . Otitis media</li></ul></div>`));
    expect(r.diagnosticos).toEqual(['queratosis', 'OTITIS · Otitis media']);
  });

  it('corta la presentación pegada al nombre', () => {
    const r = extract(page(`<h3><a>Prescripciones de Medicamentos</a></h3><div><ul>
<li>METFORMINA 850 MG COMPRIMIDO Pre.: METFORMINA 850 MG Vía de administración: Oral</li></ul></div>`));
    expect(r.medicamentos).toEqual(['METFORMINA 850 MG COMPRIMIDO']);
  });
});
