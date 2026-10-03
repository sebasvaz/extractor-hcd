/**
 * Tests para src/lib/viewer — el visor.html que viaja dentro del ZIP.
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import type { CapturedDocument } from '../messaging/types';
import { buildMetadata, buildZip, type BuildZipArgs } from '../zip-builder';
import { buildViewerData, buildViewerHtml, htmlToPlainText, MAX_TEXT_CHARS, VIEWER_FILE } from '.';

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

describe('htmlToPlainText', () => {
  it('quita head, scripts, estilos y comentarios', () => {
    const html =
      '<html><head><title>No</title><style>p{}</style></head><body><!-- x --><script>alert(1)</script><p>Sí</p></body></html>';
    expect(htmlToPlainText(html)).toBe('Sí');
  });

  it('decodifica entidades con nombre y numéricas', () => {
    expect(htmlToPlainText('<p>Ni&ntilde;o &amp; mam&#225; &#x2014; 5&nbsp;mg</p>')).toBe('Niño & mamá — 5 mg');
  });

  it('separa celdas contiguas y colapsa espacios', () => {
    expect(htmlToPlainText('<tr><td>Glucemia</td><td>90</td></tr>\n\n  <p>ok</p>')).toBe('Glucemia 90 ok');
  });

  it('descarta el base64 de un PDF embebido', () => {
    expect(htmlToPlainText('<body><pre id="b64">JVBERi0xLjQK</pre><p>Informe</p></body>')).toBe('Informe');
  });
});

describe('buildViewerData', () => {
  it('incluye el texto del documento para la búsqueda', () => {
    const data = buildViewerData(buildMetadata(args()), [makeDoc()]);
    expect(data.documents[0]!.text).toBe('Hemoglobina 13,2 g/dL');
    expect(data.patientName).toBe('Juan Pérez');
    expect(data.anonymized).toBe(false);
  });

  it('no expone el nombre del titular si el paquete es anonimizado', () => {
    const data = buildViewerData(buildMetadata(args({ anonymized: true })), [makeDoc()]);
    expect(data.patientName).toBeNull();
    expect(data.anonymized).toBe(true);
    expect(JSON.stringify(data)).not.toContain('Juan');
  });

  it('usa el PDF adjunto y no indexa el HTML de la portada', () => {
    const doc = makeDoc({ attachmentBase64: 'JVBERi0=', attachmentMime: 'application/pdf' });
    const data = buildViewerData(buildMetadata(args({ documents: [doc] })), [doc]);
    expect(data.documents[0]!.pdf).toBe(`docs/${doc.id}.pdf`);
    expect(data.documents[0]!.text).toBe('');
  });

  it('acota el texto indexado por documento', () => {
    const doc = makeDoc({ html: `<p>${'a '.repeat(MAX_TEXT_CHARS)}</p>` });
    const data = buildViewerData(buildMetadata(args({ documents: [doc] })), [doc]);
    expect(data.documents[0]!.text.length).toBe(MAX_TEXT_CHARS);
  });
});

describe('buildViewerHtml', () => {
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
