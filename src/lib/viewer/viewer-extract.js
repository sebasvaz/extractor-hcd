/*
 * Extracción de datos de cada documento HTML de Mi HCD, en el navegador.
 *
 * La usan el visor embebido (visor.html, con el HTML de cada documento en el
 * índice) y el visor suelto (visor-hc.html, que lo lee del ZIP). Devuelve:
 *  - text: texto visible para la búsqueda.
 *  - cda: título y los campos Prestador, Profesional y Fecha del evento del
 *    cabezal. Nunca Nombre, Documento, Fecha de nacimiento ni Sexo.
 *  - vacunas: dosis de las secciones "Historial de vacunas".
 *  - diagnosticos, medicamentos: ítems de esas secciones.
 *
 * Los prestadores arman las secciones de formas distintas (tablas con
 * encabezado, tablas clave-valor, listas, texto libre); los ítems se toman
 * con reglas tolerantes y el visor siempre enlaza al documento de origen.
 */
(function (root) {
  'use strict';

  var MAX_TEXT_CHARS = 30000;
  var MAX_ITEM_CHARS = 160;
  var CDA_LABELS = { prestador: 'prestador', profesional: 'profesional', 'fecha del evento': 'fechaHora' };

  // "Diagn�sticos" aparece en documentos con la codificación rota.
  var SEC_DIAG = /^diagn.?sticos(?! de complicaciones)/i;
  var SEC_MED = /prescripciones de medicamentos|tratamiento farmacol.?gico|medicaci.?n/i;
  var SEC_VAC = /^(historial de vacunas|historial de vacunaci.?n|vacunas)$/i;

  // Encabezados y metadatos que no son ítems.
  var NO_ITEM = /^(descripci.?n|estado|severidad|fecha( de)? (inicio|diagn.?stico|fin)|tipo|c.?digo|nombre|presentaci.?n|dosis|frecuencia|v.?a( de administraci.?n)?|duraci.?n|indicaciones?|observaciones?|cantidad|medicamento|f.?rmaco|clasificaci.?n|estado del problema|estado del diagn.?stico|severidad del problema)\b.{0,3}$/i;
  var ROTULO = /^[A-ZÁÉÍÓÚ][a-záéíóúñü ]{2,40}$/;
  var ROTULO_KV = /^(descripci|grado|fecha|estado|tipo|c.?digo|severidad|certeza|nombre|f.?rmaco|medicament)/i;
  var META = /^[^:]{2,40}:\s*(s.|no|si|-)?\s*$/i;
  var VACIO = /^(-|—|sin datos|no corresponde|n\/a|ninguno|ninguna|\.)?$/i;

  function clean(s) { return (s || '').replace(/[\s ]+/g, ' ').trim(); }
  function cut(s) { s = clean(s).replace(/[\s.;,:-]+$/, ''); return s.length > MAX_ITEM_CHARS ? s.slice(0, MAX_ITEM_CHARS - 1) + '…' : s; }

  /** Contenido de una sección: los hermanos que siguen al encabezado hasta el próximo encabezado. */
  function sectionNodes(heading) {
    var out = [];
    var el = heading.nextElementSibling;
    while (el && !/^H[1-3]$/.test(el.tagName) && !(el.querySelector && el.querySelector('h1,h2,h3'))) {
      out.push(el);
      el = el.nextElementSibling;
    }
    return out;
  }

  function headingText(h) { return clean(h.textContent); }

  /** Ítems de una tabla: con encabezado → primera columna; clave-valor → el valor del rótulo útil. */
  function tableItems(table) {
    // Filas de encabezado hechas solo de <th>, estén donde estén (en Prescripciones
    // van después de la fila con el nombre del medicamento).
    var trs = Array.prototype.filter.call(table.querySelectorAll('tr'), function (tr) {
      var soloTh = tr.children.length && Array.prototype.every.call(tr.children, function (c) { return c.tagName === 'TH'; });
      return clean(tr.textContent) && !soloTh;
    });
    var rows = trs.map(function (tr) {
      return Array.prototype.map.call(tr.children, function (c) { return clean(c.textContent); });
    });
    if (!rows.length) return [];
    // Clave-valor: dos columnas y toda la primera son rótulos ("Descripción del
    // diagnóstico", "Grado de certeza"); una fila de datos en mayúsculas indica
    // en cambio una tabla con encabezado ("Diagnóstico | Estado").
    var kv = rows.every(function (r) { return r.length === 2; }) &&
      rows.some(function (r) { return /descripci|diagn|medicament|f.?rmaco|nombre/i.test(r[0]); }) &&
      (rows.length === 1 || rows.slice(1).some(function (r) { return ROTULO.test(r[0]) && ROTULO_KV.test(r[0]); }));
    if (kv) {
      return rows.filter(function (r) { return /descripci|diagn|medicament|f.?rmaco|nombre/i.test(r[0]) && !VACIO.test(r[1]); })
        .map(function (r) { return r[1]; });
    }
    // Fila de encabezado: <th>/<thead>, o rótulos cortos sin números sobre otras filas.
    var first = trs[0];
    var esEncabezado = first.querySelector('th') || (first.parentElement && first.parentElement.tagName === 'THEAD') ||
      (rows.length > 1 && rows[0].length > 1 && rows[0].every(function (c) { return c && c.length <= 40 && !/\d/.test(c); }) &&
        rows[0].length === rows[1].length);
    if (esEncabezado) rows = rows.slice(1);
    return rows.map(function (r) { return r[0]; });
  }

  var CON_DOSIS = /\d\s*(mg|g|mcg|µg|ug|ml|%|ui|u\.i\.|meq|gotas?|comp|caps)(\b|\s|\/|$)/i;
  var EN_MAYUSCULAS = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 .,+/()*-]{3,}(\s|$)/;
  var UNA_PALABRA = /^([A-Za-zÁÉÍÓÚáéíóúÑñ*-]{4,}|[A-ZÁÉÍÓÚÑ]{3})$/;
  var ES_FARMACO = { test: function (s) { return CON_DOSIS.test(s) || EN_MAYUSCULAS.test(s) || UNA_PALABRA.test(s); } };

  // En "Clave: valor", qué claves nombran al ítem (el resto se descarta).
  var CLAVE_UTIL = {
    diagnosticos: /descripci|diagn|problema|nombre/i,
    medicamentos: /f.?rmaco|medicament|nombre|producto|principio/i
  };

  function itemsOf(nodes, kind) {
    var items = [];
    nodes.forEach(function (n) {
      var tables = n.tagName === 'TABLE' ? [n] : Array.prototype.slice.call(n.querySelectorAll('table'));
      if (tables.length) { tables.forEach(function (t) { items = items.concat(tableItems(t)); }); return; }
      var lis = n.querySelectorAll('li');
      if (lis.length) { Array.prototype.forEach.call(lis, function (li) { items.push(li.textContent); }); return; }
      var t = clean(n.textContent);
      if (t) items = items.concat(t.split(/\n|;|•/));
    });
    var seen = {};
    return items.map(function (s) {
      // "DIAGNÓSTICO PRINCIPAL:: texto" → "texto"
      s = clean(s).replace(/^[A-ZÁÉÍÓÚÑ ]{3,40}:{1,2}\s*/, '').replace(/^-\s*/, '');
      // Rótulo sin valor ("Observaciones relevantes:") → descartado.
      if (/:\s*$/.test(s)) return '';
      // "Fármaco: X" → "X"; "Vía de administración: Oral" → descartado.
      var kv = /^([A-Za-zÁÉÍÓÚáéíóúñÑ .]{3,30}):\s*(.+)$/.exec(s);
      if (kv) s = CLAVE_UTIL[kind].test(kv[1]) ? kv[2] : '';
      // "NOMBRE 5 MG COMPRIMIDO Pre.: … Vía de administración: …" → "NOMBRE 5 MG COMPRIMIDO"
      s = s.split(/\s(?=[A-ZÁÉÍÓÚ][a-záéíóúñ]{1,15}(?: [a-záéíóúñ]{1,15}){0,3}\.?:)/)[0];
      // Campos vacíos unidos con puntos: ". . texto", "TEXTO. . Texto".
      s = s.replace(/^[\s.·-]+/, '').replace(/(\s*\.\s*){2,}/g, ' · ');
      // En medicamentos, una indicación en texto libre no es un fármaco: se exige dosis o nombre en mayúsculas.
      if (kind === 'medicamentos' && !ES_FARMACO.test(s)) return '';
      return cut(s);
    }).filter(function (s) {
      if (!s || s.length < 3 || VACIO.test(s) || NO_ITEM.test(s) || META.test(s)) return false;
      var k = s.toLowerCase();
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  /** Dosis de "Historial de vacunas": h3 con la vacuna y listas "Clave: valor" debajo. */
  function vacunasOf(nodes) {
    var out = [];
    var actual = '';
    nodes.forEach(function (n) {
      var h3 = n.querySelector && n.querySelector('h3, h4, b, strong');
      var lis = n.querySelectorAll ? n.querySelectorAll('li') : [];
      var tieneDatos = Array.prototype.some.call(lis, function (li) { return /^\s*fecha\s*:/i.test(li.textContent); });
      if (h3 && !tieneDatos) { actual = clean(h3.textContent); return; }
      if (!actual) return;
      var grupos = n.tagName === 'UL' && n.querySelector('ul') ? n.querySelectorAll('ul') : [n];
      Array.prototype.forEach.call(grupos, function (g) {
        var dosis = { vacuna: actual };
        Array.prototype.forEach.call(g.querySelectorAll('li'), function (li) {
          var m = /^([^:]{3,40}):\s*(.*)$/.exec(clean(li.textContent));
          if (!m) return;
          var k = m[1].toLowerCase();
          // Vacunatorio antes que vía: /v.?a/ también coincide con "vacunatorio".
          if (/^fecha/.test(k)) dosis.fecha = m[2].slice(0, 10);
          else if (/vacunatorio|lugar/.test(k)) dosis.vacunatorio = m[2];
          else if (/dosis/.test(k)) dosis.dosis = m[2];
          else if (/^v.?a\b/.test(k)) dosis.via = m[2];
        });
        if (dosis.fecha) out.push(dosis);
      });
    });
    return out;
  }

  function extract(html) {
    var doc = new DOMParser().parseFromString(html || '', 'text/html');
    var cda = {};
    var title = clean(doc.title);
    if (title) cda.titulo = title;
    Array.prototype.forEach.call(doc.querySelectorAll('td'), function (td) {
      var key = CDA_LABELS[clean(td.textContent).toLowerCase()];
      var next = td.nextElementSibling;
      if (key && !cda[key] && next && next.tagName === 'TD') {
        var v = clean(next.textContent);
        if (v) cda[key] = v;
      }
    });

    var out = { cda: cda, vacunas: [], diagnosticos: [], medicamentos: [] };
    Array.prototype.forEach.call(doc.querySelectorAll('h2, h3'), function (h) {
      var t = headingText(h);
      if (SEC_VAC.test(t) && h.tagName === 'H2') out.vacunas = out.vacunas.concat(vacunasOf(sectionNodesVac(h)));
      else if (SEC_DIAG.test(t)) out.diagnosticos = out.diagnosticos.concat(itemsOf(sectionNodes(h), 'diagnosticos'));
      else if (SEC_MED.test(t)) out.medicamentos = out.medicamentos.concat(itemsOf(sectionNodes(h), 'medicamentos'));
    });

    Array.prototype.forEach.call(doc.querySelectorAll('script, style, noscript, template, #b64'), function (el) { el.remove(); });
    out.text = clean(doc.body ? doc.body.textContent : '').slice(0, MAX_TEXT_CHARS);
    return out;
  }

  /** En vacunas, los h3 de cada vacuna son parte de la sección: se corta en el próximo h2 u hr. */
  function sectionNodesVac(h2) {
    var out = [];
    var el = h2.nextElementSibling;
    while (el && el.tagName !== 'H2' && el.tagName !== 'HR') {
      out.push(el);
      el = el.nextElementSibling;
    }
    return out;
  }

  root.HCDExtract = { extract: extract, MAX_TEXT_CHARS: MAX_TEXT_CHARS };
})(typeof window !== 'undefined' ? window : globalThis);
