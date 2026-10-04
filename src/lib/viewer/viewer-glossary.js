/*
 * Glosario de siglas clínicas y búsqueda tolerante para el visor.
 *
 * Las siglas salen del seed curado de la Plataforma IPS
 * (backend/app/ips/clinical_abbreviations.py, CLINICAL_ABBREVIATIONS_UY),
 * reescritas con tildes para leerlas. Quedan afuera las de 2 letras y las
 * que no son siglas ("lupus", "obes", "amp"): en texto libre colisionan con
 * palabras comunes y explicarlas confundiría más de lo que ayuda.
 *
 * JS plano: se inyecta inline en los dos visores y se testea en Node.
 */
(function (root) {
  'use strict';

  var SIGLAS = {
    HTA: 'Hipertensión arterial',
    HSA: 'Hipertensión sistémica arterial',
    ICC: 'Insuficiencia cardíaca congestiva',
    IAM: 'Infarto agudo de miocardio',
    ACV: 'Accidente cerebrovascular',
    AVE: 'Accidente vascular encefálico',
    TVP: 'Trombosis venosa profunda',
    TEP: 'Tromboembolismo pulmonar',
    DM1: 'Diabetes mellitus tipo 1',
    DM2: 'Diabetes mellitus tipo 2',
    DMT2: 'Diabetes mellitus tipo 2',
    DLP: 'Dislipemia',
    IMC: 'Índice de masa corporal',
    ERGE: 'Enfermedad por reflujo gastroesofágico',
    RGE: 'Reflujo gastroesofágico',
    EPOC: 'Enfermedad pulmonar obstructiva crónica',
    IRAS: 'Infección respiratoria aguda superior',
    IRAB: 'Infección respiratoria aguda baja',
    IRC: 'Insuficiencia renal crónica',
    ERC: 'Enfermedad renal crónica',
    ITU: 'Infección del tracto urinario',
    IVU: 'Infección de vía urinaria',
    VIH: 'Virus de la inmunodeficiencia humana',
    SIDA: 'Síndrome de inmunodeficiencia adquirida',
    TBC: 'Tuberculosis',
    HBP: 'Hiperplasia benigna de próstata',
    HPB: 'Hiperplasia benigna de próstata',
    EKG: 'Electrocardiograma',
    ECG: 'Electrocardiograma',
    RMN: 'Resonancia magnética nuclear',
    TAC: 'Tomografía axial computada',
    AAS: 'Ácido acetilsalicílico (aspirina)',
    AINE: 'Antiinflamatorio no esteroideo',
    ACO: 'Anticoagulante oral',
    IECA: 'Inhibidor de la enzima convertidora de angiotensina',
    ARA2: 'Antagonista del receptor de angiotensina 2',
    ISRS: 'Inhibidor selectivo de la recaptación de serotonina',
    TARV: 'Terapia antirretroviral',
    PREP: 'Profilaxis preexposición al VIH',
    PEP: 'Profilaxis posexposición al VIH',
    RTU: 'Resección transuretral',
    RCP: 'Reanimación cardiopulmonar',
    IOT: 'Intubación orotraqueal',
    TQT: 'Traqueostomía',
    GTT: 'Gastrostomía',
    DVP: 'Derivación ventriculoperitoneal',
    SNG: 'Sonda nasogástrica',
    VVP: 'Vía venosa periférica',
    ARM: 'Asistencia respiratoria mecánica',
    FBC: 'Fibrobroncoscopia',
    HTEC: 'Hipertensión endocraneana'
  };

  var MARKS = /[̀-ͯ]/g;
  function norm(s) { return (s || '').normalize('NFD').replace(MARKS, '').toLowerCase(); }

  // Una sigla cuenta solo como palabra aislada y escrita en mayúsculas
  // ("PEP" sí, "pepino" o "Pep" no).
  var CLAVES = Object.keys(SIGLAS).sort(function (a, b) { return b.length - a.length; });
  var RE_SIGLA = new RegExp('(^|[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9])(' + CLAVES.join('|') + ')(?![A-Za-zÁÉÍÓÚÑáéíóúñ0-9])', 'g');

  /** Partes de un texto: [{ text }, { sigla, title }, …] para envolver en <abbr>. */
  function partes(text) {
    var out = [];
    var pos = 0;
    var m;
    RE_SIGLA.lastIndex = 0;
    while ((m = RE_SIGLA.exec(text || ''))) {
      var ini = m.index + m[1].length;
      if (ini > pos) out.push({ text: text.slice(pos, ini) });
      out.push({ sigla: m[2], title: SIGLAS[m[2]] });
      pos = ini + m[2].length;
    }
    if (pos < (text || '').length) out.push({ text: text.slice(pos) });
    return out;
  }

  /** Siglas presentes en un texto → { HTA: 3, … }. */
  function contar(text, acc) {
    acc = acc || {};
    var m;
    RE_SIGLA.lastIndex = 0;
    while ((m = RE_SIGLA.exec(text || ''))) acc[m[2]] = (acc[m[2]] || 0) + 1;
    return acc;
  }

  // Expansiones normalizadas → siglas ("hipertension arterial" → ["hta"]).
  var POR_EXPANSION = {};
  CLAVES.forEach(function (k) {
    var e = norm(SIGLAS[k]).replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    (POR_EXPANSION[e] = POR_EXPANSION[e] || []).push(k.toLowerCase());
  });

  /**
   * Variantes de una búsqueda con sinónimos: "hta" → también "hipertension
   * arterial"; "hipertension arterial" o "hipertension" → también "hta".
   * Devuelve una lista de listas de términos normalizados; un documento
   * coincide si contiene todos los términos de alguna variante.
   */
  function variantes(q) {
    var base = norm(q).replace(/\s+/g, ' ').trim();
    if (!base) return [];
    var out = [base];
    var palabras = base.split(' ');
    // Sigla → expansión (por palabra).
    palabras.forEach(function (p, i) {
      var exp = SIGLAS[p.toUpperCase()];
      if (exp) {
        var e = norm(exp).replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();
        var copia = palabras.slice();
        copia[i] = e;
        out.push(copia.join(' '));
      }
    });
    // Expansión (completa o su primera palabra significativa) → sigla.
    Object.keys(POR_EXPANSION).forEach(function (e) {
      var primera = e.split(' ')[0];
      if (base.indexOf(e) !== -1) {
        POR_EXPANSION[e].forEach(function (s) { out.push(base.replace(e, s)); });
      } else if (palabras.length === 1 && primera.length >= 6 && primera === base) {
        POR_EXPANSION[e].forEach(function (s) { out.push(s); });
      }
    });
    // Primero la búsqueda original y después las siglas de expansión más corta (las más generales).
    var vistos = {};
    var unicas = out.filter(function (v) { return !vistos[v] && (vistos[v] = true); });
    var resto = unicas.slice(1).sort(function (a, b) { return prioridad(a) - prioridad(b); });
    return [unicas[0]].concat(resto).map(function (v) { return v.split(' ').filter(Boolean); });
  }

  /** Largo de la expansión de una sigla (o del texto): ordena las variantes de la más general a la más específica. */
  function prioridad(v) {
    var exp = SIGLAS[v.toUpperCase()];
    return exp ? exp.length : 1000 + v.length;
  }

  /** Variante para mostrar: las siglas en mayúscula. */
  function mostrar(terminos) {
    return terminos.map(function (t) { return SIGLAS[t.toUpperCase()] ? t.toUpperCase() : t; }).join(' ');
  }

  /** Distancia de edición (Levenshtein) con tope: corta en cuanto supera `max`. */
  function distancia(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      var minFila = i;
      for (var k = 1; k <= b.length; k++) {
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
        if (cur[k] < minFila) minFila = cur[k];
      }
      if (minFila > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /**
   * "¿Quisiste decir…?": para cada término sin resultados, la palabra del
   * vocabulario (palabras de los documentos con su frecuencia) más parecida.
   * Tolera 1 error en palabras cortas y 2 en largas.
   */
  function sugerir(terminos, vocab) {
    var cambio = false;
    var out = terminos.map(function (t) {
      if (vocab[t] || t.length < 4) return t;
      var max = t.length >= 8 ? 2 : 1;
      var mejor = null;
      var mejorD = max + 1;
      Object.keys(vocab).forEach(function (w) {
        if (w[0] !== t[0] && max === 1) return;
        var d = distancia(t, w, max);
        if (d < mejorD || (d === mejorD && mejor && vocab[w] > vocab[mejor])) { mejor = w; mejorD = d; }
      });
      if (mejor && mejorD <= max) { cambio = true; return mejor; }
      return t;
    });
    return cambio ? out.join(' ') : null;
  }

  root.HCDGlossary = {
    SIGLAS: SIGLAS,
    partes: partes,
    contar: contar,
    variantes: variantes,
    mostrar: mostrar,
    distancia: distancia,
    sugerir: sugerir
  };
})(typeof window !== 'undefined' ? window : globalThis);
