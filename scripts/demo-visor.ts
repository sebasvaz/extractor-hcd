/**
 * Genera un ZIP de demostración con datos FICTICIOS para probar visor.html.
 * Uso: npx vite-node scripts/demo-visor.ts <carpeta-salida>
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import type { CapturedDocument, CaptureError } from '../src/lib/messaging/types';
import { buildZip } from '../src/lib/zip-builder';

const out = process.argv[2] ?? 'samples/out/demo-visor';

const PRESTADORES = ['ASSE', 'CASMU', 'Médica Uruguaya', 'Hospital Británico'];
const PROFESIONALES = ['Dra. Ana Rodríguez', 'Dr. Martín Silva', 'Dra. Lucía Fernández', 'Dr. Pablo Gómez'];
const EVENTOS: Array<[string, string, string, string]> = [
  ['2019-03-12', 'Policlínica', 'Control de hipertensión arterial', 'Paciente con HTA en tratamiento con enalapril 10 mg cada 12 horas. PA 135/85. Se mantiene tratamiento.'],
  ['2019-11-02', 'Vacunas', 'Vacuna antigripal', 'Se administra vacuna antigripal temporada 2019, dosis única, deltoides izquierdo.'],
  ['2020-06-21', 'Urgencia y emergencia', 'Dolor abdominal', 'Consulta por dolor en fosa ilíaca derecha de 12 horas de evolución. Ecografía sin hallazgos. Alta con analgesia.'],
  ['2021-05-08', 'Vacunas', 'Vacuna COVID-19 primera dosis', 'Se administra vacuna COVID-19 Pfizer-BioNTech, primera dosis.'],
  ['2021-06-05', 'Vacunas', 'Vacuna COVID-19 segunda dosis', 'Se administra vacuna COVID-19 Pfizer-BioNTech, segunda dosis.'],
  ['2022-02-14', 'Imagenología', 'Radiografía de tórax', 'Radiografía de tórax frente: sin alteraciones pleuropulmonares. Índice cardiotorácico normal.'],
  ['2022-09-30', 'Policlínica', 'Control de diabetes tipo 2', 'Diabetes mellitus tipo 2 diagnosticada en 2022. Hemoglobina glicosilada 7,4 %. Se inicia metformina 850 mg.'],
  ['2023-01-18', 'Internación', 'Neumonía aguda de la comunidad', 'Ingreso por neumonía de lóbulo inferior derecho. Tratamiento con ceftriaxona. Alta al quinto día en buen estado.'],
  ['2023-04-03', 'Procedimientos médicos', 'Endoscopía digestiva alta', 'Gastritis crónica antral leve. Se toma biopsia para Helicobacter pylori.'],
  ['2024-07-22', 'Teleconsulta', 'Seguimiento de diabetes', 'Glucemias en ayunas entre 110 y 130 mg/dL. Buena adherencia a metformina. Alergia conocida a penicilina.'],
  ['2025-03-10', 'Procedimientos quirúrgicos', 'Colecistectomía laparoscópica', 'Colecistectomía laparoscópica sin complicaciones. Anatomía patológica: colecistitis crónica litiásica.'],
  ['2026-08-19', 'Policlínica', 'Control anual', 'Control anual. PA 128/80. Hemoglobina 13,8 g/dL. Se solicita perfil lipídico.'],
];

const VACUNAS = `<h2>HISTORIAL DE VACUNAS</h2>
<ul><li><h3>COVID 19 - PFIZER-BIONTECH</h3></li></ul>
<ul><ul><li>Fecha: 2021-05-08 00:00:00</li><li>Número de dosis: 1</li><li>Vía de administración: inyectable</li><li>Vacunatorio: Vacunatorio Ficticio Centro</li></ul><br>
<ul><li>Fecha: 2021-06-05 00:00:00</li><li>Número de dosis: 2</li><li>Vía de administración: inyectable</li><li>Vacunatorio: Vacunatorio Ficticio Centro</li></ul><br></ul>
<ul><li><h3>ANTIGRIPAL 2019</h3></li></ul>
<ul><ul><li>Fecha: 2019-11-02 00:00:00</li><li>Número de dosis: 1</li><li>Vía de administración: inyectable</li><li>Vacunatorio: Policlínica Ficticia Norte</li></ul><br></ul>
<hr>`;

function i2med(desc: string): string {
  if (/diabetes/i.test(desc)) return 'METFORMINA 850 MG COMPRIMIDOS';
  if (/hipertensi/i.test(desc)) return 'ENALAPRIL 10 MG COMPRIMIDOS';
  return 'PARACETAMOL 500 MG COMPRIMIDOS';
}

function cdaHtml(fecha: string, cat: string, desc: string, body: string, prest: string, prof: string, withScript: boolean): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${desc}</title>
<style>body{font-family:Arial,sans-serif;margin:16px}table{border-collapse:collapse}td{padding:3px 8px}.td_label{font-weight:bold}h2{color:#1d4f91}</style>
${withScript ? '<script>document.title="SCRIPT EJECUTADO";document.addEventListener("DOMContentLoaded",function(){document.body.style.background="red"})</script>' : ''}
</head><body>
<h2>${cat} — ${desc}</h2>
<table><tr><td><span class="td_label">Paciente</span></td><td>[PACIENTE]</td></tr>
<tr><td><span class="td_label">Documento</span></td><td>[ID]</td></tr>
<tr><td><span class="td_label">Fecha</span></td><td>${fecha}</td></tr>
<tr><td><span class="td_label">Prestador</span></td><td>${prest}</td></tr>
<tr><td><span class="td_label">Profesional</span></td><td>${prof}</td></tr></table>
<h3>Motivo / Evolución</h3><p>${body}</p>
<h3>Diagnósticos</h3><div><table><tr><td>Diagnóstico</td><td>Estado</td></tr><tr><td>${desc.toUpperCase()}</td><td>Activo</td></tr></table></div>
${cat === 'Policlínica' || cat === 'Teleconsulta' ? `<h3>Tratamiento farmacológico indicado al final de la asistencia</h3><div><ul><li>Fármaco: ${i2med(desc)}</li><li>Vía de administración: ORAL</li><li>Observaciones relevantes:</li></ul></div>` : ''}
${cat === 'Vacunas' ? VACUNAS : ''}
</body></html>`;
}

async function pdfBase64(): Promise<string> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = ['LABORATORIO - DATOS FICTICIOS', '', 'Hemograma completo', 'Hemoglobina 13.5 g/dL (12-16)',
    'Leucocitos 6.800 /mm3 (4.000-10.000)', 'Plaquetas 245.000 /mm3', '', 'Glucemia 98 mg/dL (70-110)',
    'Colesterol total 212 mg/dL (< 200)'];
  lines.forEach((t, i) => page.drawText(t, { x: 60, y: 760 - i * 22, size: 13, font }));
  return Buffer.from(await pdf.save()).toString('base64');
}

async function main(): Promise<void> {
  const docs: CapturedDocument[] = EVENTOS.map(([fecha, cat, desc, body], i) => {
    const prest = PRESTADORES[i % PRESTADORES.length]!;
    const prof = PROFESIONALES[i % PROFESIONALES.length]!;
    const id = `${fecha}_${cat.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}_${i}`;
    return {
      id, categoria: cat, fecha, prestador: prest, profesional: prof, descripcion: desc,
      visualizarUrl: 'https://example.test/v', captureUrl: 'https://example.test/c',
      capturedAt: '2026-10-03T12:00:00.000Z', sha256: '0'.repeat(64),
      html: cdaHtml(fecha, cat, desc, body, prest, prof, i === 0),
    };
  });
  docs.push({
    id: '2026-08-12_laboratorio_hemograma', categoria: 'Laboratorio', fecha: '2026-08-12',
    prestador: 'CASMU', descripcion: 'Hemograma y bioquímica', visualizarUrl: 'https://example.test/v',
    captureUrl: 'https://example.test/c', capturedAt: '2026-10-03T12:00:00.000Z', sha256: '0'.repeat(64),
    html: '<!DOCTYPE html><html><body>portada</body></html>',
    attachmentBase64: await pdfBase64(), attachmentMime: 'application/pdf',
  });
  const errors: CaptureError[] = [
    { meta: { categoria: 'Laboratorio', fecha: '2024-02-01', descripcion: 'Perfil lipídico' }, message: 'timeout', occurredAt: '2026-10-03T12:00:00.000Z' },
  ];
  const sha = (b: string | Buffer): string => createHash('sha256').update(b).digest('hex');
  for (const d of docs) {
    d.sha256 = sha(d.html);
    if (d.attachmentBase64) d.attachmentSha256 = sha(Buffer.from(d.attachmentBase64, 'base64'));
  }
  const { blob, filename } = await buildZip({
    patient: { displayName: 'Paciente Ficticio' }, expected: docs.length + errors.length,
    documents: docs, errors, log: [], startedAt: '2026-10-03T11:50:00.000Z', anonymized: true,
  });
  mkdirSync(out, { recursive: true });
  const buf = Buffer.from(await blob.arrayBuffer());
  writeFileSync(join(out, filename), buf);
  const zip = await JSZip.loadAsync(buf);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    mkdirSync(join(out, 'extraido', name, '..'), { recursive: true });
    writeFileSync(join(out, 'extraido', name), await entry.async('nodebuffer'));
  }
  console.log(join(out, filename));
}

void main();
