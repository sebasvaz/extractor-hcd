/*
 * "Llevar a la consulta": arma un único documento imprimible con los
 * documentos que el titular eligió, para imprimirlo o guardarlo como PDF.
 *
 * El HTML de cada documento viene del portal: antes de juntarlo se limpia
 * (sin scripts, iframes, objetos, manejadores on*, links javascript: ni
 * estilos propios) y se le aplica un estilo de impresión neutro. El
 * resultado se escribe en una ventana nueva (about:blank, mismo origen) y se
 * imprime desde el visor.
 *
 * JS plano: se inyecta inline en los dos visores y se testea con happy-dom.
 */
(function (root) {
  'use strict';

  var QUITAR = 'script, noscript, template, iframe, frame, frameset, object, embed, applet, link, meta, base, style, form, input, button, select, textarea, #b64';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Cuerpo de un documento del portal, sin nada que pueda ejecutarse ni pedir recursos. */
  function limpiar(html) {
    var doc = new DOMParser().parseFromString(html || '', 'text/html');
    // De adentro hacia afuera (los descendientes primero).
    Array.prototype.slice.call(doc.querySelectorAll(QUITAR)).reverse().forEach(function (el) {
      try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) { /* se verifica abajo */ }
    });
    // Si algo de la lista quedó (no debería), no se usa este documento: falla cerrado.
    if (doc.querySelector(QUITAR)) return '<p>No se pudo preparar este documento para imprimir.</p>';
    Array.prototype.forEach.call(doc.querySelectorAll('*'), function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var n = a.name.toLowerCase();
        var v = (a.value || '').trim().toLowerCase();
        if (n.indexOf('on') === 0 || n === 'style' || n === 'class' || n === 'id' ||
            ((n === 'href' || n === 'src' || n === 'action' || n === 'xlink:href' || n === 'formaction') && !/^(data:image\/|#)/.test(v))) {
          el.removeAttribute(a.name);
        }
      });
    });
    return doc.body ? doc.body.innerHTML : '';
  }

  var CSS = [
    '@page { margin: 16mm 14mm; }',
    'body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0B1220; font-size: 11pt; line-height: 1.45; margin: 0; }',
    'h1 { font-size: 18pt; margin: 0 0 4pt; } h2 { font-size: 13pt; margin: 0 0 2pt; }',
    'h3, h4 { font-size: 11pt; margin: 10pt 0 4pt; }',
    '.portada { border-bottom: 2px solid #1B6CA8; padding-bottom: 10pt; margin-bottom: 12pt; }',
    '.muted { color: #64748B; font-size: 9.5pt; }',
    '.indice { margin: 8pt 0 0; padding-left: 16pt; font-size: 10pt; }',
    '.resumen { margin: 12pt 0; } .resumen ul { margin: 2pt 0 8pt; padding-left: 16pt; }',
    '.doc { break-before: page; page-break-before: always; }',
    '.doc-head { border-bottom: 1px solid #C9D1D9; padding-bottom: 6pt; margin-bottom: 8pt; }',
    'table { border-collapse: collapse; margin: 4pt 0 8pt; } td, th { border: 1px solid #C9D1D9; padding: 3pt 6pt; vertical-align: top; text-align: left; }',
    'img { max-width: 100%; }',
    '.pdf { padding: 10pt; border: 1px dashed #94A3B8; color: #334155; }',
    '.pie { margin-top: 14pt; font-size: 8.5pt; color: #64748B; }'
  ].join('\n');

  function fecha(f) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }

  /**
   * Documento completo. `opts`: { docs: [{ fecha, hora, titulo, categoria,
   * prestador, profesional, html, pdf }], paciente, descargada, resumen:
   * { diagnosticos: [], medicamentos: [], vacunas: [] } | null, origen }.
   */
  function armar(opts) {
    var docs = opts.docs || [];
    var partes = [];
    partes.push('<section class="portada"><h1>Documentos para la consulta</h1>' +
      '<div class="muted">' + esc([opts.paciente, 'Historia clínica descargada de Mi HCD el ' + fecha(opts.descargada),
        docs.length + (docs.length === 1 ? ' documento' : ' documentos')].filter(Boolean).join(' · ')) + '</div>' +
      '<ol class="indice">' + docs.map(function (d) {
        return '<li>' + esc(fecha(d.fecha)) + ' — ' + esc(d.titulo) + (d.prestador ? ' · ' + esc(d.prestador) : '') + '</li>';
      }).join('') + '</ol></section>');

    var r = opts.resumen;
    if (r && (r.diagnosticos.length || r.medicamentos.length || r.vacunas.length)) {
      var lista = function (titulo, items) {
        return items.length ? '<h3>' + esc(titulo) + '</h3><ul>' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' : '';
      };
      partes.push('<section class="resumen"><h2>Resumen armado a partir de los documentos</h2>' +
        '<div class="muted">Generado automáticamente por el visor; verificar en los documentos originales.</div>' +
        lista('Diagnósticos', r.diagnosticos) + lista('Medicamentos', r.medicamentos) + lista('Vacunas', r.vacunas) + '</section>');
    }

    docs.forEach(function (d) {
      var meta = [fecha(d.fecha) + (d.hora ? ' ' + d.hora : ''), d.categoria, d.prestador, d.profesional].filter(Boolean).join(' · ');
      var cuerpo = d.pdf
        ? '<div class="pdf">Este documento es un PDF adjunto: imprimilo aparte desde el visor ("Abrir PDF").</div>'
        : limpiar(d.html);
      partes.push('<section class="doc"><div class="doc-head"><h2>' + esc(d.titulo) + '</h2><div class="muted">' + esc(meta) +
        '</div></div>' + cuerpo + '</section>');
    });

    partes.push('<div class="pie">' + esc(opts.origen || 'Generado con el visor local de la HC — Extractor de HCD · Plataforma IPS') + '</div>');
    return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Documentos para la consulta</title><style>' + CSS +
      '</style></head><body>' + partes.join('\n') + '</body></html>';
  }

  root.HCDDossier = { limpiar: limpiar, armar: armar };
})(typeof window !== 'undefined' ? window : globalThis);
