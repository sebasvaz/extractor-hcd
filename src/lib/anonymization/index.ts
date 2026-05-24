/**
 * Motor de anonimización — nivel **básico**.
 *
 * Alcance (v1): reemplaza identificadores directos del titular que aparecen
 * en el HTML capturado del CDA:
 *
 *   - Nombre del paciente (extraído de la cabecera del CDA, fallback a
 *     displayName). Matching tolerante a acentos y a variaciones en el orden
 *     (ej. "Pérez, Juan" / "Juan Pérez"). Solo cuando el nombre tiene ≥ 2
 *     componentes no triviales, para evitar falsos positivos con palabras
 *     comunes.
 *   - Cédula de Identidad uruguaya: varias formas habituales
 *     (`1.234.567-8`, `1234567-8`, `12345678`, `1234567/8`).
 *   - Teléfonos uruguayos (fijos y móviles) y E.164 internacional.
 *   - Correos electrónicos.
 *
 * Tokens resultantes:
 *   [PACIENTE]        — todas las ocurrencias del mismo paciente mapean aquí
 *   [CI]              — toda cédula uruguaya canónica detectada (7-8 dígitos)
 *   [ID]              — identificador interno del prestador en el header del
 *                       CDA (HCEN/EMPI/id del prestador). Shape variable
 *                       (6/9 dígitos o alfanumérico). Pasada estructural,
 *                       no regex de dígitos. Incidente I-01 (2026-05-23).
 *   [TEL_N]           — enumerados por orden de aparición, consistentes en
 *                       toda la corrida (misma cédula / mismo teléfono →
 *                       mismo token N en todos los documentos).
 *   [EMAIL_N]         — idem
 *
 * NO se anonimiza (garantías explícitas):
 *   - Texto libre clínico (anamnesis, evoluciones, historia).
 *   - Nombres de profesionales y prestadores (a propósito — preserva la
 *     trazabilidad clínica).
 *   - Fechas (clínicas y administrativas).
 *
 * Estrategia de implementación:
 *   Trabajamos sobre el string HTML, NO sobre un DOM. Razones:
 *   (1) evita perder bytes por re-serialización (entidades, whitespace,
 *       comentarios);
 *   (2) JSDOM / DOMParser no existen en el service worker MV3;
 *   (3) el portal ya serializa con charset inconsistente — queremos tocar
 *       lo mínimo indispensable.
 *   Operamos con regex cuidadosamente acotadas, y evitamos reemplazar
 *   dentro de tags (`<...>`) para no romper estructura.
 *
 * Este módulo es **best-effort**. Ver README §Anonimización para los
 * límites explícitos y la recomendación de revisión manual.
 */

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export type AnonymizationScope = 'basic';

export type AnonymizerStats = {
  patientNames: string[];
  telephones: number;
  emails: number;
  cedulas: number;
};

export type Anonymizer = {
  /**
   * Anonimiza el HTML de un documento usando el estado interno del anonimizador.
   * Asignaciones de [TEL_N] / [EMAIL_N] son consistentes entre llamadas.
   */
  apply: (html: string) => string;
  /**
   * Hint: informa al anonimizador de otro nombre posible del paciente
   * (ej. `run.patientDisplayName`). Acumulativo — no reemplaza los nombres
   * ya registrados.
   */
  registerPatientName: (name: string) => void;
  /**
   * Snapshot interno para diagnóstico / auditoría.
   */
  stats: () => AnonymizerStats;
};

export type AnonymizerOptions = {
  scope?: AnonymizationScope;
  /**
   * Si se conoce de antemano el nombre del paciente (p. ej. desde el displayName
   * del header del portal), sembrarlo reduce falsos negativos en docs que no
   * contienen el nombre en la cabecera del CDA.
   */
  seedPatientNames?: string[];
};

/**
 * Crea un anonimizador con estado. Usarlo a lo largo de toda una corrida
 * garantiza que la misma cédula / teléfono / email mapee a los mismos tokens
 * en todos los documentos.
 */
export function createAnonymizer(options: AnonymizerOptions = {}): Anonymizer {
  const patientNames = new Set<string>();
  for (const seed of options.seedPatientNames ?? []) {
    const norm = normalizePatientName(seed);
    if (norm) patientNames.add(norm);
  }
  const telMap = new Map<string, number>();
  const emailMap = new Map<string, number>();
  let telCounter = 0;
  let emailCounter = 0;
  let cedulaCounter = 0;

  const tokenForTel = (key: string): string => {
    let n = telMap.get(key);
    if (n === undefined) {
      telCounter += 1;
      n = telCounter;
      telMap.set(key, n);
    }
    return `[TEL_${n}]`;
  };
  const tokenForEmail = (key: string): string => {
    let n = emailMap.get(key);
    if (n === undefined) {
      emailCounter += 1;
      n = emailCounter;
      emailMap.set(key, n);
    }
    return `[EMAIL_${n}]`;
  };
  const noteCedula = (): void => {
    cedulaCounter += 1;
  };

  return {
    apply(html: string): string {
      // 1) Extraer y sembrar el nombre del paciente desde el CDA (header
      //    típico: "Paciente: <nombre>", "Nombre: <nombre>", etc.). La
      //    primera pasada alimenta el set; las siguientes llamadas lo reusan.
      for (const extracted of extractPatientNamesFromHtml(html)) {
        patientNames.add(extracted);
      }
      // 2) Pasada estructural — Incidente I-01 (2026-05-23). El header
      //    del CDA salud.uy expone el identificador interno del paciente
      //    (HCEN/EMPI/id del prestador) en una celda adyacente a la
      //    etiqueta "Documento". Su shape varía por prestador (9 dígitos
      //    AEPC, 6 dígitos CAMEC, posiblemente alfanumérico) así que la
      //    regex de CI uruguaya (7-8 dígitos) no lo cubre. Reemplazamos
      //    el valor antes de la pasada de texto general para garantizar
      //    tokenización independiente del shape.
      let tokenized = anonymizeCdaHeaderDocumento(html);
      tokenized = anonymizeTextNodesOnly(tokenized, {
        patientNames,
        tokenForTel,
        tokenForEmail,
        noteCedula,
      });
      return tokenized;
    },
    registerPatientName(name: string): void {
      const norm = normalizePatientName(name);
      if (norm) patientNames.add(norm);
    },
    stats(): AnonymizerStats {
      return {
        patientNames: Array.from(patientNames),
        telephones: telMap.size,
        emails: emailMap.size,
        cedulas: cedulaCounter,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Reemplazo acotado a "nodos de texto" del HTML
// ---------------------------------------------------------------------------

export type ReplacementContext = {
  patientNames: Set<string>;
  tokenForTel: (key: string) => string;
  tokenForEmail: (key: string) => string;
  noteCedula: () => void;
};

/**
 * Recorre el HTML aplicando reemplazos solo en los *segmentos de texto* entre
 * tags — es decir, todo lo que queda fuera de `<...>`. Esto preserva
 * atributos, URLs en `href`, scripts (no hay, pero por si acaso), y
 * comentarios sin alterar. Además saltea el contenido completo de
 * `<script>`, `<style>` y `<pre id="b64">` (PDF embebido en CDA nivel 1).
 */
export function anonymizeTextNodesOnly(html: string, ctx: ReplacementContext): string {
  const out: string[] = [];
  let i = 0;
  const len = html.length;

  while (i < len) {
    // Buscar próximo '<'
    const next = html.indexOf('<', i);
    if (next === -1) {
      out.push(applyTextReplacements(html.slice(i), ctx));
      break;
    }
    if (next > i) {
      out.push(applyTextReplacements(html.slice(i, next), ctx));
    }
    // Estamos en un tag. Ver si es una zona protegida.
    const lower = html.slice(next, Math.min(next + 60, len)).toLowerCase();
    let closeTag: string | null = null;
    if (lower.startsWith('<script')) closeTag = '</script>';
    else if (lower.startsWith('<style')) closeTag = '</style>';
    else if (lower.startsWith('<pre') && /id\s*=\s*["']?b64/i.test(lower)) closeTag = '</pre>';
    else if (lower.startsWith('<!--')) closeTag = '-->';

    if (closeTag) {
      const end = html.toLowerCase().indexOf(closeTag, next);
      if (end === -1) {
        // Tag sin cierre — emitimos crudo el resto para no romper nada.
        out.push(html.slice(next));
        break;
      }
      const finalEnd = end + closeTag.length;
      out.push(html.slice(next, finalEnd));
      i = finalEnd;
      continue;
    }

    // Tag normal: copiar hasta el '>'
    const close = html.indexOf('>', next);
    if (close === -1) {
      out.push(html.slice(next));
      break;
    }
    out.push(html.slice(next, close + 1));
    i = close + 1;
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Pasada estructural — header CDA salud.uy: campo "Documento"
// ---------------------------------------------------------------------------

/**
 * Token con el que se reemplaza el valor del campo "Documento" del
 * header del CDA. NO se reusa ``[CI]`` (que está reservado para la
 * cédula uruguaya canónica) porque el identificador puede ser HCEN,
 * EMPI, o id interno del prestador. La capa defensiva del backend
 * (``pii_residual_check._CDA_TOKEN_OR_REDACTED``) acepta cualquier
 * token con shape ``[A-Z_0-9]+``.
 */
const CDA_DOCUMENTO_TOKEN = '[ID]';

/**
 * Regex que matchea el par ``<td>...Documento...</td><td>VALOR</td>`` del
 * header CDA salud.uy. Tolera:
 *
 *   - ``<span class="td_label">Documento</span>`` dentro del primer ``<td>``
 *     (es el shape canónico del XSLT salud.uy) o el texto directo "Documento"
 *     en el ``<td>``.
 *   - Whitespace y newlines entre tags.
 *   - Case-insensitive en "Documento".
 *
 * La regex es global y se aplica por iteración con replace callback para
 * preservar atributos del segundo ``<td>``. El grupo capturado es el
 * contenido textual del segundo ``<td>``.
 */
const RE_CDA_HEADER_DOCUMENTO =
  /<td\b[^>]*>\s*(?:<span\b[^>]*class\s*=\s*["'][^"']*\btd_label\b[^"']*["'][^>]*>\s*)?Documento\s*(?:<\/span\s*>)?\s*<\/td\s*>\s*<td\b([^>]*class\s*=\s*["'][^"']*\btd_header_role_value\b[^"']*["'][^>]*)>\s*([^<]*?)\s*<\/td\s*>/gi;

/**
 * Regex que determina si un valor ya es un token aceptable y por lo tanto
 * no necesita ser reemplazado. Cubre tokens canónicos (``[ALGO]``),
 * cadenas de redacción (``***``, ``XXX``, ``---``), ``N/A`` y vacío.
 *
 * Tiene que coincidir con la equivalente del backend
 * (``pii_residual_check._CDA_TOKEN_OR_REDACTED``) para que cualquier
 * tokenización legítima del front no se considere PII residual en el
 * server.
 */
const RE_CDA_TOKEN_OR_REDACTED = /^\s*(?:\[[A-Z_0-9]+\]|\*+|[Xx]+|[-—]+|N\/?A|n\/?a)?\s*$/;

/**
 * Reemplaza el valor del campo "Documento" del header del CDA por un
 * token ``[ID]``. Si el valor ya está tokenizado o vacío, se preserva
 * tal cual (idempotente). Si la regex no encuentra el par de celdas,
 * devuelve el HTML sin tocar.
 *
 * Exportado para tests. Idempotente y seguro de llamar múltiples veces.
 */
export function anonymizeCdaHeaderDocumento(html: string): string {
  return html.replace(
    RE_CDA_HEADER_DOCUMENTO,
    (full, attrs: string, value: string) => {
      if (RE_CDA_TOKEN_OR_REDACTED.test(value)) {
        return full;
      }
      return `<td class="td_header_role_name"><span class="td_label">Documento</span></td><td${attrs}>${CDA_DOCUMENTO_TOKEN}</td>`;
    },
  );
}


function applyTextReplacements(text: string, ctx: ReplacementContext): string {
  if (text.length === 0) return text;
  let out = text;

  // Orden importa:
  //  1. Emails primero — contienen '@' y '.' y no colisionan con nada.
  //  2. Cédulas (antes que teléfonos) — el patrón de CI es más específico
  //     y previene que un número de 8 dígitos sea tomado como tel fijo.
  //  3. Teléfonos.
  //  4. Nombres del paciente al final — son los que pueden pisar otros
  //     matches, y queremos priorizar los IDs que se reconocen por patrón.

  out = out.replace(RE_EMAIL, (m) => ctx.tokenForEmail(m.toLowerCase()));

  out = out.replace(RE_CEDULA, (m, captured: string) => {
    // Validamos que realmente sea una CI: 7 u 8 dígitos (incluyendo
    // verificador). Evita falsos positivos con números de lab, facturas, etc.
    const digits = captured.replace(/[^\d]/g, '');
    if (digits.length < 7 || digits.length > 8) return m;
    ctx.noteCedula();
    return '[CI]';
  });

  out = out.replace(RE_TEL_UY, (m) => {
    // Normalizamos a solo-dígitos para que "099 123 456" y "099123456"
    // mapeen al mismo token.
    const key = m.replace(/[^\d+]/g, '');
    return ctx.tokenForTel(key);
  });

  // Nombres del paciente
  for (const name of ctx.patientNames) {
    const re = buildPatientNameRegex(name);
    if (re) out = out.replace(re, '[PACIENTE]');
  }

  return out;
}

// ---------------------------------------------------------------------------
// Patrones
// ---------------------------------------------------------------------------

/**
 * Cédula uruguaya. Formatos soportados:
 *   1.234.567-8
 *   1234567-8
 *   1.234.567/8
 *   12345678
 *   1234567
 *   1.234.567 (sin verificador, poco habitual pero existe)
 *
 * `\b` por izquierda y derecha para no recortar números más largos.
 * Captura el texto matcheado para post-validación (longitud de dígitos).
 */
export const RE_CEDULA = /\b(\d{1,3}(?:\.\d{3}){1,2}[-/]?\d?|\d{7,8}[-/]?\d?)\b/g;

/**
 * Teléfono Uruguay:
 *   - móvil:   09X XXX XXX     (9 dígitos empezando en 09)
 *   - fijo MV: 2XXX XXXX       (8 dígitos empezando en 2)
 *   - fijo IN: 4XXX XXXX       (depts del interior)
 *   - intl:    +598 XX XXX XXX (con o sin 0 nacional)
 *
 * Tolera separadores " ", "-", "." entre grupos. Usa `\b` para no pegarse a
 * letras adyacentes.
 */
export const RE_TEL_UY =
  /\+598[\s.\-]?\d{1,2}[\s.\-]?\d{3}[\s.\-]?\d{3,4}\b|\b09\d[\s.\-]?\d{3}[\s.\-]?\d{3}\b|\b(?:2|4)\d{3}[\s.\-]?\d{4}\b/g;

/**
 * Email conservador. No pretende RFC 5322 — solo patrones comunes.
 */
export const RE_EMAIL = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

// ---------------------------------------------------------------------------
// Nombre del paciente — extracción + matching
// ---------------------------------------------------------------------------

/**
 * Intenta extraer nombres del paciente desde un HTML, buscando los patrones
 * de cabecera típicos del CDA del portal (ej. `Paciente: JUAN PEREZ`,
 * `<td>Nombre</td><td>JUAN PEREZ</td>`, `<strong>Paciente</strong>:
 * JUAN PEREZ`). Devuelve **nombres ya normalizados** (sin tildes, lower,
 * compact whitespace).
 *
 * Exportado para tests.
 */
export function extractPatientNamesFromHtml(html: string): string[] {
  const found = new Set<string>();
  const text = stripTagsForRead(html);

  // Patrón 1: etiqueta inline ("Paciente: Juan Perez", "Nombre: ...").
  //
  // `stripTagsForRead` colapsa whitespace a un solo espacio, así que no
  // podemos usar "2+ espacios" como corte entre campos. En vez de eso,
  // frenamos el match apenas aparece la próxima etiqueta conocida
  // (Prestador:, Profesional:, CI:, Teléfono:, Fecha:, Email:) o un
  // terminador duro. La alternancia `[^\n\r,;|]+?` es no-greedy y el
  // lookahead hace el corte sin consumirlo.
  const STOP_LABELS =
    '(?:prestador|profesional|c[eé]dula|ci|documento|dni|tel[eé]fono|tel|email|correo|fecha|nombre\\s+del\\s+prestador|nombre\\s+del\\s+profesional)\\s*[:\\-]';
  const LABEL = new RegExp(
    `\\b(?:paciente|nombre(?:\\s+del\\s+paciente)?|apellidos?\\s+y\\s+nombres?)\\s*[:\\-]\\s*([^\\n\\r,;|]+?)(?=\\s+${STOP_LABELS}|[\\n\\r,;|]|$)`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = LABEL.exec(text)) !== null) {
    const raw = (m[1] ?? '').trim();
    const norm = normalizePatientName(raw);
    if (norm) found.add(norm);
  }

  return Array.from(found);
}

/**
 * Normaliza un nombre a una forma canónica para comparar y dedupe:
 *   - NFD + quita combining marks
 *   - lower-case
 *   - compact whitespace
 *   - trim puntuación de los bordes
 *
 * Devuelve `""` si queda vacío o si es un falso positivo obvio (una sola
 * palabra corta, o números, etc.).
 */
export function normalizePatientName(name: string): string {
  const norm = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = norm.split(' ').filter((p) => p.length >= 2);
  if (parts.length < 2) return '';
  // Heurística anti falso-positivo: al menos 2 componentes alfabéticos de 3+
  // chars (descarta "s a", "de la", etc.).
  const meaningful = parts.filter((p) => p.length >= 3);
  if (meaningful.length < 2) return '';
  return parts.join(' ');
}

/**
 * Construye una regex tolerante para encontrar el nombre en HTML:
 *   - insensible a tildes (matchea `Perez` aunque guardamos `perez`)
 *   - insensible a case
 *   - tolera múltiples espacios entre componentes
 *   - matchea apellido + nombre en cualquier orden
 *   - `\b` en los bordes — no parte palabras
 *
 * Devuelve `null` si el nombre normalizado tiene menos de 2 componentes
 * (fallback seguro — evita reemplazos demasiado laxos).
 */
export function buildPatientNameRegex(normalizedName: string): RegExp | null {
  const parts = normalizedName.split(' ').filter((p) => p.length >= 2);
  if (parts.length < 2) return null;

  // Cada parte: convierte "perez" en "p[eé]r[eé]z" — fuzzy por vocales con
  // tilde. Simple y suficiente para el caso uruguayo (aeiouáéíóú y la ñ).
  const fuzzy = (p: string): string => {
    return p
      .split('')
      .map((ch) => {
        switch (ch) {
          case 'a':
            return '[aá]';
          case 'e':
            return '[eé]';
          case 'i':
            return '[ií]';
          case 'o':
            return '[oó]';
          case 'u':
            return '[uú]';
          case 'n':
            return '[nñ]';
          default:
            return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
      })
      .join('');
  };

  const withComma = parts.map(fuzzy).join(',?\\s+');
  const reversed = parts.slice().reverse().map(fuzzy).join(',?\\s+');

  // `(?:A|B)` con \b en ambos extremos. Flag `gi`.
  return new RegExp(`\\b(?:${withComma}|${reversed})\\b`, 'gi');
}

/**
 * Quita tags para leer el texto plano del HTML — solo para extracción de
 * nombre en cabecera. NO sirve para reemplazar (por eso usamos
 * `anonymizeTextNodesOnly` que respeta tags).
 *
 * IMPORTANTE — restauración de separadores tabulares: el portal Mi HCD
 * presenta los identificadores del paciente en estructura
 * `<td>Etiqueta</td><td>Valor</td>` donde el `:` está implícito en la
 * adyacencia de celdas (no en el texto). Si simplemente borramos tags el
 * matcher de etiquetas ("Nombre: X") falla porque nunca ve los dos puntos.
 * Reintroducimos un `: ` entre celdas adyacentes y un `\n` en borde de
 * fila / `<br>` para que el texto resultante vuelva a tener la forma
 * "Etiqueta: Valor" que nuestros patrones esperan.
 */
function stripTagsForRead(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<pre\b[^>]*id\s*=\s*["']?b64[^>]*>[\s\S]*?<\/pre\s*>/gi, ' ')
    // "<td>Etiqueta</td><td>Valor</td>" → "Etiqueta: Valor"
    .replace(/<\/td\s*>\s*<td\b[^>]*>/gi, ': ')
    // "<tr>" boundary → newline; `<br>` también termina el campo.
    .replace(/<\/tr\s*>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    // Colapsa espacios horizontales pero preserva los `\n` insertados arriba:
    // los terminadores `\n` permiten que el patrón LABEL corte entre campos
    // de filas distintas sin arrastrarse entre ellas.
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}
