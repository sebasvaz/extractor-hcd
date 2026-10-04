/*
 * Cargador del visor suelto (visor-hc.html) para ZIPs descargados con
 * versiones de la extensión que todavía no traían visor.html.
 *
 * El titular elige o arrastra el ZIP; se lee acá mismo con JSZip (inline en
 * el HTML) y no sale de la computadora: no hay red, la CSP lo bloquea. Del
 * ZIP se arma el mismo índice que `buildViewerData` (index.ts) y se arranca
 * el visor de viewer-client.js. Los HTML del portal se muestran con
 * `srcdoc` en un iframe con sandbox; los PDF, con una URL blob.
 */
(function () {
  'use strict';

  var V = window.HCDViewer;
  var h = V.h;
  var ico = V.ico;

  var root = document.getElementById('app');
  var urls = [];

  // ---- Lectura del ZIP ---------------------------------------------------

  /** Encuentra metadata.json aunque el ZIP se haya vuelto a comprimir dentro de una carpeta. */
  function findMetadata(zip) {
    var best = null;
    zip.forEach(function (path, entry) {
      if (entry.dir || !/(^|\/)metadata\.json$/.test(path)) return;
      if (!best || path.length < best.length) best = path;
    });
    return best;
  }

  function openZip(file, onProgress) {
    return JSZip.loadAsync(file).then(function (zip) {
      var metaPath = findMetadata(zip);
      if (!metaPath) {
        throw new Error('El archivo no tiene metadata.json. ¿Es el ZIP que descargó la extensión Extractor de HCD?');
      }
      var prefix = metaPath.slice(0, metaPath.length - 'metadata.json'.length);
      return zip.file(metaPath).async('string').then(function (raw) {
        var meta;
        try { meta = JSON.parse(raw); } catch (e) { throw new Error('metadata.json está dañado y no se puede leer.'); }
        if (!meta || !Array.isArray(meta.documents)) {
          throw new Error('metadata.json no tiene la lista de documentos que espera el visor.');
        }
        return readDocuments(zip, prefix, meta, onProgress);
      });
    });
  }

  function readDocuments(zip, prefix, meta, onProgress) {
    var htmlById = {};
    var docs = [];
    var done = 0;
    var total = meta.documents.length;
    // Secuencial: los ZIP grandes tienen cientos de documentos y así el
    // progreso avanza parejo sin saturar la memoria.
    return meta.documents.reduce(function (p, d) {
      return p.then(function () {
        var out = {
          id: d.id, file: d.file, categoria: d.categoria || 'Otros', fecha: d.fecha || ''
        };
        if (d.prestador) out.prestador = d.prestador;
        if (d.profesional) out.profesional = d.profesional;
        if (d.descripcion) out.descripcion = d.descripcion;
        var pdfEntry = d.attachmentFile && zip.file(prefix + d.attachmentFile);
        var htmlEntry = d.file && zip.file(prefix + d.file);
        var work;
        if (pdfEntry) {
          work = pdfEntry.async('uint8array').then(function (bytes) {
            var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
            urls.push(url);
            out.pdf = url;
          });
        } else if (htmlEntry) {
          work = htmlEntry.async('string').then(function (html) {
            // El cliente extrae texto, cabezal y secciones (viewer-extract.js)
            // y descarta `out.html`; `htmlById` queda para mostrarlo con srcdoc.
            htmlById[d.id] = html;
            out.html = html;
          });
        } else {
          work = Promise.resolve();
          out._missing = true;
        }
        return work.then(function () {
          docs.push(out);
          done += 1;
          if (onProgress) onProgress(done, total);
        });
      });
    }, Promise.resolve()).then(function () {
      var missing = docs.filter(function (d) { return d._missing; });
      var anonymized = Boolean(meta.anonymized);
      var name = ((meta.patient && meta.patient.displayName) || '').trim();
      var errors = (meta.errors || []).concat(missing.map(function (d) {
        return { fecha: d.fecha, categoria: d.categoria, descripcion: d.descripcion, message: 'Falta en el ZIP' };
      }));
      var extVersion = (meta.producer && meta.producer.version) || (meta.anonymization && meta.anonymization.version) || '';
      return {
        data: {
          exportedAt: meta.exportedAt || '',
          exportId: meta.exportId || '',
          extensionVersion: extVersion,
          viewerVersion: window.HCD_VIEWER_VERSION || '',
          anonymized: anonymized,
          patientName: anonymized || !name || name === 'paciente' ? null : name,
          totals: meta.totals || { expected: total, captured: total, failed: 0 },
          documents: docs.filter(function (d) { return !d._missing; }),
          errors: errors
        },
        htmlById: htmlById
      };
    });
  }

  // ---- Pantalla de carga ------------------------------------------------

  var statusEl, dropEl, inputEl;

  function setStatus(kind, text) {
    statusEl.className = 'load-status' + (kind ? ' ' + kind : '');
    statusEl.textContent = '';
    if (kind === 'error') statusEl.appendChild(ico('warn', 16));
    if (text) statusEl.appendChild(h('span', { text: text }));
    statusEl.hidden = !text;
  }

  function handle(file) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name) && file.type && !/zip/.test(file.type)) {
      setStatus('error', 'Ese archivo no es un ZIP. Elegí el archivo hcd_export_….zip que descargó la extensión.');
      return;
    }
    dropEl.setAttribute('aria-busy', 'true');
    setStatus('busy', 'Abriendo ' + file.name + '…');
    openZip(file, function (done, total) {
      setStatus('busy', 'Leyendo documento ' + done + ' de ' + total + '…');
    }).then(function (res) {
      root.textContent = '';
      V.start(root, res.data, {
        source: function (d) {
          if (d.pdf) return { frame: { src: d.pdf }, href: d.pdf, label: d.file.replace(/\.html$/, '.pdf') };
          var html = res.htmlById[d.id] || '';
          var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
          urls.push(url);
          // sandbox vacío: el HTML del portal no ejecuta scripts ni navega.
          return { frame: { sandbox: '' }, srcdoc: html, href: url, label: d.file };
        },
        hint: null,
        offlineText: 'Funciona sin internet. El ZIP no sale de tu computadora.',
        onReopen: function () {
          urls.forEach(function (u) { URL.revokeObjectURL(u); });
          location.replace(location.pathname + location.search);
        }
      });
    }).catch(function (err) {
      dropEl.removeAttribute('aria-busy');
      var msg = err && err.message ? err.message : String(err);
      if (/end of central directory|Corrupted zip|is this a zip/i.test(msg)) {
        msg = 'No se pudo abrir el ZIP: parece dañado o incompleto. Probá descargarlo de nuevo.';
      }
      setStatus('error', msg);
    });
  }

  function loader() {
    inputEl = h('input', { type: 'file', accept: '.zip,application/zip', class: 'visually-hidden', id: 'zip-input' });
    inputEl.addEventListener('change', function () { handle(inputEl.files && inputEl.files[0]); inputEl.value = ''; });

    dropEl = h('div', { class: 'drop' }, [
      h('div', { class: 'drop-icon' }, [ico('file', 26)]),
      h('b', { text: 'Arrastrá acá el ZIP de tu historia' }),
      h('span', { class: 'drop-or', text: 'o' }),
      h('label', { class: 'btn primary', for: 'zip-input' }, [ico('search', 15), 'Elegir archivo']),
      h('span', { class: 'drop-file', text: 'hcd_export_<nombre>_<fecha>.zip' }),
      inputEl
    ]);
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.remove('over'); });
    });
    dropEl.addEventListener('drop', function (e) {
      handle(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    // Soltar el archivo fuera del recuadro no debe hacer que el navegador lo abra.
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    statusEl = h('div', { class: 'load-status', role: 'status', 'aria-live': 'polite' });
    statusEl.hidden = true;

    return h('div', { class: 'load' }, [h('div', { class: 'load-card' }, [
      h('div', { class: 'load-band' }, [
        h('div', { class: 'logo', text: 'HC' }),
        h('div', null, [
          h('div', { class: 'nav-name', text: 'Mi historia clínica' }),
          h('div', { class: 'nav-sub', text: 'Visor local · Plataforma IPS' })
        ])
      ]),
      h('div', { class: 'load-body' }, [
        h('h1', { text: 'Abrí tu historia clínica' }),
        h('p', { text: 'Elegí el ZIP que descargaste con la extensión Extractor de HCD. No hace falta descomprimirlo.' }),
        dropEl,
        statusEl,
        h('div', { class: 'load-note' }, [ico('shield', 16), h('span', {
          text: 'El archivo se lee en este navegador y no se sube a ningún lado. Este visor funciona sin internet.'
        })]),
        V.origin('load-origin', { viewerVersion: window.HCD_VIEWER_VERSION })
      ])
    ])]);
  }

  root.appendChild(loader());
})();
