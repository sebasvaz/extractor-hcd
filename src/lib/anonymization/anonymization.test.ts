/**
 * Tests del motor de anonimización.
 *
 * Cubre:
 *  - Reemplazo de identificadores directos (CI, tel UY, email).
 *  - Consistencia de tokens [TEL_N] / [EMAIL_N] entre documentos.
 *  - Preservación de contenido clínico fuera de los patrones.
 *  - Respeto de tags HTML (no reemplaza en atributos ni en `<pre id="b64">`).
 *  - Matching de nombre del paciente con tolerancia a tildes y orden.
 *  - Casos borde: cédula demasiado corta/larga, texto libre con números.
 */

import { describe, it, expect } from 'vitest';
import {
  createAnonymizer,
  normalizePatientName,
  buildPatientNameRegex,
  extractPatientNamesFromHtml,
  RE_CEDULA,
  RE_TEL_UY,
  RE_EMAIL,
} from './index';

describe('RE_EMAIL', () => {
  it('captura correos comunes', () => {
    const s = 'Contactar a juan.perez@asse.com.uy o a maria+test@gmail.com';
    const matches = s.match(RE_EMAIL) ?? [];
    expect(matches).toContain('juan.perez@asse.com.uy');
    expect(matches).toContain('maria+test@gmail.com');
  });

  it('no matchea cadenas sin TLD', () => {
    expect('foo@bar'.match(RE_EMAIL)).toBeNull();
  });
});

describe('RE_CEDULA', () => {
  const matches = (s: string): string[] => s.match(RE_CEDULA) ?? [];

  it('captura variantes habituales', () => {
    expect(matches('CI 1.234.567-8')).toEqual(expect.arrayContaining(['1.234.567-8']));
    expect(matches('cédula 12345678')).toEqual(expect.arrayContaining(['12345678']));
    expect(matches('doc 1234567')).toEqual(expect.arrayContaining(['1234567']));
    expect(matches('CI 1.234.567/8')).toEqual(expect.arrayContaining(['1.234.567/8']));
  });

  it('captura candidatos ambiguos — el filtro de longitud vive en applyText', () => {
    // Un número de 9 dígitos cae dentro del shape del patrón (7-8 dígitos
    // + opcional dígito extra). `applyTextReplacements` lo descarta luego
    // porque digits.length > 8. Acá solo validamos la captura del shape.
    const got = matches('ref 123456789');
    expect(got.length).toBeGreaterThan(0);
  });
});

describe('RE_TEL_UY', () => {
  const matches = (s: string): string[] => s.match(RE_TEL_UY) ?? [];

  it('captura móviles 09X XXX XXX', () => {
    expect(matches('llame al 099 123 456')).toEqual(['099 123 456']);
    expect(matches('099123456')).toEqual(['099123456']);
  });

  it('captura fijos 2XXX XXXX / 4XXX XXXX', () => {
    expect(matches('fijo 2487 1234')).toEqual(['2487 1234']);
    expect(matches('interior 4332 5566')).toEqual(['4332 5566']);
  });

  it('captura +598', () => {
    expect(matches('desde el exterior +598 99 123 456').join('|')).toContain('+598');
  });

  it('no matchea secuencias de dígitos que no son teléfono', () => {
    // Número de expediente, fecha iso, etc.
    expect(matches('ref 12345')).toEqual([]);
    expect(matches('2026-04-20')).toEqual([]);
  });
});

describe('normalizePatientName', () => {
  it('descarta nombres de una sola palabra', () => {
    expect(normalizePatientName('Juan')).toBe('');
  });

  it('normaliza tildes y case', () => {
    expect(normalizePatientName('Juán Pérez')).toBe('juan perez');
    expect(normalizePatientName('PÉREZ,  JUAN')).toBe('perez juan');
  });

  it('rechaza nombres solo con stopwords cortas', () => {
    expect(normalizePatientName('de la')).toBe('');
  });

  it('acepta nombres con conjunciones más nombre real', () => {
    expect(normalizePatientName('Juan de la Rosa')).toBe('juan de la rosa');
  });
});

describe('buildPatientNameRegex', () => {
  it('matchea nombre en orden directo y reverso', () => {
    const re = buildPatientNameRegex('juan perez');
    expect(re).not.toBeNull();
    expect(re!.test('JUAN PEREZ asistió')).toBe(true);
    re!.lastIndex = 0;
    expect(re!.test('paciente Perez Juan')).toBe(true);
  });

  it('es tolerante a tildes en el input', () => {
    const re = buildPatientNameRegex('juan perez');
    expect(re).not.toBeNull();
    expect(re!.test('Juán Pérez')).toBe(true);
  });

  it('no rompe palabras al usar \\b', () => {
    const re = buildPatientNameRegex('juan perez');
    expect(re).not.toBeNull();
    // "perezoso" no debe matchear
    expect(re!.test('juanperezoso')).toBe(false);
  });

  it('devuelve null con 1 sola parte', () => {
    expect(buildPatientNameRegex('juan')).toBeNull();
  });
});

describe('extractPatientNamesFromHtml', () => {
  it('extrae "Paciente: Juan Pérez"', () => {
    const html = '<p><strong>Paciente:</strong> Juan Pérez</p>';
    expect(extractPatientNamesFromHtml(html)).toEqual(['juan perez']);
  });

  it('extrae "Nombre del paciente: María Rodríguez"', () => {
    const html = '<div>Nombre del paciente: María Rodríguez</div>';
    expect(extractPatientNamesFromHtml(html)).toEqual(['maria rodriguez']);
  });

  it('ignora contenido embebido en base64', () => {
    const html = `
      <pre id="b64" style="display:none">Paciente: FALSO NOMBRE AQUI</pre>
      <p>Paciente: Real Perez</p>
    `;
    expect(extractPatientNamesFromHtml(html)).toEqual(['real perez']);
  });

  it('corta valores multi-campo (patrón: "Paciente: X   Prestador: Y")', () => {
    const html = '<td>Paciente: Juan Perez   Prestador: ASSE</td>';
    expect(extractPatientNamesFromHtml(html)).toContain('juan perez');
  });

  it('extrae nombre desde la estructura tabular real del portal HCD', () => {
    // Patrón observado en producción: el ':' entre etiqueta y valor está
    // implícito en la adyacencia de celdas, no en el texto. stripTagsForRead
    // debe restaurar ese separador para que el matcher funcione.
    const html = `
      <table>
        <tr>
          <td class="td_header_role_name"><span class="td_label">Nombre</span></td>
          <td class="td_header_role_value">SEBASTIA VAZQUEZ</td>
          <td class="td_header_role_name"><span class="td_label">Documento</span></td>
          <td class="td_header_role_value">4225368</td>
        </tr>
      </table>
    `;
    const names = extractPatientNamesFromHtml(html);
    expect(names).toContain('sebastia vazquez');
  });

  it('no se arrastra entre filas del portal: nombre de una fila, prestador de la siguiente', () => {
    const html = `
      <table>
        <tr>
          <td class="td_label">Nombre</td>
          <td>JUAN PEREZ</td>
        </tr>
        <tr>
          <td class="td_label">Prestador</td>
          <td>ASSE</td>
        </tr>
      </table>
    `;
    const names = extractPatientNamesFromHtml(html);
    expect(names).toEqual(['juan perez']);
  });
});

describe('createAnonymizer().apply — integración', () => {
  const SAMPLE_HTML = `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"></head>
    <body>
      <h1>Policlínica</h1>
      <p><strong>Paciente:</strong> Juan Pérez (CI: 1.234.567-8)</p>
      <p>Teléfono: 099 123 456 — email: juan.perez@asse.com.uy</p>
      <p>Fecha: 2026-04-15</p>
      <h2>Motivo de consulta</h2>
      <p>Dolor torácico de 2 horas de evolución. HTA conocida. Se indica
         electrocardiograma y laboratorio.</p>
      <p><strong>Profesional:</strong> Dra. María Rodríguez</p>
      <p>Consultas: 2487 1234</p>
    </body></html>
  `;

  it('reemplaza identificadores directos sin tocar el contenido clínico', () => {
    const a = createAnonymizer({ seedPatientNames: ['Juan Pérez'] });
    const out = a.apply(SAMPLE_HTML);
    // Identificadores ausentes
    expect(out).not.toContain('Juan Pérez');
    expect(out).not.toContain('1.234.567-8');
    expect(out).not.toContain('099 123 456');
    expect(out).not.toContain('juan.perez@asse.com.uy');
    expect(out).not.toContain('2487 1234');
    // Tokens presentes
    expect(out).toContain('[PACIENTE]');
    expect(out).toContain('[CI]');
    expect(out).toMatch(/\[TEL_\d+\]/);
    expect(out).toMatch(/\[EMAIL_\d+\]/);
    // Contenido clínico intacto
    expect(out).toContain('Dolor torácico');
    expect(out).toContain('HTA conocida');
    expect(out).toContain('electrocardiograma');
    // Profesional intacto (scope básico lo preserva)
    expect(out).toContain('Dra. María Rodríguez');
    // Fecha intacta
    expect(out).toContain('2026-04-15');
  });

  it('no modifica atributos dentro de tags', () => {
    const html = '<a href="mailto:foo@example.com">escribime</a>';
    const a = createAnonymizer();
    const out = a.apply(html);
    // El href contiene el email pero está DENTRO del tag — no se toca.
    expect(out).toContain('href="mailto:foo@example.com"');
  });

  it('mantiene consistencia de tokens entre documentos', () => {
    const a = createAnonymizer();
    const d1 = a.apply('<p>Tel: 099 111 222 — email: ana@x.com</p>');
    const d2 = a.apply('<p>De nuevo 099 111 222 y ana@x.com</p>');
    // Extraer tokens de d1 y verificar que d2 los reusa.
    const tel1 = /\[TEL_\d+\]/.exec(d1)?.[0];
    const email1 = /\[EMAIL_\d+\]/.exec(d1)?.[0];
    expect(tel1).toBeTruthy();
    expect(email1).toBeTruthy();
    expect(d2).toContain(tel1!);
    expect(d2).toContain(email1!);
  });

  it('enumera teléfonos distintos con tokens distintos', () => {
    const a = createAnonymizer();
    const out = a.apply('<p>Línea 1: 099 111 222. Línea 2: 099 333 444.</p>');
    expect(out).toMatch(/\[TEL_1\]/);
    expect(out).toMatch(/\[TEL_2\]/);
  });

  it('no toca el contenido de <pre id="b64"> (PDF embebido)', () => {
    const html =
      '<p>Paciente: Juan Perez</p><pre id="b64">JVBERi0xLjQKJeLjz9MKMSAw</pre>';
    const a = createAnonymizer({ seedPatientNames: ['Juan Perez'] });
    const out = a.apply(html);
    expect(out).toContain('<pre id="b64">JVBERi0xLjQKJeLjz9MKMSAw</pre>');
    // Fuera del pre sí se aplica
    expect(out).toContain('[PACIENTE]');
  });

  it('es idempotente: re-aplicar no introduce cambios', () => {
    const a = createAnonymizer({ seedPatientNames: ['Juan Perez'] });
    const once = a.apply(SAMPLE_HTML);
    const twice = a.apply(once);
    expect(twice).toBe(once);
  });

  it('stats() reporta contadores coherentes', () => {
    const a = createAnonymizer({ seedPatientNames: ['Juan Perez'] });
    a.apply(
      '<p>CI 1.234.567-8 tel 099 111 222 email a@b.com. Otro 2487 1234 y c@d.com.</p>',
    );
    const s = a.stats();
    expect(s.emails).toBe(2);
    expect(s.telephones).toBe(2);
    expect(s.cedulas).toBeGreaterThanOrEqual(1);
    expect(s.patientNames).toContain('juan perez');
  });

  it('regresión portal real: anonimiza SIN seed cuando el nombre viene en celdas', () => {
    // Reproducción del bug 2026-04-20: el portal pone el nombre en la
    // estructura tabular "<td>Nombre</td><td>VALOR</td>" y el anonymizer
    // quedaba sin detectarlo. Con el fix de stripTagsForRead el extractor
    // lo infiere desde el propio HTML — sin necesidad de pasar seed.
    const a = createAnonymizer(); // ← sin seedPatientNames
    const portalHtml = `
      <html><body>
        <table>
          <tr>
            <td class="td_header_role_name"><span class="td_label">Nombre</span></td>
            <td class="td_header_role_value">SEBASTIA VAZQUEZ</td>
            <td class="td_header_role_name"><span class="td_label">Documento</span></td>
            <td class="td_header_role_value">4225368</td>
          </tr>
        </table>
        <p>Consulta por dolor lumbar. Paciente SEBASTIA VAZQUEZ refiere evolución estable.</p>
      </body></html>
    `;
    const out = a.apply(portalHtml);
    expect(out).not.toContain('SEBASTIA VAZQUEZ');
    expect(out).toContain('[PACIENTE]');
    expect(out).toContain('[CI]'); // la CI 4225368 (7 dígitos) también
    // El texto clínico se preserva (excepto el nombre, ya tokenizado).
    expect(out).toContain('dolor lumbar');
    expect(out).toContain('evolución estable');
    // Stats lo reportan
    const s = a.stats();
    expect(s.patientNames).toContain('sebastia vazquez');
  });
});
