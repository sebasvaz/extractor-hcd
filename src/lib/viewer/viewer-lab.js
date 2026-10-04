/*
 * "Mis análisis": lectura de los PDF de laboratorio y extracción de
 * analitos (nombre, valor, unidad, rango de referencia).
 *
 * - lineas(bytes): con pdf.js (inline solo en visor-hc.html, en el hilo
 *   principal y sin eval) arma las líneas de cada página a partir de la
 *   posición de cada texto, separando columnas con " | ".
 * - analitos(lineas): reglas tolerantes para las líneas de resultados
 *   "Analito | valor | unidad | referencia" de los laboratorios uruguayos.
 *
 * JS plano: se inyecta inline en los dos visores (en visor.html solo se usa
 * la parte de analitos, que no necesita pdf.js) y se testea en Node.
 */
(function (root) {
  'use strict';

  var GAP_COLUMNA = 8; // puntos PDF entre textos de una misma línea que indican otra columna

  function clean(s) { return (s || '').replace(/[\s ]+/g, ' ').trim(); }

  /** Líneas de texto de un PDF (todas las páginas), con columnas separadas por " | ". */
  function lineas(bytes) {
    var pdfjs = root.pdfjsLib;
    if (!pdfjs) return Promise.reject(new Error('Este visor no puede leer PDF.'));
    // Sin eval (la CSP no lo permite) y sin fuentes: solo necesitamos el texto.
    return pdfjs.getDocument({ data: bytes, verbosity: 0, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise
      .then(function (pdf) {
        var paginas = [];
        for (var i = 1; i <= pdf.numPages; i++) paginas.push(i);
        return paginas.reduce(function (p, n) {
          return p.then(function (acc) {
            return pdf.getPage(n).then(function (page) { return page.getTextContent(); }).then(function (tc) {
              return acc.concat(agrupar(tc.items));
            });
          });
        }, Promise.resolve([])).then(function (r) { pdf.destroy(); return r; });
      });
  }

  /** Items de texto de pdf.js → líneas (misma altura), de izquierda a derecha. */
  function agrupar(items) {
    var filas = [];
    items.forEach(function (it) {
      if (!it.str || !clean(it.str)) return;
      var x = it.transform[4], y = it.transform[5], w = it.width || 0;
      var fila = filas.filter(function (f) { return Math.abs(f.y - y) <= 2; })[0];
      if (!fila) { fila = { y: y, partes: [] }; filas.push(fila); }
      fila.partes.push({ x: x, fin: x + w, s: it.str });
    });
    filas.sort(function (a, b) { return b.y - a.y; });
    return filas.map(function (f) {
      f.partes.sort(function (a, b) { return a.x - b.x; });
      var out = '';
      var fin = null;
      f.partes.forEach(function (p) {
        if (fin !== null) out += p.x - fin > GAP_COLUMNA ? ' | ' : (p.x - fin > 0.5 ? ' ' : '');
        out += p.s;
        fin = p.fin;
      });
      return clean(out);
    });
  }

  var NO_ANALITO = /^(cantidad|fecha|hora|edad|sexo|p[aá]g|p[aá]gina|muestra|n[°º]|nro|n[uú]mero|documento|paciente|m[eé]dico|solicitad|resultado|unidad|valor(es)? de referencia|m[eé]todo|t[eé]cnica|firma|tel|direcci|validad|informe|orden|ingreso|emitido|impreso|c[eé]dula|ci\b)/i;

  function num(s) {
    var m = /(\d+(?:[.,]\d+)?)/.exec(s || '');
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  }

  /**
   * "70 - 110", "70-110 mg/dL", "< 200", "Hasta 40", "Mayor a 40",
   * "Referencia: hasta 200 mg/dl", "Normal: 0.5 a 1.2" → { min, max, texto }.
   */
  function referencia(s) {
    s = clean(s).replace(/^(valores? de )?(referencia|normal(es)?|v\.\s*r\.)\s*:?\s*/i, '');
    if (!s) return null;
    var r = /(\d+(?:[.,]\d+)?)\s*(?:[-–]|\ba\b)\s*(\d+(?:[.,]\d+)?)/.exec(s);
    if (r) return { min: num(r[1]), max: num(r[2]), texto: s };
    var hi = /(?:^|\s)(?:<|≤|hasta|menor(?:\s+(?:a|que|de))?)\s*(\d+(?:[.,]\d+)?)/i.exec(s);
    if (hi) return { min: null, max: num(hi[1]), texto: s };
    var lo = /(?:^|\s)(?:>|≥|mayor(?:\s+(?:a|que|de))?|desde)\s*(\d+(?:[.,]\d+)?)/i.exec(s);
    if (lo) return { min: num(lo[1]), max: null, texto: s };
    return null;
  }

  // Columna de valor: "98", "< 5", "98 mg/dl", "RESULTADO 7.5 uU/ml", "Resultado: 98".
  var VALOR = /^(?:resultado\s*:?\s*)?([<>≤≥]?\s*\d+(?:[.,]\d+)?)(?:\s*([^\d\s|][^\s|]{0,11}))?$/i;

  /**
   * Analitos de las líneas de un informe. Formato esperado por columnas:
   * nombre | valor | unidad | referencia (la unidad y la referencia son
   * opcionales; a veces la unidad va pegada a la referencia).
   */
  function analitos(ls) {
    var out = [];
    var vistos = {};
    (ls || []).forEach(function (l) {
      var cols = l.split(' | ').map(clean).filter(Boolean);
      if (cols.length < 2) return;
      var nombre = cols[0].replace(/[.:]+$/, '');
      if (!/[A-Za-zÁÉÍÓÚáéíóúñÑ]{3}/.test(nombre) || NO_ANALITO.test(nombre) || nombre.length > 60) return;
      var mv = VALOR.exec(cols[1]);
      if (!mv) return;
      var valor = num(mv[1]);
      if (valor === null) return;
      var resto = cols.slice(2);
      var unidad = mv[2] || '';
      if (!unidad && resto.length && !/\d/.test(resto[0]) && resto[0].length <= 12 && !/^(referencia|normal)/i.test(resto[0])) unidad = resto.shift();
      else if (resto.length && /^[a-zA-Zµ%/^.]+\d*[a-zA-Z/^.]*$/.test(resto[0]) && resto[0].length <= 12) unidad = resto.shift();
      // Algunos informes repiten el valor anterior o la fecha: la referencia es la primera columna con forma de rango.
      var ref = null;
      for (var i = 0; i < resto.length && !ref; i++) ref = referencia(resto[i]);
      var k = nombre.toLowerCase() + '|' + valor;
      if (vistos[k]) return;
      vistos[k] = 1;
      var fuera = ref ? (ref.min !== null && valor < ref.min ? 'bajo' : ref.max !== null && valor > ref.max ? 'alto' : '') : '';
      out.push({ nombre: nombre, valor: valor, texto: mv[1].replace(/\s+/g, ''), unidad: unidad, ref: ref, fuera: fuera });
    });
    return out;
  }

  root.HCDLab = { lineas: lineas, agrupar: agrupar, analitos: analitos, referencia: referencia };
})(typeof window !== 'undefined' ? window : globalThis);
