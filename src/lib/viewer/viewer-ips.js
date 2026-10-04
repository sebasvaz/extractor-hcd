/*
 * "Abrir mi IPS": lee el Resumen del Paciente (Bundle FHIR R4 tipo
 * document) que la Plataforma IPS le da al paciente ("Descargar FHIR",
 * ips-fhir.json) y lo convierte en secciones con ítems legibles.
 *
 * Solo lee: no valida perfiles ni interpreta terminologías. Todo se muestra
 * como texto (textContent) en el visor.
 *
 * JS plano: se inyecta inline en los dos visores y se testea en Node.
 */
(function (root) {
  'use strict';

  function txt(cc) {
    if (!cc) return '';
    if (cc.text) return String(cc.text);
    var c = (cc.coding || []).filter(function (x) { return x && x.display; })[0];
    return c ? String(c.display) : '';
  }

  function fecha(r) {
    var v = r.onsetDateTime || r.effectiveDateTime || r.occurrenceDateTime || r.performedDateTime || r.recordedDate ||
      (r.effectivePeriod && r.effectivePeriod.start) || (r.performedPeriod && r.performedPeriod.start) ||
      (r.onsetPeriod && r.onsetPeriod.start) || r.issued || '';
    return String(v).slice(0, 10);
  }

  function estado(r) {
    var c = r.clinicalStatus && (r.clinicalStatus.coding || [])[0];
    var code = c ? c.code : r.status;
    return { active: 'Activo', resolved: 'Resuelto', inactive: 'Inactivo', remission: 'En remisión', recurrence: 'Recurrencia',
      completed: 'Completado', stopped: 'Suspendido', 'on-hold': 'En pausa', 'entered-in-error': 'Error' }[code] || '';
  }

  function valor(r) {
    // Presión arterial y similares: componentes (sistólica/diastólica).
    if (!r.valueQuantity && Array.isArray(r.component) && r.component.length) {
      var vs = r.component.map(function (c) { return c.valueQuantity && c.valueQuantity.value != null ? String(c.valueQuantity.value) : ''; })
        .filter(Boolean);
      var u = ((r.component[0] || {}).valueQuantity || {}).unit || '';
      if (vs.length) return vs.join('/') + (u ? ' ' + u : '');
    }
    if (r.valueQuantity) {
      var q = r.valueQuantity;
      return [q.comparator || '', q.value != null ? String(q.value) : '', q.unit || q.code || ''].join(' ').replace(/\s+/g, ' ').trim();
    }
    if (r.valueString) return String(r.valueString);
    if (r.valueCodeableConcept) return txt(r.valueCodeableConcept);
    if (r.valueBoolean != null) return r.valueBoolean ? 'Sí' : 'No';
    return '';
  }

  function rango(r) {
    var rr = (r.referenceRange || [])[0];
    if (!rr) return '';
    if (rr.text) return String(rr.text);
    var lo = rr.low && rr.low.value != null ? rr.low.value : null;
    var hi = rr.high && rr.high.value != null ? rr.high.value : null;
    var u = (rr.low && rr.low.unit) || (rr.high && rr.high.unit) || '';
    if (lo != null && hi != null) return lo + ' – ' + hi + (u ? ' ' + u : '');
    if (lo != null) return '≥ ' + lo + (u ? ' ' + u : '');
    if (hi != null) return '≤ ' + hi + (u ? ' ' + u : '');
    return '';
  }

  /** Un recurso FHIR → { nombre, fecha, detalle[], estado }. `porRef` resuelve referencias del Bundle. */
  function item(r, porRef) {
    porRef = porRef || {};
    var t = r.resourceType;
    var nombre = '';
    var detalle = [];
    if (t === 'MedicationStatement' || t === 'MedicationRequest') {
      nombre = txt(r.medicationCodeableConcept) || (r.medicationReference && r.medicationReference.display) || '';
      var dos = (r.dosage || r.dosageInstruction || [])[0];
      if (dos && dos.text) detalle.push(String(dos.text));
    } else if (t === 'Immunization') {
      nombre = txt(r.vaccineCode);
      var p = (r.protocolApplied || [])[0];
      if (p && (p.doseNumberString || p.doseNumberPositiveInt)) detalle.push('Dosis ' + (p.doseNumberString || p.doseNumberPositiveInt));
    } else if (t === 'Observation') {
      nombre = txt(r.code);
      var v = valor(r);
      if (v) detalle.push(v);
      var rg = rango(r);
      if (rg) detalle.push('Referencia: ' + rg);
      var interp = txt((r.interpretation || [])[0]);
      if (interp) detalle.push(interp);
    } else if (t === 'DeviceUseStatement') {
      var ref = r.device && r.device.reference;
      // "#id" apunta a un recurso contenido en el propio DeviceUseStatement.
      var dev = ref && ref.charAt(0) === '#'
        ? (r.contained || []).filter(function (c) { return c && '#' + c.id === ref; })[0]
        : ref && porRef[ref];
      nombre = (r.device && r.device.display) || (dev && (txt(dev.type) || ((dev.deviceName || [])[0] || {}).name)) || '';
    } else if (t === 'Device') {
      nombre = txt(r.type) || ((r.deviceName || [])[0] || {}).name || '';
    } else {
      nombre = txt(r.code);
    }
    (r.note || []).forEach(function (n) { if (n && n.text) detalle.push(String(n.text)); });
    return { tipo: t, nombre: nombre || '(sin nombre)', fecha: fecha(r), estado: estado(r), detalle: detalle };
  }

  /**
   * Bundle → { titulo, fecha, autor, secciones: [{ titulo, items: [...] }] }.
   * Lanza Error con un mensaje para el titular si el archivo no es un IPS.
   */
  function leer(bundle) {
    if (!bundle || bundle.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) {
      throw new Error('El archivo no es un Resumen del Paciente (IPS) en formato FHIR.');
    }
    var porRef = {};
    bundle.entry.forEach(function (e) {
      var r = e && e.resource;
      if (!r || !r.resourceType) return;
      if (e.fullUrl) porRef[e.fullUrl] = r;
      if (r.id) porRef[r.resourceType + '/' + r.id] = r;
    });
    var comp = bundle.entry.map(function (e) { return e && e.resource; })
      .filter(function (r) { return r && r.resourceType === 'Composition'; })[0];
    if (!comp) throw new Error('El archivo no trae la Composition del Resumen del Paciente (IPS).');
    var secciones = (comp.section || []).map(function (s) {
      var items = (s.entry || []).map(function (ref) { return porRef[ref && ref.reference]; })
        .filter(Boolean).map(function (r) { return item(r, porRef); });
      return { titulo: String(s.title || txt(s.code) || 'Sección'), items: items };
    });
    var autor = (comp.author || []).map(function (a) { return a && a.display; }).filter(Boolean).join(', ');
    return { titulo: String(comp.title || 'Resumen del Paciente'), fecha: String(comp.date || '').slice(0, 10), autor: autor, secciones: secciones };
  }

  root.HCDIps = { leer: leer, item: item };
})(typeof window !== 'undefined' ? window : globalThis);
