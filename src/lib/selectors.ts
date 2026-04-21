/**
 * Selectores del DOM de Mi HCD, centralizados.
 *
 * La spec v1.0 (§10.1 "Cambios en el DOM del portal") recomienda tenerlos en
 * un único módulo para poder parchear rápidamente ante cambios del portal.
 *
 * Todos los selectores se deben validar al inicio de la corrida. Si alguno
 * no resuelve, emitir error descriptivo sin arrancar el scraping.
 */

// ---------------------------------------------------------------------------
// Rutas / URLs
// ---------------------------------------------------------------------------

export const URLS = {
  ORIGIN: 'https://historiaclinicadigital.gub.uy',
  TIMELINE: '/mihcd/servlet/com.mihcd.hc?Destacados=TODOS',
  VISUALIZAR_PREFIX: '/mihcd/servlet/com.mihcd.visualizarcda',
  AOPEN_CDA: '/mihcd/servlet/com.mihcd.aopencdasesion',
} as const;

/** Regex para detectar URL de detalle (visualizarcda). */
export const RE_VISUALIZAR = /\/mihcd\/servlet\/com\.mihcd\.visualizarcda(\?|$)/i;

/** Regex para detectar URL de timeline. */
export const RE_TIMELINE = /\/mihcd\/servlet\/com\.mihcd\.hc(\?|$)/i;

// ---------------------------------------------------------------------------
// Selectores CSS
// ---------------------------------------------------------------------------

export const SEL = {
  /**
   * Anchors que disparan el postback GeneXus para abrir un evento.
   * Probamos varias heurísticas: el sitio puede cambiar el atributo
   * `data-gx-evt` entre versiones. El filtro real por categoría/fecha
   * lo hace el scraper una vez que tiene la fila.
   */
  eventAnchors: [
    'a[data-gx-evt="5"]',
    'a[href*="visualizarcda" i]',
    'a[onclick*="visualizarcda" i]',
    'a[onclick*="gx.evt" i][data-gx-evtrow]',
  ].join(', '),

  /**
   * Filas "de evento" — usado como fallback cuando no encontramos anchors.
   * Apunta a estructuras típicas de un grid GeneXus.
   */
  eventRows: [
    'tr[data-gx-evtrow]',
    'tr[data-gx-row]',
    'tr[onclick]',
    'tr[role="row"]',
    'tbody > tr',
  ].join(', '),

  /** iframe que contiene el CDA renderizado en la página de detalle. */
  iframeContenidoHtml: 'iframe[name="CONTENIDOHTML"]',

  /** Formulario principal de la línea de tiempo (posee el GXState). */
  timelineForm: 'form[action*="com.mihcd.hc"]',

  /** Pie con el texto "Mostrando del X al Y de T resultados". */
  paginationFooter: '*', // buscamos en todo el body con text-regex

  /**
   * Botón de paginación "Siguiente →". El portal es inconsistente con
   * atributos; usamos múltiples fallbacks y además un matcher por texto
   * implementado en el scraper para cuando ninguno de estos pega.
   */
  nextPageButton: [
    'a[data-gx-evt="5"][title*="Siguiente" i]',
    'a[data-gx-evt="5"][aria-label*="Siguiente" i]',
    'a[title*="Siguiente" i]',
    'a[aria-label*="Siguiente" i]',
    'button[title*="Siguiente" i]',
    'button[aria-label*="Siguiente" i]',
    'a[href*="Paginar" i]',
    'a[href*="PageNumber" i]',
  ].join(', '),

  /** Menú lateral — link a "Todos los registros" (fallback para total). */
  sideMenuTodosLosRegistros:
    'a[href*="Destacados=TODOS"], a[title*="Todos los registros" i]',
} as const;

// ---------------------------------------------------------------------------
// Regex de parseo de texto
// ---------------------------------------------------------------------------

/**
 * "Mostrando del X al Y de T resultados" (tolerante a espacios duros / tildes).
 * spec §6.3.1.
 */
export const RE_TOTAL_RECORDS =
  /Mostrando\s+del\s+(\d+)\s+al\s+(\d+)\s+de\s+(\d+)\s+resultados/i;

/** Fallback: "Todos los registros (45)" en el menú lateral. */
export const RE_SIDEBAR_COUNT = /Todos\s+los\s+registros\s*\((\d+)\)/i;

/** dd/mm/aaaa — formato de fecha tal como lo muestra el portal. */
export const RE_FECHA_DDMMYYYY = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
