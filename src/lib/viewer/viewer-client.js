/*
 * Cliente del visor local de la HCD (se inyecta inline en visor.html).
 *
 * JS plano, sin dependencias ni red. Lee el índice embebido en #hcd-data y
 * arma el visor con el lenguaje visual de la Plataforma IPS: barra lateral
 * con categorías y prestadores, un resumen de inicio, y resultados +
 * documento. En el celular, lista y documento son dos pantallas.
 *
 * Todo el contenido del índice se inserta con textContent: nada se
 * interpreta como HTML. El único innerHTML son los íconos SVG constantes
 * de este archivo.
 */
(function () {
  'use strict';

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // Paleta de las secciones del visor IPS (SECTION_META) aplicada a las
  // categorías de Mi HCD.
  var CATS = {
    'Policlínica': { icon: 'policlinica', fg: '#1e4f9c', bg: '#e8f0fb' },
    'Vacunas': { icon: 'vacunas', fg: '#065f46', bg: '#d1fae5' },
    'Laboratorio': { icon: 'lab', fg: '#1e4f9c', bg: '#e8f0fb' },
    'Imagenología': { icon: 'imagen', fg: '#374151', bg: '#f4f7fb' },
    'Internación': { icon: 'internacion', fg: '#92400e', bg: '#fff7ed' },
    'Urgencia y emergencia': { icon: 'urgencia', fg: '#991b1b', bg: '#fdecea' },
    'Procedimientos médicos': { icon: 'procedimientos', fg: '#1e4f9c', bg: '#ede9fe' },
    'Procedimientos quirúrgicos': { icon: 'quirurgicos', fg: '#1e4f9c', bg: '#ede9fe' },
    'Teleconsulta': { icon: 'teleconsulta', fg: '#374151', bg: '#f4f7fb' },
    'Otros': { icon: 'otros', fg: '#475569', bg: '#eef2f7' }
  };

  /** Origen del visor: el proyecto Plataforma IPS y la extensión que generó el ZIP. */
  var PLATFORM_URL = 'https://proyectoips.vz-labs.com/participar';
  var REPO_URL = 'https://github.com/sebasvaz/extractor-hcd';
  var CAT_OTRA = { icon: 'file', fg: '#374151', bg: '#f4f7fb' };

  var ICONS = {
    home: '<path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z"/>',
    policlinica: '<path d="M5 3v4a4 4 0 0 0 8 0V3"/><path d="M9 11v1.5a4 4 0 0 0 8 0V11.5"/><circle cx="17" cy="9.5" r="2"/>',
    lab: '<path d="M8 3h4M9 3v5l-4.5 7.5A1 1 0 0 0 5.4 17h9.2a1 1 0 0 0 .9-1.5L11 8V3"/><path d="M6.6 12.5h6.8"/>',
    vacunas: '<path d="m12.5 3.5 4 4"/><path d="M14.5 5.5 7 13H5v-2l7.5-7.5"/><path d="M5 13l-2 2"/><path d="m9.5 8.5 1.5 1.5"/>',
    imagen: '<rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="10" cy="10" r="3"/>',
    internacion: '<path d="M3 5v11M3 13h14v3M3 10h4.5a2 2 0 0 1 2 2v1M9.5 9.5h5.5a2 2 0 0 1 2 2V13"/>',
    urgencia: '<circle cx="10" cy="10" r="7"/><path d="M10 6.5v7M6.5 10h7"/>',
    procedimientos: '<path d="M3 10h3l2-5 4 10 2-5h3"/>',
    quirurgicos: '<path d="M3.5 16.5 12 8l2.5 2.5-6 6z"/><path d="m12 8 3.5-3.5"/>',
    teleconsulta: '<rect x="3" y="5.5" width="10" height="9" rx="1.5"/><path d="m13 9 4-2.5v7L13 11"/>',
    search: '<circle cx="9" cy="9" r="5"/><path d="m13 13 4 4"/>',
    external: '<path d="M11 3h6v6M17 3l-8 8"/><path d="M15 12v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"/>',
    up: '<path d="M10 15V5M5.5 9.5 10 5l4.5 4.5"/>',
    down: '<path d="M10 5v10M5.5 10.5 10 15l4.5-4.5"/>',
    shield: '<path d="M10 3l6 2.5V10c0 3.5-2.6 6.2-6 7-3.4-.8-6-3.5-6-7V5.5z"/><path d="m7.5 10 2 2 3-3.5"/>',
    warn: '<path d="M10 3.5 17.5 16.5h-15z"/><path d="M10 8.5V12M10 14.3v.2"/>',
    file: '<path d="M5 2.5h6.5L15 6v11.5H5z"/><path d="M11.5 2.5V6H15"/>',
    building: '<rect x="4" y="3" width="12" height="14" rx="1"/><path d="M8 7h1M11 7h1M8 10h1M11 10h1M9 17v-3h2v3"/>',
    calendar: '<rect x="3" y="4.5" width="14" height="12.5" rx="1.5"/><path d="M3 8h14M7 3v3M13 3v3"/>',
    back: '<path d="M16 10H4M8.5 5.5 4 10l4.5 4.5"/>',
    filter: '<path d="M3 5h14M6 10h8M8.5 15h3"/>',
    close: '<path d="m5 5 10 10M15 5 5 15"/>',
    otros: '<path d="M3 6a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 2h6.2A1.5 1.5 0 0 1 17 8v6.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/>',
    especialidad: '<circle cx="10" cy="6.5" r="3"/><path d="M4.5 17a5.5 5.5 0 0 1 11 0"/>',
    diag: '<rect x="4.5" y="3.5" width="11" height="14" rx="1.5"/><path d="M8 3.5V5h4V3.5M7.5 9h5M7.5 12h5M7.5 15h3"/>',
    pill: '<rect x="2.8" y="7.2" width="14.4" height="5.6" rx="2.8" transform="rotate(-45 10 10)"/><path d="m7.9 7.9 4.2 4.2"/>',
    grid: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>',
    star: '<path d="m10 3 2.1 4.4 4.9.6-3.6 3.4.9 4.8L10 13.9l-4.3 2.3.9-4.8L3 8l4.9-.6z"/>',
    ips: '<path d="M10 3 4 5.5V10c0 3.5 2.6 6.2 6 7 3.4-.8 6-3.5 6-7V5.5z"/><path d="M7.5 10h5M10 7.5v5"/>',
    users: '<circle cx="7.5" cy="7" r="2.5"/><path d="M3 16a4.5 4.5 0 0 1 9 0"/><circle cx="14" cy="8" r="2"/><path d="M13 12.2a3.8 3.8 0 0 1 4.5 3.8"/>',
    note: '<path d="M4 16.5V13l8.5-8.5 3.5 3.5L7.5 16.5z"/><path d="m11 6 3.5 3.5"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    check: '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>',
    sparkle: '<path d="M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2"/>',
    speak: '<path d="M4 8h3l4-3.5v11L7 12H4z"/><path d="M14 7.5a3.5 3.5 0 0 1 0 5M16 5a7 7 0 0 1 0 10"/>',
    stop: '<rect x="5" y="5" width="10" height="10" rx="1.5"/>',
    abc: '<path d="M3 15 6 5l3 10M4 12h4M11 15V5h2.5a2.5 2.5 0 0 1 0 5H11h3a2.5 2.5 0 0 1 0 5z"/>',
    print: '<path d="M6 7V3h8v4"/><rect x="3" y="7" width="14" height="7" rx="1.5"/><path d="M6 12h8v5H6z"/>'
  };

  // ---- Utilidades ------------------------------------------------------

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function ico(key, size) {
    var s = size || 16;
    var span = document.createElement('span');
    span.style.display = 'contents';
    // Constante de este archivo, nunca contenido del índice.
    span.innerHTML = '<svg class="ico" width="' + s + '" height="' + s + '" viewBox="0 0 20 20" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[key] || ICONS.file) + '</svg>';
    return span.firstChild;
  }

  function catMeta(c) { return CATS[c] || CAT_OTRA; }
  function catVars(c) { var m = catMeta(c); return '--fg:' + m.fg + ';--bg:' + m.bg; }

  var MARKS = /[̀-ͯ]/g;
  function norm(s) { return (s || '').normalize('NFD').replace(MARKS, '').toLowerCase(); }

  /** Normaliza `s` guardando, por cada char normalizado, su índice en `s`. */
  function normWithMap(s) {
    var out = '';
    var map = [];
    for (var i = 0; i < s.length; i++) {
      var n = s[i].normalize('NFD').replace(MARKS, '').toLowerCase();
      for (var j = 0; j < n.length; j++) { out += n[j]; map.push(i); }
    }
    map.push(s.length);
    return { text: out, map: map };
  }

  /** Rangos [ini, fin) en `s` donde aparece alguno de los términos. */
  function matchRanges(s, terms) {
    if (!terms.length) return [];
    var nm = normWithMap(s);
    var ranges = [];
    terms.forEach(function (t) {
      var from = 0;
      var at;
      while ((at = nm.text.indexOf(t, from)) !== -1) {
        ranges.push([nm.map[at], nm.map[at + t.length - 1] + 1]);
        from = at + t.length;
      }
    });
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r.slice());
    });
    return merged;
  }

  /** Agrega `s` a `el` con las siglas clínicas envueltas en <abbr> (explicadas al pasar el mouse). */
  function appendConSiglas(el, s) {
    var G = window.HCDGlossary;
    if (!G) { el.appendChild(document.createTextNode(s)); return; }
    G.partes(s).forEach(function (p) {
      el.appendChild(p.sigla
        ? h('abbr', { class: 'sigla', title: p.title, 'data-exp': p.title, text: p.sigla })
        : document.createTextNode(p.text));
    });
  }

  function conSiglas(tag, cls, s) {
    var el = h(tag, { class: cls });
    appendConSiglas(el, s || '');
    return el;
  }

  function highlighted(tag, cls, s, terms, extra) {
    var el = h(tag, { class: cls });
    var pos = 0;
    matchRanges(s, terms).forEach(function (r) {
      if (r[0] > pos) appendConSiglas(el, s.slice(pos, r[0]));
      el.appendChild(h('mark', { text: s.slice(r[0], r[1]) }));
      pos = r[1];
    });
    if (pos < s.length) appendConSiglas(el, s.slice(pos));
    if (extra) el.appendChild(extra);
    return el;
  }

  /** Fragmento del texto alrededor de la primera coincidencia. */
  function snippet(text, terms) {
    if (!text || !terms.length) return null;
    var r = matchRanges(text, terms)[0];
    if (!r) return null;
    var start = Math.max(0, r[0] - 60);
    var end = Math.min(text.length, r[1] + 100);
    var cut = text.slice(start, end);
    if (start > 0) cut = '…' + cut.replace(/^\S*\s/, '');
    if (end < text.length) cut = cut.replace(/\s\S*$/, '') + '…';
    return cut;
  }

  function parseFecha(f) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || '');
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function fechaCorta(f) {
    var p = parseFecha(f);
    return p ? pad(p.d) + '/' + pad(p.m) + '/' + p.y : 'Sin fecha';
  }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function titulo(d) { return d.titulo || d.descripcion || d.categoria || 'Documento'; }
  function fechaHora(d) { return fechaCorta(d.fecha) + (d.hora ? ' ' + d.hora : ''); }

  /**
   * Bloque de origen: de dónde sale este visor y a dónde ir para saber más.
   * `info`: { extensionVersion, viewerVersion, exportId }.
   */
  function origin(cls, info) {
    info = info || {};
    var versiones = [
      info.extensionVersion ? 'Extractor de HCD v' + info.extensionVersion : 'Extractor de HCD',
      info.viewerVersion ? 'visor v' + info.viewerVersion : null
    ].filter(Boolean).join(' · ');
    return h('div', { class: 'origin ' + (cls || '') }, [
      h('div', { class: 'origin-text' }, [
        'Generado con el ',
        h('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Extractor de HCD' }),
        ', parte del proyecto ',
        h('a', { href: PLATFORM_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Plataforma IPS' }),
        ' (Universidad ORT Uruguay).'
      ]),
      h('div', { class: 'origin-meta', text: versiones }),
      info.exportId ? h('div', { class: 'origin-meta', title: 'Identificador de esta descarga', text: 'Descarga ' + String(info.exportId).slice(0, 8) }) : null
    ]);
  }

  /**
   * Arma el visor en `root` a partir del índice `data` (shape de
   * `ViewerData` en index.ts). `opts`:
   *  - source(d): { frame: atributos del <iframe>, href, label } del documento.
   *    Por defecto, las rutas relativas de docs/ (visor dentro del ZIP).
   *  - hint: texto bajo el documento (null para ocultarlo).
   *  - offlineText: texto del recuadro "sin internet" de la barra lateral.
   *  - onReopen: si está, la barra lateral ofrece "Abrir otro ZIP".
   */
  function start(root, data, opts) {
    opts = opts || {};
    var source = opts.source || function (d) {
      var src = d.pdf || d.file;
      return {
        frame: d.pdf
          ? { src: src }
          // sandbox vacío: el HTML del portal no ejecuta scripts ni navega.
          : { src: src, sandbox: '', referrerpolicy: 'no-referrer' },
        href: src,
        label: src
      };
    };
    var hint = opts.hint !== undefined ? opts.hint
      : 'Si el documento aparece en blanco, descomprimí el ZIP completo y abrí visor.html desde la carpeta descomprimida.';

    // ---- Índice ----------------------------------------------------------

    var N = window.HCDNormalize;
    var X = window.HCDExtract;
    var fix = N ? N.fixMojibake : function (x) { return x; };
    var docs = data.documents.map(function (d, i) {
      if (typeof d.html === 'string' && X) {
        var r = X.extract(d.html);
        d.text = r.text;
        d.cda = r.cda;
        d.vacunas = r.vacunas;
        d.diagnosticos = r.diagnosticos.map(fix);
        d.medicamentos = r.medicamentos.map(fix);
      }
      d._html = typeof d.html === 'string' ? d.html : '';
      delete d.html;
      d.text = d.text || '';
      if (N) N.normalizeDoc(d);
      d._i = i;
      d._hay = norm([d.categoria, d.titulo, d.descripcion, d.especialidad, d.tipo, d.prestador, d.prestadorNombre,
        d.profesional, fechaCorta(d.fecha), d.text].join(' \n '));
      return d;
    });
    if (N) N.unifyPrestadores(docs);
    if (N && N.unifyEspecialidades) N.unifyEspecialidades(docs);
    var G = window.HCDGlossary;
    var byId = {};
    docs.forEach(function (d) { byId[d.id] = d; });

    // ---- Lo esencial: vacunas, diagnósticos, medicamentos, equipo ----------

    function sentence(s) {
      s = (s || '').trim();
      // Mayúsculas → oración; siglas cortas (HTA, EPOC) quedan como están.
      if (s && s === s.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3}/.test(s) && (s.split(' ').length > 1 || s.length > 5)) {
        s = s.toLowerCase();
        return s.charAt(0).toUpperCase() + s.slice(1);
      }
      return s;
    }

    /** Ítems repetidos en varios documentos → uno, con sus fechas y documentos de origen. */
    function agrupar(campo) {
      var map = {};
      docs.forEach(function (d) {
        (d[campo] || []).forEach(function (item) {
          var k = norm(item).replace(/[^a-z0-9]+/g, ' ').trim();
          if (!k) return;
          var g = map[k] || (map[k] = { label: sentence(item), docs: [], primera: d.fecha, ultima: d.fecha });
          if (g.docs.indexOf(d) === -1) g.docs.push(d);
          if (d.fecha && (!g.primera || d.fecha < g.primera)) g.primera = d.fecha;
          if (d.fecha && (!g.ultima || d.fecha > g.ultima)) g.ultima = d.fecha;
        });
      });
      return Object.keys(map).map(function (k) { return map[k]; });
    }
    var diagnosticos = agrupar('diagnosticos');
    var medicamentos = agrupar('medicamentos');

    // Cada documento de vacunas trae el historial completo: se deduplican las dosis.
    var vacunas = (function () {
      var dosis = {};
      docs.forEach(function (d) {
        (d.vacunas || []).forEach(function (v) {
          var nombre = fix(v.vacuna);
          var k = norm(nombre) + '|' + v.fecha + '|' + (v.dosis || '');
          var x = dosis[k] || (dosis[k] = { vacuna: nombre, fecha: v.fecha, dosis: v.dosis || '', via: fix(v.via || ''),
            vacunatorio: fix(v.vacunatorio || ''), doc: d });
          if (d.fecha > x.doc.fecha) x.doc = d;
        });
      });
      var grupos = {};
      Object.keys(dosis).forEach(function (k) {
        var x = dosis[k];
        var g = grupos[norm(x.vacuna)] || (grupos[norm(x.vacuna)] = { vacuna: x.vacuna, dosis: [] });
        g.dosis.push(x);
      });
      return Object.keys(grupos).map(function (k) {
        var g = grupos[k];
        g.dosis.sort(function (a, b) { return b.fecha.localeCompare(a.fecha); });
        g.ultima = g.dosis[0].fecha;
        return g;
      }).sort(function (a, b) { return b.ultima.localeCompare(a.ultima) || a.vacuna.localeCompare(b.vacuna); });
    })();
    var nDosis = vacunas.reduce(function (n, g) { return n + g.dosis.length; }, 0);

    var profesionales = (function () {
      var map = {};
      docs.forEach(function (d) {
        if (!d.profesional) return;
        var p = map[d.profesional] || (map[d.profesional] = { nombre: d.profesional, esp: {}, prest: {}, n: 0, ultima: '' });
        p.n += 1;
        if (d.especialidad) p.esp[d.especialidad] = (p.esp[d.especialidad] || 0) + 1;
        if (d.prestador) p.prest[d.prestador] = 1;
        if (d.fecha > p.ultima) p.ultima = d.fecha;
      });
      return Object.keys(map).map(function (k) { return map[k]; })
        .sort(function (a, b) { return b.n - a.n || b.ultima.localeCompare(a.ultima); });
    })();
    var porFecha = docs.slice().sort(function (a, b) {
      return (b.fecha || '').localeCompare(a.fecha || '') || a._i - b._i;
    });

    function countBy(key) {
      var c = {};
      docs.forEach(function (d) {
        var k = key(d);
        if (k) c[k] = (c[k] || 0) + 1;
      });
      return c;
    }
    function byCount(c) { return Object.keys(c).sort(function (a, b) { return c[b] - c[a] || a.localeCompare(b); }); }
    var catCount = countBy(function (d) { return d.categoria; });
    var yearCount = countBy(function (d) { var p = parseFecha(d.fecha); return p ? String(p.y) : null; });
    var prestCount = countBy(function (d) { return d.prestador; });
    var espCount = countBy(function (d) { return d.especialidad; });
    var cats = byCount(catCount);
    var prests = byCount(prestCount);
    var esps = byCount(espCount);
    var years = Object.keys(yearCount).sort().reverse();
    var conFecha = porFecha.filter(function (d) { return parseFecha(d.fecha); });
    var periodo = conFecha.length
      ? parseFecha(conFecha[conFecha.length - 1].fecha).y + '–' + parseFecha(conFecha[0].fecha).y
      : '—';
    var errors = (data.errors || []).map(function (e) { return N ? N.normalizeError(e) : e; });

    // ---- Seguimiento: favoritos, notas, consulta, nuevos y repetidos -------
    // Se guardan solo en este navegador (localStorage), por id de documento.
    // Si el navegador no deja guardar, todo funciona igual durante la sesión.
    var store = {
      get: function (k, def) {
        try { var v = window.localStorage.getItem('hcd:' + k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
      },
      set: function (k, v) {
        try { window.localStorage.setItem('hcd:' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ }
      }
    };
    // Favoritos, notas y consulta van por persona: dos historias de la familia
    // pueden tener documentos con el mismo id. La huella usa los 10 documentos
    // más antiguos, que no cambian entre una descarga y la siguiente.
    var persona = (function () {
      var ids = docs.slice().sort(function (a, b) { return (a.fecha || '').localeCompare(b.fecha || '') || a.id.localeCompare(b.id); })
        .slice(0, 10).map(function (d) { return d.id; }).join('|');
      var x = 5381;
      for (var i = 0; i < ids.length; i++) x = ((x << 5) + x + ids.charCodeAt(i)) | 0;
      return 'p' + (x >>> 0).toString(36);
    })();
    var favs = store.get(persona + ':favs', {});
    var notas = store.get(persona + ':notas', {});
    var consulta = store.get(persona + ':consulta', []).filter(function (id) { return byId[id]; });
    var conResumen = store.get('consulta-resumen', true);

    // Qué hay de nuevo: contra la descarga anterior de la misma historia
    // (la que comparte al menos un 30% de sus documentos con esta).
    var nuevos = (function () {
      var clave = data.exportId || data.exportedAt || '';
      var hist = store.get('historial', []);
      var actual = {};
      docs.forEach(function (d) { actual[d.id] = 1; });
      var prev = null;
      var mejor = 0;
      hist.forEach(function (x) {
        if (x.exportId === clave || !x.ids || !x.ids.length || !(x.at < (data.exportedAt || ''))) return;
        var comunes = x.ids.filter(function (id) { return actual[id]; }).length;
        if (comunes / x.ids.length >= 0.3 && comunes > mejor) { mejor = comunes; prev = x; }
      });
      hist = hist.filter(function (x) { return x.exportId !== clave; });
      hist.push({ exportId: clave, at: data.exportedAt || '', ids: Object.keys(actual) });
      hist.sort(function (a, b) { return (a.at || '').localeCompare(b.at || ''); });
      store.set('historial', hist.slice(-6));
      if (!prev) return { desde: null, ids: {}, n: 0 };
      var antes = {};
      prev.ids.forEach(function (id) { antes[id] = 1; });
      var ids = {};
      var n = 0;
      docs.forEach(function (d) { if (!antes[d.id]) { ids[d.id] = 1; n += 1; } });
      return { desde: prev.at, ids: ids, n: n };
    })();

    // Repetidos: misma fecha, mismo título y mismo texto que otro documento.
    var repetidos = (function () {
      function hash(t) { var x = 5381; for (var i = 0; i < t.length; i++) x = ((x << 5) + x + t.charCodeAt(i)) | 0; return x; }
      var primero = {};
      var out = {};
      docs.slice().sort(function (a, b) { return a._i - b._i; }).forEach(function (d) {
        if (d.pdf || d.text.length < 50) return;
        var k = d.fecha + '|' + norm(titulo(d)) + '|' + hash(d.text);
        if (primero[k]) out[d.id] = primero[k]; else primero[k] = d;
      });
      return out;
    })();
    var nRepetidos = Object.keys(repetidos).length;

    function guardarSeguimiento() {
      store.set(persona + ':favs', favs);
      store.set(persona + ':notas', notas);
      store.set(persona + ':consulta', consulta);
      store.set('consulta-resumen', conResumen);
    }
    var totals = data.totals || {};

    // ---- Estado ----------------------------------------------------------

    var state = { view: 'resumen', q: '', cat: '', year: '', prest: '', esp: '', asc: false, sel: null, filters: false,
      fav: false, nuevos: false, ocultarRep: false };
    var visible = [];

    // Siglas que aparecen en la historia, con cuántos documentos las usan.
    var siglas = (function () {
      if (!G) return [];
      var porDoc = {};
      docs.forEach(function (d) {
        var c = G.contar([d.titulo, d.tipo, d.text].concat(d.diagnosticos || [], d.medicamentos || []).join(' \n '));
        Object.keys(c).forEach(function (k) { (porDoc[k] = porDoc[k] || []).push(d); });
      });
      return Object.keys(porDoc).map(function (k) { return { sigla: k, significado: G.SIGLAS[k], docs: porDoc[k] }; })
        .sort(function (a, b) { return b.docs.length - a.docs.length || a.sigla.localeCompare(b.sigla); });
    })();

    // Vocabulario para "¿Quisiste decir…?" (se arma la primera vez que hace falta).
    var vocab = null;
    function vocabulario() {
      if (vocab) return vocab;
      vocab = {};
      docs.forEach(function (d) {
        (d._hay.match(/[a-z0-9ñ]{4,}/g) || []).forEach(function (w) { vocab[w] = (vocab[w] || 0) + 1; });
      });
      return vocab;
    }

    var PANELES = { vacunas: 1, diagnosticos: 1, medicamentos: 1, equipo: 1, siglas: 1, consulta: 1, ips: 1 };
    var ips = null;
    var ipsError = '';
    function enPanel() { return PANELES[state.view] && !state.sel; }

    /** Variantes de la búsqueda con sinónimos (HTA ↔ hipertensión arterial). */
    function variantes() {
      if (!state.q.trim()) return [];
      return G ? G.variantes(state.q) : [norm(state.q).split(/\s+/).filter(Boolean)];
    }
    /** Todos los términos buscados (para resaltar), incluidos los sinónimos. */
    function terms() {
      var vistos = {};
      return [].concat.apply([], variantes()).filter(function (t) { return !vistos[t] && (vistos[t] = true); });
    }
    function filtered() { return Boolean(state.q || state.cat || state.year || state.prest || state.esp || state.fav || state.nuevos || state.ocultarRep); }

    /** ¿El documento contiene todos los términos de alguna variante de la búsqueda? */
    function coincide(d, vs) {
      return vs.some(function (ts) {
        var hay = notas[d.id] ? d._hay + ' \n ' + norm(notas[d.id]) : d._hay;
        for (var i = 0; i < ts.length; i++) if (hay.indexOf(ts[i]) === -1) return false;
        return true;
      });
    }

    function filtrar() {
      var vs = variantes();
      visible = docs.filter(function (d) {
        if (state.cat && d.categoria !== state.cat) return false;
        if (state.year) {
          var p = parseFecha(d.fecha);
          if (!p || String(p.y) !== state.year) return false;
        }
        if (state.prest && d.prestador !== state.prest) return false;
        if (state.esp && d.especialidad !== state.esp) return false;
        if (state.fav && !favs[d.id]) return false;
        if (state.nuevos && !nuevos.ids[d.id]) return false;
        if (state.ocultarRep && repetidos[d.id]) return false;
        if (!vs.length) return true;
        return coincide(d, vs);
      });
      visible.sort(function (a, b) {
        var c = (a.fecha || '').localeCompare(b.fecha || '') || a._i - b._i;
        return state.asc ? c : -c;
      });
    }

    // ---- Piezas ----------------------------------------------------------

    function tag(text, cls, icon, title) {
      return h('span', { class: 'tag' + (cls ? ' ' + cls : ''), title: title || null }, [icon ? ico(icon, 11) : null, text]);
    }

    function secIcon(c, small) {
      return h('div', { class: 'sec-icon' + (small ? ' sm' : ''), style: catVars(c) }, [ico(catMeta(c).icon, small ? 18 : 20)]);
    }

    function plainIcon(icon, fg, bg) {
      return h('div', { class: 'sec-icon', style: '--fg:' + fg + ';--bg:' + bg }, [ico(icon, 20)]);
    }

    function secHead(icon, title, sub, badge) {
      return h('div', { class: 'sec-head' }, [
        icon,
        h('div', null, [h('h2', { text: title }), sub ? h('p', { text: sub }) : null]),
        badge !== undefined ? h('span', { class: 'sec-badge', text: String(badge) }) : null
      ]);
    }

    /** Favorito, nuevo, en la consulta, repetido y nota, como marcas chicas en la lista. */
    function marcas(d) {
      var m = [
        favs[d.id] ? h('span', { class: 'mk mk-fav', title: 'Favorito' }, [ico('star', 11), 'Favorito']) : null,
        nuevos.ids[d.id] ? h('span', { class: 'mk mk-new' }, [ico('sparkle', 11), 'Nuevo']) : null,
        consulta.indexOf(d.id) !== -1 ? h('span', { class: 'mk' }, [ico('check', 11), 'Para la consulta']) : null,
        repetidos[d.id] ? h('span', { class: 'mk', title: 'Mismo contenido que otro documento del mismo día' }, ['Repetido']) : null,
        notas[d.id] ? h('span', { class: 'mk', title: notas[d.id] }, [ico('note', 11), 'Nota']) : null
      ].filter(Boolean);
      return m.length ? h('div', { class: 'marcas' }, m) : null;
    }

    function tlItem(d, ts, onclick) {
      var sub = [d.tipo && d.tipo !== titulo(d) ? d.tipo : null, d.prestador, d.profesional].filter(Boolean).join(' · ');
      var snip = ts ? snippet(d.text, ts) : null;
      return h('button', {
        class: 'tl-item', type: 'button', 'data-id': d.id, style: catVars(d.categoria),
        'aria-current': state.sel === d.id ? 'true' : 'false', onclick: onclick
      }, [
        h('div', { class: 'tl-meta' }, [
          h('span', { class: 'mono', text: fechaHora(d) }),
          h('span', { class: 'dot-sep', text: '·' }),
          h('span', { class: 'tl-cat' }, [ico(catMeta(d.categoria).icon, 12), d.categoria])
        ]),
        highlighted('div', 'tl-name', titulo(d), ts || [], d.pdf ? h('span', null, [' ', tag('PDF')]) : null),
        sub ? highlighted('div', 'tl-sub', sub, ts || []) : null,
        snip ? highlighted('div', 'tl-snip', snip, ts) : null,
        marcas(d)
      ]);
    }

    // ---- Barra lateral ---------------------------------------------------

    var navLinks = [];
    function navLink(label, icon, count, isCurrent, onclick) {
      var dinamico = typeof count === 'function';
      var nc = count !== null ? h('span', { class: 'nc', text: dinamico ? '' : String(count) }) : null;
      var b = h('button', { class: 'nav-link', type: 'button', onclick: onclick }, [
        h('span', { class: 'ni' }, [ico(icon, 16)]),
        label,
        nc
      ]);
      navLinks.push({ el: b, current: isCurrent, count: dinamico ? count : null, nc: nc });
      return b;
    }

    function sidebar() {
      var groupLabel = function (t) { return h('span', { class: 'nav-group-label', text: t }); };
      return h('aside', { class: 'nav', 'aria-label': 'Navegación' }, [
        h('div', { class: 'nav-brand' }, [
          h('div', { class: 'nav-brand-row' }, [
            h('div', { class: 'logo', text: 'HC' }),
            h('div', null, [
              h('div', { class: 'nav-name', text: 'Mi historia clínica' }),
              h('div', { class: 'nav-sub', text: 'Plataforma IPS' })
            ])
          ]),
          opts.personas && opts.personas.length > 1 ? h('label', { class: 'personas' }, [
            ico('users', 14),
            h('span', { class: 'visually-hidden', text: 'Historia de' }),
            (function () {
              var sel = h('select', { 'aria-label': 'Historia de', onchange: function () { opts.onPersona(+sel.value); } },
                opts.personas.map(function (p, i) { return h('option', { value: String(i), text: p.nombre }); }));
              opts.personas.forEach(function (p, i) { if (p.actual) sel.value = String(i); });
              return sel;
            })()
          ]) : null,
          h('div', { class: 'nav-meta' }, [
            h('div', { class: 'nav-meta-date', text: 'Descargada ' + fechaCorta((data.exportedAt || '').slice(0, 10)) }),
            h('div', { class: 'nav-meta-gen', text: plural(docs.length, 'documento', 'documentos') + ' · ' + periodo })
          ])
        ]),
        h('nav', { class: 'nav-links' }, [
          h('div', { class: 'nav-group' }, [
            groupLabel('Inicio'),
            navLink('Resumen', 'home', null,
              function () { return state.view === 'resumen' && !state.sel; },
              function () { go({ view: 'resumen', cat: '', prest: '', esp: '', year: '', q: '' }, null); }),
            navLink('Todos los documentos', 'file', docs.length,
              function () { return state.view === 'list' && !state.cat && !state.prest && !state.esp; },
              function () { go({ view: 'list', cat: '', prest: '', esp: '' }); })
          ]),
          h('div', { class: 'nav-group' }, [
            groupLabel('Plataforma IPS'),
            navLink('Mi Resumen del Paciente', 'ips', null,
              function () { return state.view === 'ips' && !state.sel; },
              function () { go({ view: 'ips' }, null); })
          ]),
          h('div', { class: 'nav-group' }, [
            groupLabel('Mi seguimiento'),
            navLink('Llevar a la consulta', 'print', function () { return consulta.length; },
              function () { return state.view === 'consulta' && !state.sel; },
              function () { go({ view: 'consulta' }, null); }),
            navLink('Favoritos', 'star', function () { return Object.keys(favs).length; },
              function () { return state.view === 'list' && state.fav; },
              function () { go({ view: 'list', fav: true, nuevos: false, cat: '', prest: '', esp: '' }); }),
            nuevos.desde && nuevos.n ? navLink('Nuevos', 'sparkle', nuevos.n,
              function () { return state.view === 'list' && state.nuevos; },
              function () { go({ view: 'list', nuevos: true, fav: false, cat: '', prest: '', esp: '' }); }) : null
          ]),
          h('div', { class: 'nav-group' }, [
            groupLabel('Lo esencial'),
            navLink('Vacunas', 'vacunas', nDosis || null,
              function () { return state.view === 'vacunas' && !state.sel; },
              function () { go({ view: 'vacunas' }, null); }),
            navLink('Diagnósticos', 'diag', diagnosticos.length || null,
              function () { return state.view === 'diagnosticos' && !state.sel; },
              function () { go({ view: 'diagnosticos' }, null); }),
            navLink('Medicamentos', 'pill', medicamentos.length || null,
              function () { return state.view === 'medicamentos' && !state.sel; },
              function () { go({ view: 'medicamentos' }, null); }),
            navLink('Siglas', 'abc', siglas.length || null,
              function () { return state.view === 'siglas' && !state.sel; },
              function () { go({ view: 'siglas' }, null); }),
            navLink('Médicos y prestadores', 'especialidad', profesionales.length || null,
              function () { return state.view === 'equipo' && !state.sel; },
              function () { go({ view: 'equipo' }, null); })
          ]),
          h('div', { class: 'nav-group' }, [groupLabel('Categorías')].concat(cats.map(function (c) {
            return navLink(c, catMeta(c).icon, catCount[c],
              function () { return state.view === 'list' && state.cat === c; },
              function () { go({ view: 'list', cat: c, prest: '', esp: '' }); });
          }))),
          esps.length ? h('div', { class: 'nav-group' }, [groupLabel('Especialidades')].concat(esps.slice(0, 8).map(function (e) {
            return navLink(e, 'especialidad', espCount[e],
              function () { return state.view === 'list' && state.esp === e; },
              function () { go({ view: 'list', esp: e, cat: '', prest: '' }); });
          }))) : null,
          prests.length ? h('div', { class: 'nav-group' }, [groupLabel('Prestadores')].concat(prests.map(function (p) {
            return navLink(p, 'building', prestCount[p],
              function () { return state.view === 'list' && state.prest === p; },
              function () { go({ view: 'list', prest: p, cat: '', esp: '' }); });
          }))) : null
        ]),
        h('div', { class: 'nav-foot' }, [
          h('div', { class: 'fontsize', role: 'group', 'aria-label': 'Tamaño de letra' }, [
            h('span', { text: 'Tamaño de letra' }),
            h('button', { type: 'button', 'aria-label': 'Achicar la letra', text: 'A−', onclick: function () { zoom(-1); } }),
            h('button', { type: 'button', 'aria-label': 'Agrandar la letra', text: 'A+', onclick: function () { zoom(1); } })
          ]),
          h('div', { class: 'offline' }, [ico('shield', 16), h('span', { text: opts.offlineText || 'Funciona sin internet. Nada sale de esta carpeta.' })]),
          opts.onReopen ? h('button', { class: 'nav-link nav-reopen', type: 'button', onclick: opts.onReopen },
            [h('span', { class: 'ni' }, [ico('file', 16)]), opts.reopenLabel || 'Abrir otro ZIP']) : null,
          origin('origin-dark', data)
        ])
      ]);
    }

    // ---- Resumen ---------------------------------------------------------

    function resumen() {
      var chip = function (v, l) { return h('div', { class: 'hero-chip' }, [h('b', { text: v }), h('span', { text: l })]); };
      var expected = Math.max(totals.expected || 0, docs.length + errors.length);
      var pct = expected ? Math.round((docs.length / expected) * 100) : 100;

      var bigInput = h('input', {
        type: 'search', placeholder: 'Buscar en toda la historia: hemoglobina, urología, vacuna…',
        'aria-label': 'Buscar en toda la historia', autocomplete: 'off', spellcheck: 'false'
      });
      bigInput.addEventListener('input', function () {
        var v = bigInput.value;
        bigInput.value = '';
        searchInput.value = v;
        go({ view: 'list', q: v });
        searchInput.focus();
      });
      resumenSearch = bigInput;

      var recientes = porFecha.slice(0, 5);
      var subHero = (data.patientName ? data.patientName + ' · ' : '') + 'Descargada de Mi HCD el ' +
        fechaCorta((data.exportedAt || '').slice(0, 10)) + '. Elegí un documento o buscá una palabra en toda la historia.';

      return h('div', { class: 'resumen' }, [h('div', { class: 'resumen-inner' }, [
        h('section', { class: 'hero' }, [
          h('div', { class: 'hero-tag' }, [ico('shield', 12), data.anonymized ? 'Copia local de Mi HCD · paquete anonimizado' : 'Copia local de Mi HCD']),
          h('h1', { text: 'Tu historia clínica' }),
          h('p', { class: 'hero-sub', text: subHero }),
          h('div', { class: 'hero-chips' }, [
            chip(String(docs.length), 'Documentos'),
            chip(periodo, 'Período'),
            chip(String(prests.length), prests.length === 1 ? 'Prestador' : 'Prestadores'),
            esps.length
              ? chip(String(esps.length), esps.length === 1 ? 'Especialidad' : 'Especialidades')
              : chip(String(cats.length), cats.length === 1 ? 'Categoría' : 'Categorías')
          ])
        ]),
        nuevos.desde && nuevos.n ? h('div', { class: 'novedades' }, [
          ico('sparkle', 18),
          h('span', null, [h('b', { text: plural(nuevos.n, 'documento nuevo', 'documentos nuevos') }),
            ' desde tu descarga del ' + fechaCorta(nuevos.desde.slice(0, 10)) + '.']),
          h('button', { class: 'btn', type: 'button', text: 'Ver los nuevos',
            onclick: function () { go({ view: 'list', nuevos: true, fav: false, cat: '', prest: '', esp: '' }); } })
        ]) : null,
        h('div', { class: 'covbar' }, [
          h('div', null, [
            h('div', { class: 'covbar-val', text: docs.length + ' de ' + expected }),
            h('div', { class: 'covbar-lab', text: 'Documentos descargados' })
          ]),
          h('div', { class: 'covbar-bar' }, [
            h('div', { class: 'covbar-track' }, [h('div', { class: 'covbar-fill', style: 'width:' + pct + '%' })]),
            h('div', { class: 'covbar-sub', text: errors.length
              ? plural(errors.length, 'documento no se pudo descargar', 'documentos no se pudieron descargar')
              : (docs.length < expected ? 'Descarga parcial' : 'Descarga completa') })
          ])
        ]),
        h('label', { class: 'search search-big' }, [ico('search', 18), bigInput, h('span', { class: 'kbd', text: '/' })]),
        h('section', { class: 'sec' }, [
          secHead(plainIcon('grid', '#0F4675', '#E8F1F9'), 'Lo esencial', 'Armado a partir de tus documentos, con link a cada uno'),
          h('div', { class: 'cat-grid' }, [
            ['vacunas', 'Vacunas', nDosis ? plural(nDosis, 'dosis', 'dosis') + ' · ' + plural(vacunas.length, 'vacuna', 'vacunas') : 'Sin historial legible'],
            ['diagnosticos', 'Diagnósticos', plural(diagnosticos.length, 'diagnóstico', 'diagnósticos')],
            ['medicamentos', 'Medicamentos', plural(medicamentos.length, 'medicamento', 'medicamentos')],
            ['equipo', 'Médicos y prestadores', plural(profesionales.length, 'profesional', 'profesionales') + ' · ' + plural(prests.length, 'prestador', 'prestadores')]
          ].map(function (c) {
            var m = PANEL_META[c[0]];
            return h('button', { class: 'cat-card', type: 'button', onclick: function () { go({ view: c[0] }, null); } }, [
              h('div', { class: 'sec-icon sm', style: '--fg:' + m.fg + ';--bg:' + m.bg }, [ico(m.icono, 18)]),
              h('div', { style: 'min-width:0' }, [h('b', { text: c[1] }), h('span', { text: c[2] })])
            ]);
          }))
        ]),
        h('section', { class: 'sec' }, [
          secHead(plainIcon('file', '#0F4675', '#E8F1F9'), 'Por categoría', 'Tipo de consulta o estudio, como lo clasifica Mi HCD',
            plural(cats.length, 'categoría', 'categorías')),
          h('div', { class: 'cat-grid' }, cats.map(function (c) {
            return h('button', { class: 'cat-card', type: 'button', onclick: function () { go({ view: 'list', cat: c, prest: '', esp: '' }); } }, [
              secIcon(c, true),
              h('div', { style: 'min-width:0' }, [h('b', { text: c }), h('span', { text: plural(catCount[c], 'documento', 'documentos') })])
            ]);
          }))
        ]),
        h('div', { class: 'two-col' }, [
          h('section', { class: 'sec' }, [
            secHead(plainIcon('calendar', '#0F4675', '#E8F1F9'), 'Más recientes', 'Los últimos documentos de tu historia', docs.length),
            h('div', { class: 'tl' }, recientes.map(function (d) {
              return tlItem(d, null, function () { select(d.id); });
            })),
            docs.length > recientes.length
              ? h('button', { class: 'see-all', type: 'button', text: 'Ver los ' + docs.length + ' documentos',
                onclick: function () { go({ view: 'list', cat: '', prest: '', esp: '' }); } })
              : null
          ]),
          errors.length ? h('section', { class: 'sec' }, [
            secHead(plainIcon('warn', '#6F5400', '#FFF5D6'), 'No se pudieron descargar', 'El portal no entregó estos documentos', errors.length),
            h('details', { class: 'fails' }, [
              h('summary', { text: 'Ver ' + plural(errors.length, 'documento', 'documentos') }),
              h('ul', null, errors.map(function (e) {
                return h('li', null, [
                  h('span', { class: 'mono', text: e.fecha ? fechaCorta(e.fecha) : 'Sin fecha' }),
                  ' · ' + [e.categoria, e.prestador, e.descripcion].filter(Boolean).join(' · ')
                ]);
              }))
            ]),
            h('p', { class: 'fails-note', text: 'Podés verlos en el portal Mi HCD o volver a ejecutar la descarga con la extensión.' })
          ]) : null
        ]),
        h('section', { class: 'ips-cta' }, [
          h('div', { class: 'logo', text: 'IPS' }),
          h('div', { class: 'ips-cta-text' }, [
            h('b', { text: 'Este visor es parte del proyecto Plataforma IPS' }),
            h('span', { text: 'Un proyecto de investigación de la Universidad ORT Uruguay que genera, a partir de la historia clínica, un Resumen Internacional del Paciente (IPS) con inteligencia artificial.' })
          ]),
          h('a', { class: 'btn', href: PLATFORM_URL, target: '_blank', rel: 'noopener noreferrer' }, [ico('external', 15), 'Conocer el proyecto'])
        ])
      ])]);
    }

    // ---- Vistas de "Lo esencial" ------------------------------------------

    var panelEl;
    var panelOrden = 'reciente';
    var AVISO = 'Armado automáticamente a partir de tus documentos. Ante cualquier duda, abrí el documento original o consultá a tu médico.';
    var PANEL_META = {
      vacunas: { titulo: 'Mi carné de vacunas', icono: 'vacunas', fg: '#065f46', bg: '#d1fae5' },
      diagnosticos: { titulo: 'Mis diagnósticos', icono: 'diag', fg: '#1e4f9c', bg: '#e8f0fb' },
      medicamentos: { titulo: 'Mis medicamentos', icono: 'pill', fg: '#166534', bg: '#e6f5ee' },
      equipo: { titulo: 'Mis médicos y prestadores', icono: 'especialidad', fg: '#0F4675', bg: '#E8F1F9' },
      siglas: { titulo: 'Siglas de tu historia', icono: 'abc', fg: '#3D2A94', bg: '#EEEAFB' },
      ips: { titulo: 'Mi Resumen del Paciente (IPS)', icono: 'ips', fg: '#3D2A94', bg: '#EEEAFB',
        desc: 'Lo generó la Plataforma IPS con inteligencia artificial a partir de tu historia. Puede tener errores: verificá cada dato en tus documentos.' },
      consulta: { titulo: 'Llevar a la consulta', icono: 'print', fg: '#0F4675', bg: '#E8F1F9',
        desc: 'Los documentos que elegiste, juntos en un solo documento para imprimir o guardar como PDF.' }
    };

    function docLink(d, texto) {
      return h('button', { class: 'doclink', type: 'button', onclick: function () { select(d.id); } }, [
        h('span', { class: 'mono', text: fechaCorta(d.fecha) }), ' ', texto || titulo(d)
      ]);
    }

    function vacio(texto) { return h('div', { class: 'empty', text: texto }); }

    function panelVacunas() {
      if (!vacunas.length) {
        var docsVac = docs.filter(function (d) { return d.categoria === 'Vacunas'; });
        return h('div', null, [
          vacio('Tus documentos no traen el historial de vacunas en un formato que el visor pueda leer.'),
          docsVac.length ? h('div', { class: 'doclinks' }, docsVac.map(function (d) { return docLink(d); })) : null
        ]);
      }
      return h('div', { class: 'vac-list' }, vacunas.map(function (g) {
        return h('section', { class: 'vac-card' }, [
          h('div', { class: 'vac-head' }, [
            h('h3', { text: g.vacuna }),
            h('span', { class: 'tag', text: plural(g.dosis.length, 'dosis', 'dosis') })
          ]),
          h('table', { class: 'vac-table' }, [
            h('thead', null, [h('tr', null, ['Fecha', 'Dosis', 'Vía', 'Vacunatorio', ''].map(function (t) { return h('th', { text: t }); }))]),
            h('tbody', null, g.dosis.map(function (x) {
              return h('tr', null, [
                h('td', { class: 'mono', text: fechaCorta(x.fecha) }),
                h('td', { text: x.dosis }),
                h('td', { text: x.via }),
                h('td', { text: x.vacunatorio }),
                h('td', { class: 'no-print' }, [h('button', { class: 'linkbtn', type: 'button', text: 'Ver documento',
                  onclick: function () { select(x.doc.id); } })])
              ]);
            }))
          ])
        ]);
      }));
    }

    function panelItems(lista, vacioTexto) {
      if (!lista.length) return vacio(vacioTexto);
      var orden = lista.slice().sort(panelOrden === 'frecuente'
        ? function (a, b) { return b.docs.length - a.docs.length || b.ultima.localeCompare(a.ultima); }
        : function (a, b) { return b.ultima.localeCompare(a.ultima) || b.docs.length - a.docs.length; });
      return h('div', null, [
        h('div', { class: 'panel-tools' }, [
          h('span', { class: 'caption', text: plural(lista.length, 'ítem', 'ítems') }),
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Orden' }, [['reciente', 'Más recientes'], ['frecuente', 'Más frecuentes']].map(function (o) {
            return h('button', { type: 'button', 'aria-pressed': panelOrden === o[0] ? 'true' : 'false', text: o[1],
              onclick: function () { panelOrden = o[0]; renderPanel(); } });
          }))
        ]),
        h('ul', { class: 'items' }, orden.map(function (g) {
          var rango = fechaCorta(g.primera) + (g.ultima !== g.primera ? ' – ' + fechaCorta(g.ultima) : '');
          return h('li', null, [h('details', null, [
            h('summary', null, [
              conSiglas('span', 'item-label', g.label),
              h('span', { class: 'item-meta' }, [
                h('span', { class: 'mono', text: rango }),
                h('span', { class: 'tag', text: plural(g.docs.length, 'documento', 'documentos') })
              ])
            ]),
            h('div', { class: 'doclinks' }, g.docs.slice().sort(function (a, b) { return b.fecha.localeCompare(a.fecha); })
              .map(function (d) { return docLink(d); }))
          ])]);
        }))
      ]);
    }

    function heatmap() {
      var counts = {};
      var max = 0;
      docs.forEach(function (d) {
        var p = parseFecha(d.fecha);
        if (!p) return;
        var k = p.y + '-' + p.m;
        counts[k] = (counts[k] || 0) + 1;
        if (counts[k] > max) max = counts[k];
      });
      var anios = years.slice().sort();
      return h('div', { class: 'heat-wrap' }, [h('table', { class: 'heat' }, [
        h('thead', null, [h('tr', null, [h('th', { text: '' })].concat(MESES.map(function (m) {
          return h('th', { text: m.slice(0, 3) });
        })).concat([h('th', { text: 'Total' })]))]),
        h('tbody', null, anios.map(function (y) {
          return h('tr', null, [h('th', null, [h('button', { class: 'linkbtn', type: 'button', text: y,
            onclick: function () { go({ view: 'list', year: y, cat: '', prest: '', esp: '', q: '' }); } })])]
            .concat(MESES.map(function (m, i) {
              var n = counts[y + '-' + (i + 1)] || 0;
              var nivel = n ? Math.min(4, Math.ceil((n / max) * 4)) : 0;
              return h('td', { class: 'heat-' + nivel, title: n ? plural(n, 'documento', 'documentos') + ' en ' + m + ' ' + y : '' },
                [n ? String(n) : '']);
            }))
            .concat([h('td', { class: 'heat-total', text: String(yearCount[y] || 0) })]));
        }))
      ])]);
    }

    function panelEquipo() {
      return h('div', null, [
        h('h3', { class: 'panel-sub', text: 'Consultas por mes' }),
        heatmap(),
        h('h3', { class: 'panel-sub', text: 'Profesionales' }),
        profesionales.length ? h('div', { class: 'tbl-wrap' }, [h('table', { class: 'tbl' }, [
          h('thead', null, [h('tr', null, ['Profesional', 'Especialidad', 'Prestador', 'Documentos', 'Último'].map(function (t) {
            return h('th', { text: t });
          }))]),
          h('tbody', null, profesionales.map(function (p) {
            var esp = Object.keys(p.esp).sort(function (a, b) { return p.esp[b] - p.esp[a]; });
            return h('tr', null, [
              h('td', null, [h('button', { class: 'linkbtn', type: 'button', text: p.nombre,
                onclick: function () { searchInput.value = p.nombre; go({ view: 'list', q: p.nombre, cat: '', prest: '', esp: '', year: '' }); } })]),
              h('td', { text: esp.slice(0, 2).join(', ') }),
              h('td', { text: Object.keys(p.prest).join(', ') }),
              h('td', { class: 'num', text: String(p.n) }),
              h('td', { class: 'mono', text: fechaCorta(p.ultima) })
            ]);
          }))
        ])]) : vacio('Los documentos no indican profesionales.'),
        h('h3', { class: 'panel-sub', text: 'Prestadores' }),
        h('div', { class: 'cat-grid' }, prests.map(function (p) {
          var nombre = '';
          docs.some(function (d) { if (d.prestador === p && d.prestadorNombre) { nombre = d.prestadorNombre; return true; } return false; });
          return h('button', { class: 'cat-card', type: 'button', title: nombre || null,
            onclick: function () { go({ view: 'list', prest: p, cat: '', esp: '' }); } }, [
            h('div', { class: 'sec-icon sm', style: '--fg:#0F4675;--bg:#E8F1F9' }, [ico('building', 18)]),
            h('div', { style: 'min-width:0' }, [h('b', { text: p }), h('span', { text: plural(prestCount[p], 'documento', 'documentos') })])
          ]);
        }))
      ]);
    }

    function panelSiglas() {
      if (!siglas.length) return vacio('No encontramos siglas conocidas en tus documentos.');
      return h('div', null, [
        h('p', { class: 'panel-note', text: 'Siglas médicas frecuentes que aparecen en tus documentos. En la lista y en los títulos, al pasar el mouse sobre una sigla subrayada se ve su significado.' }),
        h('div', { class: 'tbl-wrap' }, [h('table', { class: 'tbl' }, [
          h('thead', null, [h('tr', null, ['Sigla', 'Significado', 'Documentos'].map(function (t) { return h('th', { text: t }); }))]),
          h('tbody', null, siglas.map(function (x) {
            return h('tr', null, [
              h('td', null, [h('button', { class: 'linkbtn sigla-btn', type: 'button', text: x.sigla,
                onclick: function () { searchInput.value = x.sigla; go({ view: 'list', q: x.sigla, cat: '', prest: '', esp: '', year: '' }); } })]),
              h('td', { text: x.significado }),
              h('td', { class: 'num', text: String(x.docs.length) })
            ]);
          }))
        ])])
      ]);
    }

    // ---- Mi Resumen del Paciente (IPS) -------------------------------------

    var ipsInput = h('input', { type: 'file', accept: '.json,application/json,application/fhir+json', class: 'visually-hidden', 'aria-hidden': 'true' });
    ipsInput.addEventListener('change', function () {
      var f = ipsInput.files && ipsInput.files[0];
      ipsInput.value = '';
      if (f) cargarIpsArchivo(f);
    });

    function abrirIps() { ipsInput.click(); }

    /** Fechas del IPS, que pueden ser parciales: "2019" o "2019-03". */
    function fechaIps(f) {
      if (/^\d{4}-\d{2}-\d{2}/.test(f)) return fechaCorta(f);
      var m = /^(\d{4})-(\d{2})$/.exec(f);
      if (m) return m[2] + '/' + m[1];
      return /^\d{4}$/.test(f) ? f : '';
    }

    function cargarIpsArchivo(f) {
      var r = new FileReader();
      r.onload = function () {
        try { cargarIps(JSON.parse(String(r.result))); } catch (e) {
          ipsError = e instanceof SyntaxError ? 'El archivo no es un JSON válido. Elegí el ips-fhir.json que descargaste de la Plataforma IPS.' : (e.message || String(e));
          go({ view: 'ips' }, null);
        }
      };
      r.onerror = function () { ipsError = 'No se pudo leer el archivo.'; go({ view: 'ips' }, null); };
      r.readAsText(f);
    }

    function cargarIps(bundle) {
      ipsError = '';
      ips = window.HCDIps.leer(bundle);
      go({ view: 'ips' }, null);
    }

    /** Palabras clave de un ítem del IPS para buscarlo en la historia (las dos primeras significativas). */
    var VACIAS = { de: 1, del: 1, la: 1, las: 1, los: 1, el: 1, en: 1, con: 1, sin: 1, por: 1, para: 1, tipo: 1, mg: 1, comprimido: 1, comprimidos: 1 };
    function claves(nombre) {
      return norm(nombre).replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/)
        .filter(function (w) { return w.length >= 4 && !VACIAS[w] && !/^\d/.test(w); }).slice(0, 2).join(' ');
    }

    function panelIps() {
      if (!ips) {
        return h('div', null, [
          ipsError ? h('div', { class: 'consulta-aviso', text: ipsError }) : null,
          h('p', { class: 'panel-note', text: 'Si participaste en el estudio de la Plataforma IPS, podés descargar tu Resumen del Paciente en formato FHIR («Descargar FHIR», archivo ips-fhir.json) y abrirlo acá para verlo junto a tu historia.' }),
          h('button', { class: 'btn primary', type: 'button', onclick: abrirIps }, [ico('ips', 15), 'Abrir mi IPS (ips-fhir.json)']),
          h('p', { class: 'nota-hint', text: 'El archivo se lee en este navegador y no se guarda.' })
        ]);
      }
      return h('div', null, [
        h('div', { class: 'ips-meta' }, [
          h('b', { text: ips.titulo }),
          h('span', { text: [ips.fecha ? 'Generado el ' + fechaCorta(ips.fecha) : '', ips.autor].filter(Boolean).join(' · ') }),
          h('button', { class: 'linkbtn', type: 'button', text: 'Abrir otro', onclick: abrirIps })
        ]),
        h('div', { class: 'ips-secs' }, ips.secciones.map(function (sec) {
          return h('section', { class: 'vac-card' }, [
            h('div', { class: 'vac-head ips-head' }, [h('h3', { text: sec.titulo }), h('span', { class: 'tag', text: String(sec.items.length) })]),
            sec.items.length ? h('ul', { class: 'ips-items' }, sec.items.map(function (it) {
              var q = claves(it.nombre);
              var n = q ? docs.filter(function (d) { return coincide(d, G ? G.variantes(q) : [q.split(' ')]); }).length : 0;
              return h('li', null, [
                h('div', { class: 'ips-item-main' }, [
                  conSiglas('span', 'item-label', it.nombre),
                  it.fecha ? h('span', { class: 'mono', text: fechaIps(it.fecha) }) : null,
                  it.estado ? tag(it.estado) : null
                ]),
                it.detalle.length ? h('div', { class: 'ips-item-det', text: it.detalle.join(' · ') }) : null,
                n ? h('button', { class: 'linkbtn ips-link', type: 'button',
                  text: 'En tu historia: ' + plural(n, 'documento', 'documentos'),
                  onclick: function () { searchInput.value = q; go({ view: 'list', q: q, cat: '', prest: '', esp: '', year: '', fav: false, nuevos: false }); } })
                  : h('span', { class: 'ips-none', text: 'No se encontró en el texto de tu historia' })
              ]);
            })) : h('div', { class: 'empty', text: 'Sin datos en esta sección.' })
          ]);
        }))
      ]);
    }

    function docsConsulta() {
      return consulta.map(function (id) { return byId[id]; }).filter(Boolean)
        .sort(function (a, b) { return (a.fecha || '').localeCompare(b.fecha || '') || a._i - b._i; });
    }

    function imprimirConsulta() {
      var sel = docsConsulta();
      if (!sel.length || !window.HCDDossier) return;
      var recientes = function (lista, max) {
        return lista.slice().sort(function (a, b) { return b.ultima.localeCompare(a.ultima); }).slice(0, max)
          .map(function (g) { return g.label + ' (' + fechaCorta(g.ultima) + ')'; });
      };
      var html = window.HCDDossier.armar({
        docs: sel.map(function (d) {
          return { fecha: d.fecha, hora: d.hora, titulo: titulo(d), categoria: d.categoria, prestador: d.prestador,
            profesional: d.profesional, html: d._html, pdf: Boolean(d.pdf) };
        }),
        paciente: data.patientName || '',
        descargada: (data.exportedAt || '').slice(0, 10),
        resumen: conResumen ? {
          diagnosticos: recientes(diagnosticos, 30),
          medicamentos: recientes(medicamentos, 30),
          vacunas: vacunas.map(function (g) { return g.vacuna + ' (última dosis ' + fechaCorta(g.ultima) + ')'; })
        } : null
      });
      var w = window.open('', '_blank');
      if (!w) {
        panelEl.querySelector('.consulta-aviso').textContent = 'El navegador bloqueó la ventana nueva. Permití las ventanas emergentes para este archivo y probá de nuevo.';
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(function () { w.print(); }, 300);
    }

    function panelConsulta() {
      var sel = docsConsulta();
      if (!sel.length) {
        return h('div', null, [
          vacio('Todavía no elegiste documentos.'),
          h('p', { class: 'panel-note', text: 'Abrí un documento y tocá «Agregar a la consulta». Después, desde acá, los imprimís juntos o los guardás como un solo PDF para llevarle a tu médico.' })
        ]);
      }
      var check = h('input', { type: 'checkbox', id: 'consulta-resumen' });
      check.checked = conResumen;
      check.addEventListener('change', function () { conResumen = check.checked; guardarSeguimiento(); });
      return h('div', null, [
        h('p', { class: 'panel-note', text: 'Se arma un documento con una portada, los documentos elegidos (uno por página) y, si querés, un resumen. Para guardarlo como PDF, elegí «Guardar como PDF» en el diálogo de impresión.' }),
        h('div', { class: 'consulta-tools' }, [
          h('label', { class: 'check' }, [check, ' Incluir un resumen de diagnósticos, medicamentos y vacunas']),
          h('button', { class: 'btn primary', type: 'button', onclick: imprimirConsulta }, [ico('print', 15), 'Imprimir o guardar como PDF'])
        ]),
        h('div', { class: 'consulta-aviso', role: 'status' }),
        h('ul', { class: 'items' }, sel.map(function (d) {
          return h('li', { class: 'consulta-item' }, [
            h('button', { class: 'doclink', type: 'button', onclick: function () { select(d.id); } }, [
              h('span', { class: 'mono', text: fechaCorta(d.fecha) }), ' ', titulo(d)
            ]),
            h('span', { class: 'item-meta' }, [d.prestador ? tag(d.prestador, 'brand') : null, d.pdf ? tag('PDF') : null]),
            h('button', { class: 'linkbtn', type: 'button', text: 'Quitar', onclick: function () {
              consulta = consulta.filter(function (id) { return id !== d.id; });
              guardarSeguimiento();
              renderPanel();
              render();
            } })
          ]);
        }))
      ]);
    }

    function renderPanel() {
      if (!panelEl) return;
      panelEl.textContent = '';
      var meta = PANEL_META[state.view];
      if (!meta) return;
      var cuerpo, badge;
      if (state.view === 'vacunas') { cuerpo = panelVacunas(); badge = plural(nDosis, 'dosis', 'dosis'); }
      else if (state.view === 'diagnosticos') { cuerpo = panelItems(diagnosticos, 'Tus documentos no traen diagnósticos en un formato que el visor pueda leer.'); badge = diagnosticos.length; }
      else if (state.view === 'medicamentos') { cuerpo = panelItems(medicamentos, 'Tus documentos no traen medicamentos indicados en un formato que el visor pueda leer.'); badge = medicamentos.length; }
      else if (state.view === 'siglas') { cuerpo = panelSiglas(); badge = plural(siglas.length, 'sigla', 'siglas'); }
      else if (state.view === 'consulta') { cuerpo = panelConsulta(); badge = plural(consulta.length, 'documento', 'documentos'); }
      else if (state.view === 'ips') { cuerpo = panelIps(); badge = ips ? plural(ips.secciones.length, 'sección', 'secciones') : '—'; }
      else { cuerpo = panelEquipo(); badge = plural(profesionales.length, 'profesional', 'profesionales'); }
      panelEl.appendChild(h('div', { class: 'resumen-inner' }, [
        h('button', { class: 'linkbtn panel-back', type: 'button', onclick: function () { go({ view: 'resumen' }, null); } }, ['← Resumen']),
        h('div', { class: 'print-only print-head', text: 'Mi historia clínica' + (data.patientName ? ' · ' + data.patientName : '') +
          ' · descargada de Mi HCD el ' + fechaCorta((data.exportedAt || '').slice(0, 10)) }),
        h('section', { class: 'sec' }, [
          h('div', { class: 'sec-head' }, [
            plainIcon(meta.icono, meta.fg, meta.bg),
            h('div', null, [h('h2', { text: meta.titulo }), h('p', { text: meta.desc || AVISO })]),
            h('span', { class: 'sec-badge', text: String(badge) }),
            state.view === 'vacunas' && vacunas.length ? h('button', { class: 'btn no-print', type: 'button', onclick: function () { window.print(); } },
              [ico('print', 15), 'Imprimir carné']) : null
          ]),
          cuerpo
        ])
      ]));
      panelEl.scrollTop = 0;
      panelEl.setAttribute('data-view', state.view + panelOrden);
    }

    // ---- Barra de búsqueda, filtros y lista -------------------------------

    var searchInput, resumenSearch, yearSel, prestSel, espSel, chipsEl, listEl, resultsHead, docEl, mtopEl, appEl;

    function toolbar() {
      searchInput = h('input', {
        type: 'search', placeholder: 'Buscar en toda la historia', 'aria-label': 'Buscar en toda la historia',
        autocomplete: 'off', spellcheck: 'false'
      });
      var timer;
      searchInput.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () { go({ view: 'list', q: searchInput.value }); }, 120);
      });
      var clear = h('button', {
        class: 'search-clear', type: 'button', 'aria-label': 'Borrar búsqueda',
        onclick: function () { searchInput.value = ''; go({ q: '' }); searchInput.focus(); }
      }, [ico('close', 12)]);
      clear.hidden = true;
      searchInput._clear = clear;

      yearSel = h('select', { 'aria-label': 'Año', onchange: function () { go({ view: 'list', year: yearSel.value }); } },
        [h('option', { value: '', text: 'Todos' })].concat(years.map(function (y) {
          return h('option', { value: y, text: y + ' (' + yearCount[y] + ')' });
        })));
      prestSel = h('select', { 'aria-label': 'Prestador', onchange: function () { go({ view: 'list', prest: prestSel.value }); } },
        [h('option', { value: '', text: 'Todos' })].concat(prests.map(function (p) {
          return h('option', { value: p, text: p + ' (' + prestCount[p] + ')' });
        })));

      espSel = h('select', { 'aria-label': 'Especialidad', onchange: function () { go({ view: 'list', esp: espSel.value }); } },
        [h('option', { value: '', text: 'Todas' })].concat(esps.slice().sort(function (a, b) { return a.localeCompare(b); }).map(function (e) {
          return h('option', { value: e, text: e + ' (' + espCount[e] + ')' });
        })));

      return h('div', { class: 'toolbar' }, [
        h('label', { class: 'search' }, [ico('search', 16), searchInput, clear, h('span', { class: 'kbd', text: '/' })]),
        h('label', { class: 'sel' }, [h('span', { text: 'Año' }), yearSel]),
        esps.length ? h('label', { class: 'sel' }, [h('span', { text: 'Especialidad' }), espSel]) : null,
        h('label', { class: 'sel' }, [h('span', { text: 'Prestador' }), prestSel])
      ]);
    }

    function chips() {
      chipsEl = h('div', { class: 'mchips', role: 'group', 'aria-label': 'Categorías' },
        [''].concat(cats).map(function (c) {
          return h('button', {
            class: 'chip', type: 'button', 'data-cat': c,
            onclick: function () { go({ view: 'list', cat: c }); }
          }, [c ? c + ' · ' + catCount[c] : 'Todas']);
        }));
      return chipsEl;
    }

    function renderList() {
      var ts = terms();
      resultsHead.textContent = '';
      resultsHead.appendChild(h('span', { class: 'caption', text: filtered()
        ? plural(visible.length, 'resultado', 'resultados') + ' de ' + docs.length
        : plural(docs.length, 'documento', 'documentos') }));
      resultsHead.appendChild(h('span', { style: 'display:flex;gap:12px;align-items:center' }, [
        filtered() ? h('button', { class: 'linkbtn', type: 'button', text: 'Limpiar',
          onclick: function () { searchInput.value = ''; go({ q: '', cat: '', year: '', prest: '', esp: '', fav: false, nuevos: false, ocultarRep: false }); } }) : null,
        nRepetidos ? h('button', { class: 'linkbtn', type: 'button', 'aria-pressed': state.ocultarRep ? 'true' : 'false',
          text: state.ocultarRep ? 'Mostrar repetidos' : 'Ocultar repetidos (' + nRepetidos + ')',
          onclick: function () { go({ ocultarRep: !state.ocultarRep }); } }) : null,
        h('button', { class: 'linkbtn', type: 'button', text: state.asc ? 'Más antiguos primero' : 'Más recientes primero',
          onclick: function () { go({ asc: !state.asc }); } }),
        h('button', { class: 'mfilter', type: 'button', 'aria-expanded': state.filters ? 'true' : 'false',
          onclick: function () { go({ filters: !state.filters }); } }, [ico('filter', 14), 'Filtros'])
      ]));

      listEl.textContent = '';
      var vs = variantes();
      if (vs.length > 1 && visible.length) {
        listEl.appendChild(h('div', { class: 'synonyms', text: 'También se buscó: ' + vs.slice(1).map(function (v) { return G ? G.mostrar(v) : v.join(' '); }).join(', ') }));
      }
      if (!visible.length) {
        var sug = state.q.trim() && G ? G.sugerir(norm(state.q).split(/\s+/).filter(Boolean), vocabulario()) : null;
        listEl.appendChild(h('div', { class: 'empty' }, [
          h('div', { text: 'No hay documentos que coincidan con la búsqueda y los filtros.' }),
          sug ? h('button', { class: 'linkbtn suggest', type: 'button', onclick: function () { searchInput.value = sug; go({ q: sug }); } },
            ['¿Quisiste decir «' + sug + '»?']) : null
        ]));
        return;
      }
      var frag = document.createDocumentFragment();
      var lastGroup = null;
      visible.forEach(function (d) {
        var p = parseFecha(d.fecha);
        var group = p ? MESES[p.m - 1] + ' ' + p.y : 'Sin fecha';
        if (group !== lastGroup) {
          frag.appendChild(h('div', { class: 'tl-group', text: group }));
          lastGroup = group;
        }
        frag.appendChild(tlItem(d, ts, function () { select(d.id); }));
      });
      listEl.appendChild(frag);
    }

    // ---- Documento --------------------------------------------------------

    var docShown;
    function renderDoc() {
      var d = state.sel && byId[state.sel];
      var idx = d ? visible.indexOf(d) : -1;
      if (docShown === d && d) {
        // Mismo documento: solo actualizamos anterior/siguiente.
        docEl.querySelector('[data-nav="prev"]').disabled = idx <= 0;
        docEl.querySelector('[data-nav="next"]').disabled = idx === -1 || idx >= visible.length - 1;
        return;
      }
      docShown = d;
      callar();
      docEl.textContent = '';
      if (!d) {
        docEl.appendChild(h('div', { class: 'doc-empty' }, [h('div', null, [
          ico('file', 28),
          h('b', { text: 'Elegí un documento de la lista' }),
          h('span', { text: 'Con ↑ y ↓ te movés entre documentos.' })
        ])]));
        return;
      }
      var srcInfo = source(d);
      var frameAttrs = { title: (d.pdf ? 'PDF: ' : '') + titulo(d) };
      for (var a in srcInfo.frame) frameAttrs[a] = srcInfo.frame[a];
      var frame = h('iframe', frameAttrs);
      if (srcInfo.srcdoc !== undefined) frame.srcdoc = srcInfo.srcdoc;
      docEl.appendChild(h('div', { class: 'doc-head' }, [
        secIcon(d.categoria),
        h('div', { class: 'doc-title' }, [h('div', null, [
          h('div', { class: 'doc-kicker', text: fechaHora(d) + ' · ' + d.categoria }),
          conSiglas('h1', '', titulo(d)),
          h('div', { class: 'doc-tags' }, [
            d.tipo && d.tipo !== titulo(d) ? tag(d.tipo) : null,
            d.prestador ? tag(d.prestador, 'brand', 'building', d.prestadorNombre) : null,
            d.profesional ? tag(d.profesional, null, 'especialidad') : null,
            d.pdf ? tag('PDF adjunto', null, 'file') : null
          ])
        ])]),
        h('div', { class: 'doc-actions' }, [
          h('button', { class: 'btn icon', type: 'button', 'data-nav': 'prev', 'aria-label': 'Documento anterior',
            title: 'Anterior (↑)', disabled: idx <= 0, onclick: function () { move(-1); } }, [ico('up', 15)]),
          h('button', { class: 'btn icon', type: 'button', 'data-nav': 'next', 'aria-label': 'Documento siguiente',
            title: 'Siguiente (↓)', disabled: idx === -1 || idx >= visible.length - 1, onclick: function () { move(1); } }, [ico('down', 15)]),
          h('button', { class: 'btn icon btn-fav', type: 'button', 'aria-pressed': favs[d.id] ? 'true' : 'false',
            'aria-label': 'Marcar como favorito', title: 'Favorito', onclick: function (ev) {
              if (favs[d.id]) delete favs[d.id]; else favs[d.id] = 1;
              ev.currentTarget.setAttribute('aria-pressed', favs[d.id] ? 'true' : 'false');
              guardarSeguimiento();
              render();
            } }, [ico('star', 15)]),
          h('button', { class: 'btn', type: 'button', 'data-consulta': '', 'aria-pressed': consulta.indexOf(d.id) !== -1 ? 'true' : 'false',
            onclick: function (ev) {
              var i = consulta.indexOf(d.id);
              if (i === -1) consulta.push(d.id); else consulta.splice(i, 1);
              var en = consulta.indexOf(d.id) !== -1;
              var b = ev.currentTarget;
              b.setAttribute('aria-pressed', en ? 'true' : 'false');
              b.textContent = '';
              b.appendChild(ico(en ? 'check' : 'plus', 15));
              b.appendChild(h('span', { class: 'long', text: en ? 'En la consulta' : 'Agregar a la consulta' }));
              guardarSeguimiento();
              render();
            } }, [ico(consulta.indexOf(d.id) !== -1 ? 'check' : 'plus', 15),
            h('span', { class: 'long', text: consulta.indexOf(d.id) !== -1 ? 'En la consulta' : 'Agregar a la consulta' })]),
          puedeLeer && d.text ? h('button', { class: 'btn', type: 'button', 'data-speak': '', onclick: function () { leer(d); } },
            [ico('speak', 15), h('span', { class: 'long', text: 'Escuchar' })]) : null,
          h('a', { class: 'btn primary', href: srcInfo.href, target: '_blank', rel: 'noopener noreferrer' }, [
            ico('external', 15),
            h('span', { class: 'long', text: 'Abrir en pestaña nueva' }),
            h('span', { class: 'short', text: d.pdf ? 'Abrir PDF' : 'Abrir documento' })
          ])
        ])
      ]));
      var resumenNota = h('span', { text: notas[d.id] ? 'Mi nota' : 'Agregar una nota' });
      var nota = h('textarea', { class: 'nota-input', rows: '2', placeholder: 'Por ejemplo: preguntarle al médico por este resultado', 'aria-label': 'Mi nota sobre este documento' });
      nota.value = notas[d.id] || '';
      var notaTimer;
      nota.addEventListener('input', function () {
        clearTimeout(notaTimer);
        notaTimer = setTimeout(function () {
          var v = nota.value.trim();
          if (v) notas[d.id] = v; else delete notas[d.id];
          resumenNota.textContent = v ? 'Mi nota' : 'Agregar una nota';
          guardarSeguimiento();
          renderList();
        }, 400);
      });
      var original = repetidos[d.id];
      docEl.appendChild(h('div', { class: 'doc-extra' }, [
        original ? h('div', { class: 'aviso-rep' }, ['Este documento repite el contenido de otro del mismo día. ',
          h('button', { class: 'linkbtn', type: 'button', text: 'Ver el original', onclick: function () { select(original.id); } })]) : null,
        h('details', { class: 'nota', open: notas[d.id] ? true : null }, [
          h('summary', null, [ico('note', 13), resumenNota]),
          nota,
          h('div', { class: 'nota-hint', text: 'Se guarda solo en este navegador. No modifica el documento.' })
        ])
      ]));
      docEl.appendChild(h('div', { class: 'frame-card' }, [
        h('div', { class: 'frame-bar' }, [ico('file', 13), h('span', { class: 'frame-label', text: 'Documento original (Mi HCD)' }),
          h('span', { class: 'path', text: srcInfo.label })]),
        frame
      ]));
      if (hint) docEl.appendChild(h('div', { class: 'hint', text: hint }));
    }

    function renderMtop() {
      var d = state.sel && byId[state.sel];
      mtopEl.textContent = '';
      if (d) {
        mtopEl.appendChild(h('button', { class: 'mback', type: 'button', 'aria-label': 'Volver a la lista',
          onclick: function () { if (history.state && history.state.hcd) history.back(); else select(null); } }, [ico('back', 18)]));
      } else {
        mtopEl.appendChild(h('div', { class: 'logo', text: 'HC' }));
      }
      mtopEl.appendChild(h('div', { class: 'mtop-text' }, [
        h('div', { class: 'mtop-title', text: d ? titulo(d) : 'Mi historia clínica' }),
        h('div', { class: 'mtop-sub', text: d ? fechaHora(d) + ' · ' + d.categoria : docs.length + ' docs · ' + periodo })
      ]));
      mtopEl.appendChild(h('button', { class: 'mback', type: 'button', 'aria-label': 'Cambiar el tamaño de letra', text: 'Aa',
        onclick: function () { zoom(zoomIdx >= ZOOMS.length - 1 ? -zoomIdx : 1); } }));
    }

    // ---- Accesibilidad: tamaño de letra y lectura en voz alta -------------

    var ZOOMS = [1, 1.15, 1.3, 1.5];
    var zoomIdx = 0;
    try { zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, +localStorage.getItem('hcd-zoom') || 0)); } catch (e) { zoomIdx = 0; }
    function aplicarZoom() { if (appEl) appEl.style.zoom = String(ZOOMS[zoomIdx]); }
    function zoom(delta) {
      zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, zoomIdx + delta));
      try { localStorage.setItem('hcd-zoom', String(zoomIdx)); } catch (e) { /* sin almacenamiento: vale solo por ahora */ }
      aplicarZoom();
    }

    // La voz es la del sistema operativo: funciona sin internet.
    var puedeLeer = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
    var leyendo = false;
    function botonLeer(activo) {
      var b = docEl.querySelector('[data-speak]');
      if (!b) return;
      b.textContent = '';
      b.appendChild(ico(activo ? 'stop' : 'speak', 15));
      b.appendChild(h('span', { class: 'long', text: activo ? 'Detener' : 'Escuchar' }));
      b.setAttribute('aria-pressed', activo ? 'true' : 'false');
    }
    function callar() {
      if (puedeLeer && leyendo) window.speechSynthesis.cancel();
      leyendo = false;
    }
    function leer(d) {
      if (!puedeLeer) return;
      if (leyendo) { callar(); botonLeer(false); return; }
      var texto = titulo(d) + '. ' + fechaCorta(d.fecha) + '. ' + d.text;
      // Las siglas se leen con su significado.
      if (G) texto = G.partes(texto).map(function (p) { return p.sigla ? p.title : p.text; }).join('');
      var u = new SpeechSynthesisUtterance(texto);
      u.lang = 'es-UY';
      var voces = window.speechSynthesis.getVoices() || [];
      var voz = voces.filter(function (v) { return /^es[-_]UY/i.test(v.lang); })[0] || voces.filter(function (v) { return /^es/i.test(v.lang); })[0];
      if (voz) u.voice = voz;
      u.onend = u.onerror = function () { leyendo = false; botonLeer(false); };
      leyendo = true;
      botonLeer(true);
      window.speechSynthesis.speak(u);
    }

    // ---- Render y navegación --------------------------------------------

    function render() {
      filtrar();
      appEl.classList.toggle('mode-resumen', state.view === 'resumen' && !state.sel);
      appEl.classList.toggle('mode-panel', Boolean(enPanel()));
      Array.prototype.forEach.call(mpanelsEl.children, function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-view') === state.view && !state.sel ? 'true' : 'false');
      });
      appEl.classList.toggle('reading', Boolean(state.sel));
      appEl.classList.toggle('show-filters', state.filters);
      navLinks.forEach(function (n) {
        n.el.setAttribute('aria-current', n.current() ? 'true' : 'false');
        if (n.count) { var c = n.count(); n.nc.textContent = c ? String(c) : ''; n.nc.hidden = !c; }
      });
      Array.prototype.forEach.call(chipsEl.children, function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-cat') === state.cat ? 'true' : 'false');
      });
      yearSel.value = state.year;
      prestSel.value = state.prest;
      espSel.value = state.esp;
      if (searchInput.value !== state.q) searchInput.value = state.q;
      searchInput._clear.hidden = !state.q;
      renderList();
      renderDoc();
      renderMtop();
      if (enPanel() && panelEl.getAttribute('data-view') !== state.view + panelOrden) {
        renderPanel();
        panelEl.setAttribute('data-view', state.view + panelOrden);
      }
      var cur = listEl.querySelector('.tl-item[aria-current="true"]');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }

    function go(patch, sel) {
      for (var k in patch) state[k] = patch[k];
      if (sel !== undefined) setSel(sel);
      render();
    }

    function setSel(id) {
      var next = id && byId[id] ? id : null;
      var hash = next ? '#doc=' + encodeURIComponent(next) : '';
      if (location.hash !== hash) {
        var url = hash || location.pathname + location.search;
        // Abrir un documento desde la lista apila una entrada: en el celular,
        // "atrás" vuelve a la lista en lugar de cerrar el visor.
        if (next && !state.sel) history.pushState({ hcd: true }, '', url);
        else history.replaceState(null, '', url);
      }
      state.sel = next;
      if (next) state.view = 'list';
    }

    function select(id) { go({}, id); }

    function move(delta) {
      if (!visible.length) return;
      var idx = state.sel ? visible.indexOf(byId[state.sel]) : -1;
      var next = idx === -1 ? 0 : Math.min(visible.length - 1, Math.max(0, idx + delta));
      select(visible[next].id);
    }

    function fromHash() {
      var m = /^#doc=(.+)$/.exec(location.hash);
      return m ? decodeURIComponent(m[1]) : null;
    }

    // ---- Arranque ----------------------------------------------------------

    listEl = h('div', { class: 'tl', role: 'list', 'aria-label': 'Documentos' });
    resultsHead = h('div', { class: 'results-head' });
    docEl = h('main', { class: 'doc', 'aria-label': 'Documento' });
    mtopEl = h('header', { class: 'mtop' });
    var bar = toolbar();
    var resumenEl = resumen();
    panelEl = h('div', { class: 'panel' });
    var mpanelsEl = h('div', { class: 'mpanels', role: 'group', 'aria-label': 'Lo esencial' },
      [['consulta', 'Consulta'], ['vacunas', 'Vacunas'], ['diagnosticos', 'Diagnósticos'], ['medicamentos', 'Medicamentos'], ['equipo', 'Médicos'], ['siglas', 'Siglas']].map(function (v) {
        return h('button', { class: 'chip chip-esencial', type: 'button', 'data-view': v[0],
          onclick: function () { go({ view: state.view === v[0] ? 'list' : v[0] }, null); } }, [ico(PANEL_META[v[0]].icono, 14), v[1]]);
      }));
    appEl = h('div', { class: 'app' }, [
      sidebar(),
      h('div', { class: 'content' }, [
        mtopEl,
        bar,
        mpanelsEl,
        chips(),
        h('div', { class: 'views' }, [
          resumenEl,
          panelEl,
          h('div', { class: 'split' }, [
            h('section', { class: 'results', 'aria-label': 'Resultados' }, [resultsHead, listEl]),
            docEl
          ])
        ]),
        h('footer', { class: 'foot' }, [
          h('strong', { text: 'Copia local de tu historia clínica descargada de Mi HCD.' }),
          h('span', { class: 'long', text: ' No se actualiza sola y no reemplaza a tu médico. ' }),
          h('span', { class: 'long' }, ['Generado con el Extractor de HCD · ',
            h('a', { href: PLATFORM_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Plataforma IPS' })])
        ])
      ])
    ]);
    root.appendChild(appEl);
    aplicarZoom();

    var inicial = fromHash();
    if (inicial && byId[inicial]) { state.sel = inicial; state.view = 'list'; }
    render();

    function onNav() {
      var id = fromHash();
      state.sel = id && byId[id] ? id : null;
      if (state.sel) state.view = 'list';
      render();
    }
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
    root.appendChild(ipsInput);

    document.addEventListener('keydown', onKey);
    function onKey(ev) {
      var tag = (ev.target && ev.target.tagName) || '';
      var typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (ev.key === '/' && !typing) {
        ev.preventDefault();
        (appEl.classList.contains('mode-resumen') && resumenSearch.offsetParent ? resumenSearch : searchInput).focus();
        return;
      }
      if (ev.key === 'Escape' && typing) { ev.target.blur(); return; }
      if (typing || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (ev.key === 'ArrowDown' || ev.key === 'j') { ev.preventDefault(); if (state.view === 'resumen') state.view = 'list'; move(1); }
      else if (ev.key === 'ArrowUp' || ev.key === 'k') { ev.preventDefault(); move(-1); }
    }

    // API para el cargador (visor suelto): desmontar al cambiar de persona y cargar un IPS.
    return {
      destroy: function () {
        callar();
        window.removeEventListener('popstate', onNav);
        window.removeEventListener('hashchange', onNav);
        document.removeEventListener('keydown', onKey);
        root.textContent = '';
      },
      cargarIps: cargarIps
    };
  }

  window.HCDViewer = { start: start, h: h, ico: ico, origin: origin };

  var embedded = document.getElementById('hcd-data');
  if (embedded) start(document.getElementById('app'), JSON.parse(embedded.textContent));
})();
