// @vitest-environment happy-dom
/**
 * Tests de viewer-dossier.js: limpieza del HTML del portal y armado del
 * documento para la consulta.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import dossierSrc from './viewer-dossier.js?raw';

type Dossier = {
  limpiar(html: string): string;
  armar(opts: Record<string, unknown>): string;
};
let D: Dossier;
beforeAll(() => {
  new Function(dossierSrc)();
  D = (window as unknown as { HCDDossier: Dossier }).HCDDossier;
});

describe('limpiar', () => {
  // Atributos y etiquetas peligrosos armados por partes, para que el test no
  // dependa de que happy-dom ejecute algo al parsear.
  const on = 'on' + 'error';
  const sucio = `<html><head><style>body{color:red}</style><script>var x = 1;</script></head><body>
<h2 class="t" style="color:blue">Consulta</h2>
<img src="x.png" ${on}="robar()"><img src="data:image/png;base64,AAAA">
<a href="javascript:robar()">link</a><a href="#seccion">ancla</a><a href="https://evil.test">afuera</a>
<object data="x"></object><embed src="x">
<form action="https://evil.test"><input name="a"></form>
<pre id="b64">JVBERi0=</pre><p>Texto clínico</p></body></html>`;

  it('saca scripts, estilos, objetos y formularios', () => {
    const out = D.limpiar(sucio);
    expect(out).not.toMatch(/<script|<style|<object|<embed|<form|<input|JVBERi0/i);
    expect(out).toContain('Texto clínico');
  });

  it('saca manejadores on*, links javascript: y recursos externos', () => {
    const out = D.limpiar(sucio);
    expect(out).not.toContain(on);
    expect(out).not.toMatch(/javascript:|evil\.test|x\.png|style=|class=/);
  });

  // happy-dom no puede parsear <iframe> con DOMParser (intenta cargarlo y falla):
  // se verifica que la lista de etiquetas a quitar los incluya; en el navegador
  // se probó con un documento real que trae un iframe con un PDF embebido.
  it('la lista de etiquetas a quitar incluye iframes y frames', () => {
    const lista = /var QUITAR = '([^']+)'/.exec(dossierSrc)![1]!.split(/,\s*/);
    expect(lista).toEqual(expect.arrayContaining(['iframe', 'frame', 'frameset', 'object', 'embed', 'script', 'style']));
  });

  it('conserva imágenes embebidas y anclas internas', () => {
    const out = D.limpiar(sucio);
    expect(out).toContain('data:image/png;base64,AAAA');
    expect(out).toContain('href="#seccion"');
  });
});

describe('armar', () => {
  const base = {
    paciente: 'Paciente Ficticio',
    descargada: '2026-10-04',
    docs: [
      { fecha: '2026-03-23', hora: '09:45', titulo: 'Urología', categoria: 'Policlínica', prestador: 'Hospital Central', profesional: 'Ana Gómez', html: '<p>Control <b>anual</b></p>' },
      { fecha: '2026-04-01', titulo: 'Laboratorio', categoria: 'Laboratorio', pdf: true },
    ],
    resumen: { diagnosticos: ['Asma (01/02/2026)'], medicamentos: [], vacunas: ['ANTIGRIPAL 2026 (última dosis 27/04/2026)'] },
  };

  it('arma portada con índice, resumen y un documento por página', () => {
    const html = D.armar(base);
    expect(html).toContain('Documentos para la consulta');
    expect(html).toContain('Paciente Ficticio');
    expect(html).toContain('23/03/2026 — Urología · Hospital Central');
    expect(html).toContain('Resumen armado a partir de los documentos');
    expect(html).toContain('Asma (01/02/2026)');
    expect(html).not.toContain('<h3>Medicamentos</h3>');
    expect(html.match(/class="doc"/g)).toHaveLength(2);
    expect(html).toContain('Control <b>anual</b>');
    expect(html).toContain('PDF adjunto');
  });

  it('escapa los textos de la portada', () => {
    const html = D.armar({ ...base, docs: [{ ...base.docs[0], titulo: '<img src=x>' }], resumen: null });
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('Resumen armado');
  });
});
