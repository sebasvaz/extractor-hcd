/**
 * Tests para src/lib/viewer — el visor.html que viaja dentro del ZIP.
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import type { CapturedDocument } from '../messaging/types';
import { buildMetadata, buildZip, type BuildZipArgs } from '../zip-builder';
import { buildStandaloneViewerHtml, buildViewerData, buildViewerHtml, VIEWER_FILE, VIEWER_VERSION } from '.';

function makeDoc(overrides: Partial<CapturedDocument> = {}): CapturedDocument {
  return {
    id: '2026-04-15_policlinica_consulta',
    categoria: 'Policlínica',
    fecha: '2026-04-15',
    prestador: 'ASSE',
    profesional: 'Dra. X',
    descripcion: 'Consulta',
    visualizarUrl: 'https://historiaclinicadigital.gub.uy/x',
    captureUrl: 'https://historiaclinicadigital.gub.uy/y',
    capturedAt: '2026-04-15T12:00:00.000Z',
    html: '<!DOCTYPE html><html><head><title>t</title></head><body><p>Hemoglobina&nbsp;13,2 g/dL</p></body></html>',
    sha256: '0'.repeat(64),
    ...overrides,
  };
}

function args(overrides: Partial<BuildZipArgs> = {}): BuildZipArgs {
  return {
    patient: { displayName: 'Juan Pérez' },
    expected: 1,
    documents: [makeDoc()],
    errors: [],
    log: [],
    startedAt: '2026-04-15T11:55:00.000Z',
    ...overrides,
  };
}

/** Extrae el JSON embebido en visor.html. */
function embeddedData(html: string): unknown {
  const m = /<script type="application\/json" id="hcd-data">([\s\S]*?)<\/script>/.exec(html);
  expect(m).not.toBeNull();
  return JSON.parse(m![1]!);
}

describe('buildViewerData', () => {
  it('embebe el HTML del documento para que el visor lo procese', () => {
    const data = buildViewerData(buildMetadata(args()), [makeDoc()]);
    expect(data.documents[0]!.html).toContain('Hemoglobina&nbsp;13,2 g/dL');
    expect(data.patientName).toBe('Juan Pérez');
    expect(data.anonymized).toBe(false);
    expect(data.viewerVersion).toBe(VIEWER_VERSION);
    expect(data.exportId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('no expone el nombre del titular si el paquete es anonimizado', () => {
    const data = buildViewerData(buildMetadata(args({ anonymized: true })), [makeDoc()]);
    expect(data.patientName).toBeNull();
    expect(data.anonymized).toBe(true);
    expect(JSON.stringify(data)).not.toContain('Juan');
  });

  it('usa el PDF adjunto y no embebe el HTML de la portada', () => {
    const doc = makeDoc({ attachmentBase64: 'JVBERi0=', attachmentMime: 'application/pdf' });
    const data = buildViewerData(buildMetadata(args({ documents: [doc] })), [doc]);
    expect(data.documents[0]!.pdf).toBe(`docs/${doc.id}.pdf`);
    expect(data.documents[0]!.html).toBeUndefined();
  });

  it('registra la versión de la extensión', () => {
    const data = buildViewerData(buildMetadata(args()), [makeDoc()], { extensionVersion: '9.9.9' });
    expect(data.extensionVersion).toBe('9.9.9');
  });
});

describe('buildViewerHtml', () => {
  it('el HTML embebido no puede cerrar el <script> ni ser leído como tabla por el escaneo de PII', () => {
    const doc = makeDoc({ html: '<table><tr><td>Documento</td><td>12345678</td></tr></table><script>x()</script>' });
    const html = buildViewerHtml(buildMetadata(args({ documents: [doc] })), [doc]);
    expect(html).not.toContain('<td>Documento</td>');
    expect(html).not.toContain('<script>x()</script>');
    const data = embeddedData(html) as { documents: Array<{ html: string }> };
    expect(data.documents[0]!.html).toContain('<td>Documento</td>');
  });

  it('el contenido no puede cerrar el <script> del JSON embebido', () => {
    const doc = makeDoc({ descripcion: '</script><img src=x onerror=alert(1)>' });
    const html = buildViewerHtml(buildMetadata(args({ documents: [doc] })), [doc]);
    expect(html).not.toContain('</script><img');
    const data = embeddedData(html) as { documents: Array<{ descripcion: string }> };
    expect(data.documents[0]!.descripcion).toBe('</script><img src=x onerror=alert(1)>');
  });

  it('declara una CSP sin conexiones de red', () => {
    const html = buildViewerHtml(buildMetadata(args()), [makeDoc()]);
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=["']https?:/);
  });
});

describe('buildZip + visor', () => {
  it('el ZIP incluye visor.html en la raíz', async () => {
    const { blob } = await buildZip(args());
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const visor = await zip.file(VIEWER_FILE)!.async('string');
    const data = embeddedData(visor) as { documents: Array<{ file: string }> };
    expect(data.documents[0]!.file).toBe('docs/2026-04-15_policlinica_consulta.html');
    expect(zip.file(data.documents[0]!.file)).not.toBeNull();
  });
});

describe('buildStandaloneViewerHtml', () => {
  const html = buildStandaloneViewerHtml('/* jszip */ window.JSZip = {}; // "</script>" en un string');

  it('lleva JSZip inline sin que pueda cerrar su <script>', () => {
    expect(html).toContain('/* jszip */ window.JSZip = {};');
    expect(html).not.toContain('"</script>" en un string');
  });

  it('no trae índice embebido: lo arma el cargador a partir del ZIP', () => {
    expect(html).not.toContain('id="hcd-data"');
    expect(html).toContain('zip-input');
  });

  it('declara una CSP sin red que admite frames blob: y data:', () => {
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('frame-src blob: data:');
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=["']https?:/);
  });
});
