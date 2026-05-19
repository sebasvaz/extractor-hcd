/**
 * Tests para src/lib/zip-builder.ts.
 * Validan shape del metadata.json contra el JSON Schema del Anexo A (v1.0).
 *
 * NOTA: no importamos un validador de JSON Schema (AJV) para no pesar el
 * entorno de test. En lugar de eso validamos manualmente los campos clave:
 *  - schemaVersion "1.0"
 *  - exportId UUID v4
 *  - totals {expected, captured, failed}
 *  - documents[] con todos los campos obligatorios
 *  - errors[]
 */

import { describe, expect, it } from 'vitest';

import type { CapturedDocument, CaptureError, LogEntry } from './messaging/types';
import { buildMetadata, SCHEMA_VERSION } from './zip-builder';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeDoc(overrides: Partial<CapturedDocument> = {}): CapturedDocument {
  return {
    id: '2026-04-15_policlinica_consulta',
    categoria: 'Policlínica',
    fecha: '2026-04-15',
    prestador: 'ASSE',
    profesional: 'Dra. X',
    descripcion: 'Consulta',
    visualizarUrl: 'https://historiaclinicadigital.gub.uy/mihcd/servlet/com.mihcd.visualizarcda?x=1',
    captureUrl: 'https://historiaclinicadigital.gub.uy/mihcd/servlet/com.mihcd.aopencdasesion?y=2',
    capturedAt: '2026-04-15T12:00:00.000Z',
    html: '<!DOCTYPE html><html><body>foo</body></html>',
    sha256: '0'.repeat(64),
    ...overrides,
  };
}

function makeError(overrides: Partial<CaptureError> = {}): CaptureError {
  return {
    meta: { categoria: 'Laboratorio', fecha: '2026-03-01' },
    message: 'timeout',
    occurredAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

const emptyLog: LogEntry[] = [];

describe('buildMetadata', () => {
  it('tiene schemaVersion "1.0" y exportId UUID v4', () => {
    const meta = buildMetadata({
      patient: { displayName: 'Juan Pérez' },
      expected: 1,
      documents: [makeDoc()],
      errors: [],
      log: emptyLog,
      startedAt: '2026-04-15T11:55:00.000Z',
    });
    expect(meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(meta.schemaVersion).toBe('1.0');
    expect(meta.exportId).toMatch(UUID_V4_RE);
  });

  it('totals refleja expected/captured/failed', () => {
    const meta = buildMetadata({
      patient: { displayName: 'X' },
      expected: 10,
      documents: [makeDoc(), makeDoc({ id: 'otro' })],
      errors: [makeError(), makeError()],
      log: emptyLog,
      startedAt: '2026-04-15T11:00:00.000Z',
    });
    expect(meta.totals).toEqual({ expected: 10, captured: 2, failed: 2 });
  });

  it('cada documento lleva file = "docs/<id>.html" y campos obligatorios', () => {
    const doc = makeDoc({ id: '2026-04-15_vacunas_covid' });
    const meta = buildMetadata({
      patient: { displayName: 'X' },
      expected: 1,
      documents: [doc],
      errors: [],
      log: emptyLog,
      startedAt: '2026-04-15T11:55:00.000Z',
    });
    const m0 = meta.documents[0]!;
    expect(m0.file).toBe('docs/2026-04-15_vacunas_covid.html');
    expect(m0.id).toBe('2026-04-15_vacunas_covid');
    expect(m0.categoria).toBe('Policlínica');
    expect(m0.fecha).toBe('2026-04-15');
    expect(m0.sha256).toHaveLength(64);
    expect(typeof m0.capturedAt).toBe('string');
    expect(m0.visualizarUrl.startsWith('https://historiaclinicadigital.gub.uy')).toBe(true);
  });

  it('omite campos opcionales ausentes sin escribir undefined', () => {
    const doc = makeDoc();
    // borramos los opcionales tipando como any para evitar exactOptionalPropertyTypes
    delete (doc as { prestador?: unknown }).prestador;
    delete (doc as { profesional?: unknown }).profesional;
    delete (doc as { descripcion?: unknown }).descripcion;

    const meta = buildMetadata({
      patient: { displayName: 'X' },
      expected: 1,
      documents: [doc],
      errors: [],
      log: emptyLog,
      startedAt: '2026-04-15T11:55:00.000Z',
    });
    const m0 = meta.documents[0]!;
    expect('prestador' in m0).toBe(false);
    expect('profesional' in m0).toBe(false);
    expect('descripcion' in m0).toBe(false);
    // JSON-round-trip: no debe haber `undefined` en el serializado.
    const json = JSON.stringify(meta);
    expect(json).not.toContain(': undefined');
    expect(json).not.toContain('"prestador":null');
  });

  it('errors[] incluye meta y mensaje y se emiten campos opcionales solo si existen', () => {
    const meta = buildMetadata({
      patient: { displayName: 'X' },
      expected: 1,
      documents: [],
      errors: [makeError({ url: 'https://historiaclinicadigital.gub.uy/mihcd/foo' })],
      log: emptyLog,
      startedAt: '2026-04-15T11:55:00.000Z',
    });
    const e0 = meta.errors[0]!;
    expect(e0.message).toBe('timeout');
    expect(e0.url).toContain('mihcd');
    expect(e0.categoria).toBe('Laboratorio');
  });

  it('patient.displayName se respeta; documentHash solo si se pasó', () => {
    const metaA = buildMetadata({
      patient: { displayName: 'Juan Pérez' },
      expected: 0,
      documents: [],
      errors: [],
      log: emptyLog,
      startedAt: '2026-04-15T11:55:00.000Z',
    });
    expect(metaA.patient.displayName).toBe('Juan Pérez');
    expect('documentHash' in metaA.patient).toBe(false);

    const metaB = buildMetadata({
      patient: { displayName: 'Juan Pérez', documentHash: 'abc123' },
      expected: 0,
      documents: [],
      errors: [],
      log: emptyLog,
      startedAt: '2026-04-15T11:55:00.000Z',
    });
    expect(metaB.patient.documentHash).toBe('abc123');
  });

  it('source apunta al portal correcto (spec §8)', () => {
    const meta = buildMetadata({
      patient: { displayName: 'X' },
      expected: 0,
      documents: [],
      errors: [],
      log: emptyLog,
      startedAt: '2026-04-15T11:55:00.000Z',
    });
    expect(meta.source.baseUrl).toBe('https://historiaclinicadigital.gub.uy');
    expect(meta.source.portal).toMatch(/Mi HCD/);
  });

  it('no emite campos de anonimización cuando la corrida no es anonimizada', () => {
    const meta = buildMetadata({
      patient: { displayName: 'X' },
      expected: 0,
      documents: [],
      errors: [],
      log: emptyLog,
      startedAt: '2026-04-15T11:55:00.000Z',
    });
    expect('anonymized' in meta).toBe(false);
    expect('anonymizationScope' in meta).toBe(false);
  });

  it('emite anonymized=true y scope=basic cuando la corrida es anonimizada', () => {
    const meta = buildMetadata({
      patient: { displayName: 'X' },
      expected: 1,
      documents: [makeDoc()],
      errors: [],
      log: emptyLog,
      startedAt: '2026-04-15T11:55:00.000Z',
      anonymized: true,
      anonymizationScope: 'basic',
    });
    expect(meta.anonymized).toBe(true);
    expect(meta.anonymizationScope).toBe('basic');
  });

  // ADR-003: el marcador formal `anonymization` se emite con toda la
  // info que el backend usa para distinguir HCDs pre-anonimizados.
  it('emite bloque anonymization cuando se le pasa anonymizationManifest', () => {
    const meta = buildMetadata({
      patient: { displayName: 'X' },
      expected: 1,
      documents: [makeDoc({ id: 'cda-1' })],
      errors: [],
      log: emptyLog,
      startedAt: '2026-04-15T11:55:00.000Z',
      anonymized: true,
      anonymizationScope: 'basic',
      anonymizationManifest: {
        by: 'mi-hcd-extension',
        version: '1.1.0',
        scope: 'basic',
        tokens: ['[PACIENTE]', '[CI]', '[TEL_N]', '[EMAIL_N]'],
        stats: {
          patientNames: ['juan perez'],
          telephones: 2,
          emails: 0,
          cedulas: 1,
        },
        files: ['docs/cda-1.html'],
      },
    });
    expect(meta.anonymization).toBeDefined();
    expect(meta.anonymization!.by).toBe('mi-hcd-extension');
    expect(meta.anonymization!.version).toBe('1.1.0');
    expect(meta.anonymization!.scope).toBe('basic');
    expect(meta.anonymization!.tokens).toContain('[PACIENTE]');
    expect(meta.anonymization!.tokens).toContain('[CI]');
    expect(meta.anonymization!.files).toEqual(['docs/cda-1.html']);
    expect(meta.anonymization!.stats.cedulas).toBe(1);
  });

  it('omite el bloque anonymization cuando no se pasa manifest', () => {
    const meta = buildMetadata({
      patient: { displayName: 'X' },
      expected: 1,
      documents: [makeDoc()],
      errors: [],
      log: emptyLog,
      startedAt: '2026-04-15T11:55:00.000Z',
      // anonymized=true sin manifest: el flag legacy sale, pero el
      // bloque detallado no.
      anonymized: true,
      anonymizationScope: 'basic',
    });
    expect('anonymization' in meta).toBe(false);
  });

  it('exportedAt usa el `now` inyectado (test determinístico)', () => {
    const fixed = new Date('2026-04-15T12:00:00.000Z');
    const meta = buildMetadata(
      {
        patient: { displayName: 'X' },
        expected: 0,
        documents: [],
        errors: [],
        log: emptyLog,
        startedAt: '2026-04-15T11:55:00.000Z',
      },
      fixed,
    );
    expect(meta.exportedAt).toBe('2026-04-15T12:00:00.000Z');
  });
});
