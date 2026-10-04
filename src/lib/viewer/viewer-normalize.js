/*
 * Normalización de los datos de cada documento antes de mostrarlos.
 *
 * Los ZIP de las versiones ≤ 1.4.0 de la extensión traen los datos del
 * timeline de Mi HCD en campos corridos (ver docs/PLAN_VISOR.md, problema A):
 *  - `descripcion` = fila cruda: "dd/mm/aaaa\t\tSIGLA\t…\tNombre completo del
 *    prestador\tNombre completo" o un OID ("2.16.858.2…").
 *  - `profesional` = "NOMBRE APELLIDO\nDescripción: servicio de urología".
 *  - `prestador` vacío.
 *  - texto UTF-8 leído como Latin-1 ("cardiologÃ­a").
 * Además puede venir `d.cda` con datos del cabezal del documento (título,
 * prestador, profesional, fecha y hora del evento).
 *
 * JS plano: se inyecta inline en visor.html y visor-hc.html antes del
 * cliente, y se testea en Node (viewer.test.ts) con datos sintéticos.
 */
(function (root) {
  'use strict';

  /** Repara texto UTF-8 que se decodificó como Latin-1 ("Ã­" → "í"). */
  function fixMojibake(s) {
    // Algunos textos pasaron dos veces por el error ("Ã\u0083Â­" → "Ã­" → "í").
    for (var i = 0; i < 3; i++) {
      var r = fixMojibakeUnaVez(s);
      if (r === s) break;
      s = r;
    }
    return s || '';
  }

  function fixMojibakeUnaVez(s) {
    if (!s || !/[ÃÂ][\u0080-¿]/.test(s)) return s || '';
    var bytes = new Uint8Array(s.length);
    var soloLatin1 = true;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c > 0xff) { soloLatin1 = false; break; }
      bytes[i] = c;
    }
    if (soloLatin1) {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (e) { /* mezcla de texto bien y mal codificado: sigue abajo */ }
    }
    // Reparamos solo las secuencias de dos bytes rotas ("Ã­" → "í").
    return s.replace(/[Â-ß][\u0080-¿]/g, function (pair) {
      var a = pair.charCodeAt(0), b = pair.charCodeAt(1);
      return String.fromCharCode(((a & 0x1f) << 6) | (b & 0x3f));
    });
  }

  var LOWER_WORDS = { de: 1, del: 1, la: 1, las: 1, los: 1, y: 1, e: 1, en: 1, el: 1, por: 1, para: 1 };

  /** "EMMANUEL MONTAÑA DE LA CRUZ" → "Emmanuel Montaña de la Cruz". Respeta textos ya mezclados. */
  function titleCase(s) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    if (!s || s !== s.toUpperCase() || !/[A-ZÁÉÍÓÚÑÜ]/.test(s)) return s;
    return s.toLowerCase().split(' ').map(function (w, i) {
      if (i > 0 && LOWER_WORDS[w]) return w;
      return w.replace(/(^|[-'(])([a-záéíóúñü])/g, function (m, p, c) { return p + c.toUpperCase(); });
    }).join(' ');
  }

  /** Siglas cortas en mayúsculas quedan como están (ASSE, CASMU, CAMEC). */
  function prestadorCorto(s) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    if (/^[A-ZÁÉÍÓÚÑ.]{2,6}$/.test(s)) return s;
    return titleCase(s);
  }

  function capitalize(s) {
    s = (s || '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  var OID = /^\d+(\.\d+){4,}/;

  /** Fila cruda del timeline → { prestador, prestadorNombre } o null. */
  function parseFila(desc) {
    if (!desc || desc.indexOf('\t') === -1) return null;
    var parts = desc.split('\t').map(function (p) { return p.trim(); }).filter(Boolean);
    var out = { prestador: '', prestadorNombre: '' };
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(p)) continue;
      if (/^nombre completo del prestador$/i.test(p)) {
        if (parts[i + 1]) out.prestadorNombre = parts[i + 1];
        break;
      }
      if (!out.prestador) out.prestador = p;
    }
    return out.prestador || out.prestadorNombre ? out : null;
  }

  /** "NOMBRE\nDescripción: servicio de urología" → { nombre, especialidad }. */
  function parseProfesional(prof) {
    var out = { nombre: '', especialidad: '' };
    (prof || '').split(/\n+/).forEach(function (line) {
      line = line.trim();
      var m = /^descripci[oó]n\s*:\s*(.*)$/i.exec(line);
      if (m) out.especialidad = m[1].trim();
      else if (line && !out.nombre) out.nombre = line;
    });
    out.especialidad = out.especialidad.replace(/^servicio\s+de\s+/i, '').replace(/[\s.]+$/, '');
    out.nombre = out.nombre.replace(/[,\s]+$/, '');
    return out;
  }

  /** "Marzo 23, 2026, 09:45:00" (o similar) → "09:45". */
  function horaDe(s) {
    var m = /(\d{1,2}):(\d{2})/.exec(s || '');
    if (!m) return '';
    var hh = +m[1];
    if (hh === 0 && +m[2] === 0) return '';
    return (hh < 10 ? '0' : '') + hh + ':' + m[2];
  }

  /** Normaliza un documento del índice (muta y devuelve `d`). */
  function normalizeDoc(d) {
    var cda = d.cda || {};
    ['categoria', 'descripcion', 'prestador', 'profesional', 'text'].forEach(function (k) {
      if (typeof d[k] === 'string') d[k] = fixMojibake(d[k]);
    });
    var cdaTitulo = fixMojibake(cda.titulo || '').trim();
    var cdaPrest = fixMojibake(cda.prestador || '').trim();
    var cdaProf = fixMojibake(cda.profesional || '').trim();

    var desc = d.descripcion || '';
    var fila = parseFila(desc);
    if (fila || OID.test(desc.trim())) desc = '';
    var prof = parseProfesional(d.profesional);
    // ZIP v1.9+: la descripción ya viene sola ("servicio de urología").
    var serv = /^servicio\s+de\s+(.+)$/i.exec(desc.trim());
    if (serv && !prof.especialidad) { prof.especialidad = serv[1].replace(/[\s.]+$/, ''); desc = ''; }

    var prestador = (d.prestador || '').trim();
    var prestadorNombre = fixMojibake(d.prestadorNombre || '').trim();
    if (fila) {
      if (!prestador) prestador = fila.prestador;
      prestadorNombre = fila.prestadorNombre;
    }
    if (!prestador && cdaPrest) prestador = cdaPrest;
    if (!prestadorNombre && cdaPrest && cdaPrest !== prestador) prestadorNombre = cdaPrest;

    var profesional = (prof.nombre || cdaProf).replace(/[,\s]+$/, '');

    d.prestador = prestadorCorto(prestador);
    d.prestadorNombre = prestadorNombre;
    d.profesional = titleCase(profesional);
    d.especialidad = capitalize(prof.especialidad.toLowerCase());
    d.tipo = cdaTitulo && !/^laboratorio\s+—/i.test(cdaTitulo) ? capitalize(cdaTitulo.toLowerCase()) : '';
    d.descripcion = desc.trim();
    d.titulo = d.descripcion || d.especialidad || d.tipo || d.categoria || 'Documento';
    d.hora = horaDe(cda.fechaHora);
    delete d.cda;
    return d;
  }

  /** Normaliza un error de captura (misma fila cruda en `descripcion`). */
  function normalizeError(e) {
    var desc = fixMojibake(e.descripcion || '');
    var fila = parseFila(desc);
    return {
      fecha: e.fecha || '',
      categoria: fixMojibake(e.categoria || ''),
      prestador: fila ? prestadorCorto(fila.prestador) : '',
      descripcion: fila || OID.test(desc.trim()) ? '' : desc.trim(),
      message: e.message || ''
    };
  }

  var STOP = { de: 1, del: 1, la: 1, las: 1, los: 1, el: 1, en: 1, y: 1, e: 1 };
  function tokens(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(function (t) { return t && !STOP[t]; });
  }
  function contiene(grande, chico) {
    return chico.length > 0 && chico.every(function (t) { return grande.indexOf(t) !== -1; });
  }
  function jaccard(a, b) {
    var inter = a.filter(function (t) { return b.indexOf(t) !== -1; }).length;
    return inter / (a.length + b.length - inter || 1);
  }

  /**
   * Una misma institución llega como sigla (fila del portal) o como nombre
   * completo (cabezal del documento), y el nombre completo no siempre es
   * idéntico en las dos fuentes. Se compara por palabras contra las siglas
   * conocidas y sus nombres completos; solo se unifica si la coincidencia
   * no es ambigua.
   */
  function unifyPrestadores(docs) {
    var conocidas = {};
    docs.forEach(function (d) {
      if (!d.prestador || !d.prestadorNombre) return;
      var c = conocidas[d.prestador] || (conocidas[d.prestador] = { sigla: tokens(d.prestador), nombres: [] });
      c.nombres.push(tokens(d.prestadorNombre));
    });
    var siglas = Object.keys(conocidas);
    var cache = {};
    docs.forEach(function (d) {
      if (!d.prestador || conocidas[d.prestador]) return;
      if (!(d.prestador in cache)) {
        var t = tokens(d.prestador);
        var hits = siglas.filter(function (s) {
          var c = conocidas[s];
          var siglaUtil = c.sigla.length > 1 || (c.sigla[0] || '').length >= 4;
          return (siglaUtil && contiene(t, c.sigla)) ||
            c.nombres.some(function (n) { return jaccard(t, n) >= 0.6; });
        });
        cache[d.prestador] = hits.length === 1 ? hits[0] : null;
      }
      var sigla = cache[d.prestador];
      if (sigla) {
        d.prestadorNombre = d.prestadorNombre || d.prestador;
        d.prestador = sigla;
      }
    });
    return docs;
  }

  // Errores frecuentes de escritura en los servicios de Mi HCD.
  var ESPECIALIDAD_FIX = { siquiatria: 'psiquiatria', sicologia: 'psicologia', traumatologia: 'traumatologia' };

  function claveEspecialidad(e) {
    var base = (e || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    // "Siquiatria (psiquiatria)": vale el nombre entre paréntesis.
    var paren = /\(([^)]+)\)/.exec(base);
    if (paren) base = paren[1];
    base = base.replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return ESPECIALIDAD_FIX[base] || base;
  }

  function tildes(s) { return (s.match(/[áéíóúñü]/gi) || []).length; }

  /**
   * "Cardiologia", "Cardiología" y "Siquiatria (psiquiatria)" / "Psiquiatría"
   * son la misma especialidad: se agrupan y se muestran con la forma más
   * correcta (con tildes y sin paréntesis; a igual calidad, la más usada).
   */
  function unifyEspecialidades(docs) {
    var grupos = {};
    docs.forEach(function (d) {
      if (!d.especialidad) return;
      var k = claveEspecialidad(d.especialidad);
      var g = grupos[k] || (grupos[k] = {});
      g[d.especialidad] = (g[d.especialidad] || 0) + 1;
    });
    var elegida = {};
    Object.keys(grupos).forEach(function (k) {
      var formas = Object.keys(grupos[k]);
      formas.sort(function (a, b) {
        var pa = /\(/.test(a) ? 1 : 0, pb = /\(/.test(b) ? 1 : 0;
        return pa - pb || tildes(b) - tildes(a) || grupos[k][b] - grupos[k][a] || a.localeCompare(b);
      });
      elegida[k] = formas[0];
    });
    docs.forEach(function (d) {
      if (d.especialidad) d.especialidad = elegida[claveEspecialidad(d.especialidad)];
    });
    return docs;
  }

  root.HCDNormalize = {
    unifyEspecialidades: unifyEspecialidades,
    unifyPrestadores: unifyPrestadores,
    fixMojibake: fixMojibake,
    titleCase: titleCase,
    parseFila: parseFila,
    parseProfesional: parseProfesional,
    horaDe: horaDe,
    normalizeDoc: normalizeDoc,
    normalizeError: normalizeError
  };
})(typeof window !== 'undefined' ? window : globalThis);
