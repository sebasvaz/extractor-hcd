/**
 * Tests de viewer-ips.js: lectura del Resumen del Paciente (Bundle FHIR).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import ipsSrc from './viewer-ips.js?raw';

type Ips = { leer(b: unknown): { titulo: string; fecha: string; autor: string; secciones: Array<{ titulo: string; items: Array<Record<string, unknown>> }> } };
let I: Ips;
beforeAll(() => {
  new Function(ipsSrc)();
  I = (globalThis as unknown as { HCDIps: Ips }).HCDIps;
});

const bundle = {
  resourceType: 'Bundle',
  type: 'document',
  entry: [
    { fullUrl: 'urn:uuid:comp', resource: { resourceType: 'Composition', title: 'Resumen del Paciente', date: '2026-05-20T10:00:00Z',
      author: [{ display: 'Plataforma IPS' }],
      section: [
        { title: 'Lista de problemas', entry: [{ reference: 'Condition/c1' }] },
        { title: 'Medicación', entry: [{ reference: 'urn:uuid:m1' }] },
        { title: 'Resultados', entry: [{ reference: 'Observation/o1' }, { reference: 'Observation/no-existe' }] },
        { title: 'Inmunizaciones', entry: [{ reference: 'Immunization/i1' }] },
      ] } },
    { resource: { resourceType: 'Condition', id: 'c1', code: { text: 'Hipertensión arterial' }, onsetDateTime: '2019-03-12',
      clinicalStatus: { coding: [{ code: 'active' }] } } },
    { fullUrl: 'urn:uuid:m1', resource: { resourceType: 'MedicationStatement', id: 'm1', status: 'active',
      medicationCodeableConcept: { coding: [{ display: 'Enalapril 10 mg' }] }, dosage: [{ text: 'Cada 12 horas' }] } },
    { resource: { resourceType: 'Observation', id: 'o1', code: { text: 'Glucemia' }, effectiveDateTime: '2026-08-12T08:00:00Z',
      valueQuantity: { value: 98, unit: 'mg/dL' }, referenceRange: [{ low: { value: 70, unit: 'mg/dL' }, high: { value: 110, unit: 'mg/dL' } }] } },
    { resource: { resourceType: 'Immunization', id: 'i1', vaccineCode: { text: 'ANTIGRIPAL 2026' }, occurrenceDateTime: '2026-04-27',
      protocolApplied: [{ doseNumberString: '1' }] } },
  ],
};

describe('leer', () => {
  it('arma las secciones en el orden de la Composition, resolviendo referencias', () => {
    const r = I.leer(bundle);
    expect(r).toMatchObject({ titulo: 'Resumen del Paciente', fecha: '2026-05-20', autor: 'Plataforma IPS' });
    expect(r.secciones.map((s) => s.titulo)).toEqual(['Lista de problemas', 'Medicación', 'Resultados', 'Inmunizaciones']);
    expect(r.secciones[0]!.items[0]).toMatchObject({ nombre: 'Hipertensión arterial', fecha: '2019-03-12', estado: 'Activo' });
    expect(r.secciones[1]!.items[0]).toMatchObject({ nombre: 'Enalapril 10 mg', detalle: ['Cada 12 horas'] });
    expect(r.secciones[2]!.items).toHaveLength(1);
    expect(r.secciones[2]!.items[0]).toMatchObject({ nombre: 'Glucemia', fecha: '2026-08-12', detalle: ['98 mg/dL', 'Referencia: 70 – 110 mg/dL'] });
    expect(r.secciones[3]!.items[0]).toMatchObject({ nombre: 'ANTIGRIPAL 2026', detalle: ['Dosis 1'] });
  });

  it('resuelve dispositivos contenidos y valores en componentes', () => {
    const b = {
      resourceType: 'Bundle',
      entry: [
        { resource: { resourceType: 'Composition', section: [{ title: 'Dispositivos', entry: [{ reference: 'DeviceUseStatement/d1' }] },
          { title: 'Signos vitales', entry: [{ reference: 'Observation/pa' }] }] } },
        { resource: { resourceType: 'DeviceUseStatement', id: 'd1', device: { reference: '#dev' },
          contained: [{ resourceType: 'Device', id: 'dev', type: { text: 'Glucómetro' } }] } },
        { resource: { resourceType: 'Observation', id: 'pa', code: { text: 'Presión arterial' },
          component: [{ valueQuantity: { value: 128, unit: 'mmHg' } }, { valueQuantity: { value: 80, unit: 'mmHg' } }] } },
      ],
    };
    const r = I.leer(b);
    expect(r.secciones[0]!.items[0]!.nombre).toBe('Glucómetro');
    expect(r.secciones[1]!.items[0]!.detalle).toEqual(['128/80 mmHg']);
  });

  it('rechaza archivos que no son un IPS', () => {
    expect(() => I.leer({ resourceType: 'Patient' })).toThrow(/no es un Resumen del Paciente/);
    expect(() => I.leer({ resourceType: 'Bundle', entry: [] })).toThrow(/Composition/);
  });
});
