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
    especialidad: '<circle cx="10" cy="6.5" r="3"/><path d="M4.5 17a5.5 5.5 0 0 1 11 0"/>'
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

  function highlighted(tag, cls, s, terms, extra) {
    var el = h(tag, { class: cls });
    var pos = 0;
    matchRanges(s, terms).forEach(function (r) {
      if (r[0] > pos) el.appendChild(document.createTextNode(s.slice(pos, r[0])));
      el.appendChild(h('mark', { text: s.slice(r[0], r[1]) }));
      pos = r[1];
    });
    if (pos < s.length) el.appendChild(document.createTextNode(s.slice(pos)));
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
    var docs = data.documents.map(function (d, i) {
      if (N) N.normalizeDoc(d);
      d._i = i;
      d._hay = norm([d.categoria, d.titulo, d.descripcion, d.especialidad, d.tipo, d.prestador, d.prestadorNombre,
        d.profesional, fechaCorta(d.fecha), d.text].join(' \n '));
      return d;
    });
    if (N) N.unifyPrestadores(docs);
    var byId = {};
    docs.forEach(function (d) { byId[d.id] = d; });
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
    var totals = data.totals || {};

    // ---- Estado ----------------------------------------------------------

    var state = { view: 'resumen', q: '', cat: '', year: '', prest: '', esp: '', asc: false, sel: null, filters: false };
    var visible = [];

    function terms() { return norm(state.q).split(/\s+/).filter(Boolean); }
    function filtered() { return Boolean(state.q || state.cat || state.year || state.prest || state.esp); }

    function filtrar() {
      var ts = terms();
      visible = docs.filter(function (d) {
        if (state.cat && d.categoria !== state.cat) return false;
        if (state.year) {
          var p = parseFecha(d.fecha);
          if (!p || String(p.y) !== state.year) return false;
        }
        if (state.prest && d.prestador !== state.prest) return false;
        if (state.esp && d.especialidad !== state.esp) return false;
        for (var i = 0; i < ts.length; i++) if (d._hay.indexOf(ts[i]) === -1) return false;
        return true;
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
        snip ? highlighted('div', 'tl-snip', snip, ts) : null
      ]);
    }

    // ---- Barra lateral ---------------------------------------------------

    var navLinks = [];
    function navLink(label, icon, count, isCurrent, onclick) {
      var b = h('button', { class: 'nav-link', type: 'button', onclick: onclick }, [
        h('span', { class: 'ni' }, [ico(icon, 16)]),
        label,
        count !== null ? h('span', { class: 'nc', text: String(count) }) : null
      ]);
      navLinks.push({ el: b, current: isCurrent });
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
          h('div', { class: 'offline' }, [ico('shield', 16), h('span', { text: opts.offlineText || 'Funciona sin internet. Nada sale de esta carpeta.' })]),
          opts.onReopen ? h('button', { class: 'nav-link nav-reopen', type: 'button', onclick: opts.onReopen },
            [h('span', { class: 'ni' }, [ico('file', 16)]), 'Abrir otro ZIP']) : null,
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
          onclick: function () { searchInput.value = ''; go({ q: '', cat: '', year: '', prest: '', esp: '' }); } }) : null,
        h('button', { class: 'linkbtn', type: 'button', text: state.asc ? 'Más antiguos primero' : 'Más recientes primero',
          onclick: function () { go({ asc: !state.asc }); } }),
        h('button', { class: 'mfilter', type: 'button', 'aria-expanded': state.filters ? 'true' : 'false',
          onclick: function () { go({ filters: !state.filters }); } }, [ico('filter', 14), 'Filtros'])
      ]));

      listEl.textContent = '';
      if (!visible.length) {
        listEl.appendChild(h('div', { class: 'empty', text: 'No hay documentos que coincidan con la búsqueda y los filtros.' }));
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
          h('h1', { text: titulo(d) }),
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
          h('a', { class: 'btn primary', href: srcInfo.href, target: '_blank', rel: 'noopener noreferrer' }, [
            ico('external', 15),
            h('span', { class: 'long', text: 'Abrir en pestaña nueva' }),
            h('span', { class: 'short', text: d.pdf ? 'Abrir PDF' : 'Abrir documento' })
          ])
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
    }

    // ---- Render y navegación --------------------------------------------

    function render() {
      filtrar();
      appEl.classList.toggle('mode-resumen', state.view === 'resumen' && !state.sel);
      appEl.classList.toggle('reading', Boolean(state.sel));
      appEl.classList.toggle('show-filters', state.filters);
      navLinks.forEach(function (n) { n.el.setAttribute('aria-current', n.current() ? 'true' : 'false'); });
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
    appEl = h('div', { class: 'app' }, [
      sidebar(),
      h('div', { class: 'content' }, [
        mtopEl,
        bar,
        chips(),
        h('div', { class: 'views' }, [
          resumenEl,
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

    document.addEventListener('keydown', function (ev) {
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
    });
  }

  window.HCDViewer = { start: start, h: h, ico: ico, origin: origin };

  var embedded = document.getElementById('hcd-data');
  if (embedded) start(document.getElementById('app'), JSON.parse(embedded.textContent));
})();
