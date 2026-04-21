import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json' with { type: 'json' };

/**
 * Manifest V3 para la extensión "Extractor de HCD — Proyecto IPS ORT".
 *
 * Alineado a la Especificación Técnica v1.0 (sección 9).
 *
 * Principios:
 *  - Permisos mínimos justificados (ver README §seguridad).
 *  - host_permissions acotado al dominio del portal Mi HCD.
 *  - Sin dependencias de red en runtime más allá del propio portal.
 *  - CSP estricta: script-src 'self'; object-src 'self'.
 *  - JSZip y demás dependencias van bundleadas (NO CDN).
 */
export default defineManifest({
  manifest_version: 3,
  name: 'Extractor de HCD — Proyecto IPS ORT',
  short_name: 'HCD Extractor',
  version: pkg.version,
  // `default_locale` se omite a propósito: no usamos chrome.i18n ni
  // placeholders `__MSG_*__`. Declararlo sin un árbol
  // `_locales/<lang>/messages.json` hace fallar la carga en Chrome con
  // "Default locale was specified, but _locales subtree is missing."
  description:
    'Exporta los documentos clínicos del titular autenticado en Mi HCD ' +
    '(historiaclinicadigital.gub.uy) como corpus HTML + metadata.json ' +
    'empaquetado en ZIP, para uso exclusivamente académico en el Proyecto ' +
    'Final de Lic. Sistemas, Universidad ORT Uruguay.',

  // Permisos — ver justificación en spec §9.2
  permissions: [
    'storage', // config + log circular de la corrida
    'downloads', // disparar descarga del ZIP final sin prompt por archivo
    'scripting', // re-inyectar helpers si se recarga la pestaña
    'tabs', // identificar pestaña activa, enviarle mensajes
    'webNavigation', // detectar cambios de URL del postback GeneXus
  ],

  host_permissions: ['https://historiaclinicadigital.gub.uy/*'],

  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },

  // Content script con all_frames:true — el iframe CONTENIDOHTML comparte
  // origen con la página contenedora y queremos presencia defensiva en
  // ambos frames.
  content_scripts: [
    {
      matches: ['https://historiaclinicadigital.gub.uy/*'],
      js: ['src/content/scraper.ts'],
      run_at: 'document_idle',
      all_frames: true,
    },
  ],

  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Extractor de HCD',
    default_icon: {
      '16': 'public/icons/icon-16.png',
      '32': 'public/icons/icon-32.png',
      '48': 'public/icons/icon-48.png',
      '128': 'public/icons/icon-128.png',
    },
  },

  icons: {
    '16': 'public/icons/icon-16.png',
    '32': 'public/icons/icon-32.png',
    '48': 'public/icons/icon-48.png',
    '128': 'public/icons/icon-128.png',
  },

  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; base-uri 'self';",
  },

  web_accessible_resources: [
    {
      resources: ['public/icons/*'],
      matches: ['https://historiaclinicadigital.gub.uy/*'],
    },
  ],
});
