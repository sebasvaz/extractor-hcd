# Descargá tu HCD — Extensión Chrome para Mi HCD

Extensión Chrome (Manifest V3) pensada para que cualquier ciudadano uruguayo
titular de una cuenta en **Mi HCD** (`historiaclinicadigital.gub.uy`) pueda
descargar, en unos minutos y con un click, **toda su historia clínica digital**
como un ZIP ordenado: un HTML por documento, más un `metadata.json` canónico y
un `log.txt` de la corrida.

Ese mismo ZIP es también la **entrada de referencia** del pipeline server-side
que genera automáticamente el **Resumen del Paciente (IPS / International
Patient Summary)** mediante IA Generativa — esto es una tesis de grado, no un
producto clínico, pero la herramienta de descarga es útil por sí sola y se
libera para que cualquier titular la use.

Base legal del uso por parte del titular: **art. 14 de la Ley 18.331**
(derecho de acceso a los propios datos personales).

Proyecto Final de investigación — Licenciatura en Sistemas, Universidad ORT
Uruguay. Tutor: Gerardo Matturro. Entrega prevista: 2026-09-15.

---

## Alcance (v1.0)

Alineado a la *Especificación Técnica v1.0* que vive en el proyecto
(`Especificacion_Tecnica_Extension_HCD.docx`). La v1.0 **no** parsea CDA — el
parseo estructural y la extracción clínica semántica se mueven al pipeline
server-side, donde se pueden versionar y auditar con más cuidado. Sí incluye
**anonimización básica opcional** del lado cliente (ver §13 más abajo), para
que el titular pueda compartir o archivar el ZIP sin tener que sanear él mismo
los identificadores directos.

Qué hace la extensión:

- Lee el total de registros del portal ("Mostrando del X al Y de T resultados").
- Itera página a página del timeline (sin saltar: siempre "Siguiente →").
- Por cada evento: click nativo → espera postback GeneXus → espera renderizado
  del `iframe[name="CONTENIDOHTML"]` → serializa el documento completo a HTML.
- Acumula el corpus en memoria del service worker (HTML + metadata + errores).
- **Anonimización básica opcional** (toggle en el popup): si está activado,
  reemplaza en cada HTML el nombre del paciente, la cédula UY, el teléfono UY
  y el email por tokens estables (`[PACIENTE]`, `[CI]`, `[TEL_N]`, `[EMAIL_N]`)
  consistentes a lo largo de todo el paquete. El SHA-256 se recalcula sobre el
  HTML anonimizado para que `metadata.json` quede coherente.
- Al finalizar, arma `hcd_export_<slug>_<yyyy-mm-dd_hhmm>.zip` con:
  - `metadata.json` (schema v1.0 — Anexo A de la spec, incluyendo flags
    `anonymized` / `anonymizationScope` si la corrida fue anonimizada).
  - `log.txt` con el log circular de la corrida.
  - `README.txt` humano.
  - `docs/<fecha>_<categoria>_<descripcion>.html` por evento capturado.
- **Auto-descarga** del ZIP al completar: dispara `chrome.downloads` con
  `saveAs: true` para que el titular elija carpeta. Si falla el diálogo, el
  ZIP queda disponible en el popup con el botón **Descargar ZIP**.

Qué *no* hace (garantías negativas):

- No parsea CDA. El HTML se guarda tal como el portal lo renderiza.
- No anonimiza el contenido clínico libre, ni profesionales, ni prestadores,
  ni fechas — la anonimización básica se limita a identificadores directos
  del titular (ver §13). Si se necesita anonimización más agresiva, ese
  tratamiento corresponde al pipeline server-side aguas abajo.
- No hace redacción semántica del contenido PDF. Cuando la anonimización
  básica está activada y el documento es CDA nivel 1 (PDF embebido en
  `<pre id="b64">`), la extensión superpone un **rectángulo blanco sobre la
  franja de datos del paciente** del cabezal del PDF usando `pdf-lib`. Es
  **redacción visual**: los bytes del texto original siguen presentes en el
  content stream del PDF y son recuperables con un selector de texto o con
  herramientas forenses. Para redacción semántica (eliminación del stream)
  el ZIP debe pasar por la segunda pasada `pymupdf` en el backend del
  pipeline IPS, ver §13.
- No hace fetch cross-origin. Solo consume el DOM de pestañas ya abiertas en
  `historiaclinicadigital.gub.uy` (host permission explícito en el manifest).
- No envía telemetría. No hay endpoints remotos. No hay analítica.
- No lee credenciales, cookies de otros dominios, historial, ni el contenido
  de otras pestañas.
- No persiste datos clínicos a disco. La memoria del service worker y el
  `chrome.storage.session` (que vive en RAM del browser y se borra al
  cerrarlo) son las únicas ubicaciones donde habita el corpus antes de que
  el titular decida dónde guardar el ZIP con el diálogo nativo de Chrome.
- No ejecuta scripts remotos, no evalúa código dinámico, no carga recursos
  desde CDNs. Todas las dependencias (p. ej. JSZip) van bundleadas.

---

## Arquitectura

| Componente | Archivo | Rol |
|---|---|---|
| Service Worker | `src/background/service-worker.ts` | Máquina de estados, orquesta el scraper, arma el ZIP, dispara `chrome.downloads`. |
| Content Script | `src/content/scraper.ts` | "Ojos y manos" en la pestaña. Parsea totales, lista eventos, click nativo, espera iframe, extrae HTML. |
| Overlay | `src/content/overlay.ts` | Indicador flotante con Shadow DOM (estado + progreso + Cancelar). |
| Popup | `src/popup/popup.ts` | 360×480, inicia/cancela/descarga, muestra últimos 20 eventos, ver log. |
| Mensajería | `src/lib/messaging/types.ts` | Contratos tipados; única fuente de verdad. |
| Selectores | `src/lib/selectors.ts` | Centralizados — punto único para parches ante cambios del portal. |
| Categorías | `src/lib/categories.ts` | Lista cerrada de categorías asistenciales (Anexo B de la spec). |
| Slugs | `src/lib/slug.ts` | Normalización NFD + dedupe determinista. |
| Paginación | `src/lib/pagination.ts` | Parseo del pie canónico y fallback de menú lateral. |
| ZIP builder | `src/lib/zip-builder.ts` | Assembly del paquete; `metadata.json` conforme a Anexo A. |
| Anonimización | `src/lib/anonymization/index.ts` | Motor opcional de anonimización básica: tokeniza nombre, CI UY, tel UY, email con consistencia cross-document. |
| Redacción PDF | `src/lib/pdf-redact.ts` | Overlay visual (rectángulo blanco opaco + `pdf-lib`) sobre la franja de datos del paciente en el cabezal de cada PDF embebido. Se activa junto con el toggle de anonimización. |
| Log circular | `src/lib/log.ts` | `CircularLog` en memoria, serializable a `log.txt`. |
| Hash | `src/lib/hash.ts` | SHA-256 vía `crypto.subtle`. |

### Invariantes operacionales (spec §5.4)

- Delay mínimo de **800 ms** entre capturas (respeto al servidor).
- Backoff exponencial ante fallos: 1 s → 2 s → 4 s → 8 s → 16 s (cap).
- Hasta 3 reintentos por evento antes de sumarlo a `errors[]`.
- Avance **lineal** por páginas — nunca se salta; si falla la navegación se
  reintenta con backoff.
- `ensurePage(target)` idempotente antes de cada evento: si ya estamos en la
  página correcta no hace nada, si estamos atrás avanza con "Siguiente", y si
  estamos adelante resetea al timeline y re-avanza (evita duplicar capturas
  cuando un `history.back()` deja el portal en pág 1 sin avisar).
- **Deduplicación por SHA-256** del HTML capturado como red de seguridad:
  si un mismo contenido llega dos veces por cualquier motivo, se descarta la
  segunda con un `WARN` en el log y no entra al ZIP.
- Cancelar es inmediato; la descarga parcial queda disponible vía el popup.
- **Persistencia del ZIP en `chrome.storage.session`**: al terminar la
  corrida se arma el ZIP y se guarda como data URL en session storage, de
  modo que el botón "Descargar ZIP" siga funcionando aunque el service
  worker sea descargado por idle timeout (~30 s en MV3).

---

## Prerequisitos

- Google Chrome / Chromium reciente.
- Cuenta Mi HCD propia (titular).
- *(Solo si buildeás desde fuente)* Node.js 20 LTS (ver `.nvmrc`).

## Puesta en marcha

### Opción A — Instalar desde un Release

Si no querés compilar nada, este es el camino más corto:

1. Andá a la pestaña **Releases** del repositorio en GitHub y bajá el ZIP
   de la última versión (p. ej. `extractor-hcd-v1.0.0.zip`). Verificá el
   `.sha256` que lo acompaña si te importa la integridad.
2. Descomprimí el ZIP en una carpeta estable (no la de Descargas — Chrome
   la desactiva si movés o borrás la carpeta).
3. Abrí `chrome://extensions/`, activá **Modo desarrollador** (arriba a la
   derecha), y click en **Cargar extensión descomprimida**.
4. Seleccioná la carpeta descomprimida.

Esta modalidad **no tiene auto-update**: para actualizar hay que repetir
los pasos con el nuevo Release. Si / cuando la extensión se publique en
la Chrome Web Store, este paso se reemplaza por un "Agregar a Chrome".

### Opción B — Buildear desde el código

```bash
cd extension
npm ci
npm run typecheck    # TS strict + exactOptionalPropertyTypes
npm test             # tests (slug, pagination, zip-builder, anonimización)
npm run build        # genera dist/
```

Después, mismos pasos 3 y 4 de la Opción A, pero apuntando a
`extension/dist/`.

Para empaquetar un ZIP listo para distribución (igual al que adjuntan los
Releases), usá:

```bash
./scripts/make-release.sh           # usa la versión de package.json
./scripts/make-release.sh v1.0.1    # o una explícita
```

El ZIP y su `.sha256` quedan en `./release/`.

### Verificación post-instalación

El ícono aparece en la barra. Al abrir Mi HCD e iniciar sesión, el popup
muestra el dot verde "Conectado a historiaclinicadigital.gub.uy" y habilita
el botón **Iniciar extracción**.

### Desarrollo con HMR

```bash
npm run dev
```

CRXJS levanta Vite en watch y recompila en caliente. Cambios en el manifest
requieren recargar la extensión.

---

## Flujo de uso

1. El titular se autentica en Mi HCD y navega al listado ("Todos los
   registros").
2. Abre el popup de la extensión. Opcionalmente marca **"Anonimizar
   identificadores directos"** antes de arrancar (la preferencia queda
   recordada entre sesiones).
3. Click en **Iniciar extracción**.
4. El overlay flotante muestra `N / T`, página actual y botón Cancelar.
5. Al finalizar, la extensión dispara automáticamente el diálogo nativo de
   Guardar con un nombre `hcd_export_<slug>_<yyyy-mm-dd_hhmm>.zip`. El popup
   queda mostrando un **panel "Corrida completada"** con nombre, tamaño y
   hora del ZIP, y un botón **Descargar ZIP** que reabre el diálogo tantas
   veces como haga falta (por si el titular cerró el primero sin guardar).
6. El ZIP es de uso libre del titular: archivarlo, compartirlo con un médico,
   o subirlo al experimento server-side del pipeline IPS.

---

## Permisos (justificación — spec §9.2)

| Permiso | Por qué |
|---|---|
| `storage` | Configuración del usuario (opcional); log circular se mantiene en RAM. |
| `downloads` | Disparar descarga del ZIP con `saveAs: true`. |
| `scripting` | Reinyectar helpers si se recarga la pestaña. |
| `tabs` | Identificar la pestaña activa y mandarle mensajes tipados. |
| `webNavigation` | Detectar cambios de URL del postback GeneXus (evt=5). |
| `host_permissions` | Solo `https://historiaclinicadigital.gub.uy/*`. |

CSP estricta (`script-src 'self'; object-src 'self'; base-uri 'self'`). Sin
`unsafe-eval`, sin scripts remotos, sin CDN. JSZip va **bundleado**.

---

## Resguardos y consideraciones de privacidad

Esta extensión manipula **datos personales sensibles de salud** según la
*Ley N.º 18.331* (Uruguay, Protección de Datos Personales, art. 18). Los
resguardos a continuación aplican a cualquier uso: el propio titular usando
la herramienta para descargar su historia clínica (caso principal), o el
uso en el marco del Proyecto Final como fuente del pipeline IPS. La
herramienta es libre y el titular decide qué hacer con el ZIP resultante;
los resguardos operan al nivel del código para que ninguna decisión del
usuario implique una fuga de datos fuera de su control.

### 1. Marco de consentimiento

- La extensión opera **únicamente sobre la sesión autenticada del titular**.
  No automatiza el login, no suplanta identidad, no requiere ni pide
  credenciales: el titular inicia sesión manualmente y solo entonces la
  extensión puede leer lo que el propio navegador ya está mostrando.
- No hay un segundo actor. El corpus resultante pertenece al titular y solo
  él decide si lo guarda, lo comparte, o lo descarta — la herramienta no lo
  sube a ningún lado de forma automática.
- Base legal:
  - **Art. 14 Ley 18.331** — derecho de acceso del titular: todo ciudadano
    puede solicitar los datos personales que un responsable tiene sobre él.
    Esta herramienta ejerce ese derecho de manera directa y automatizada
    sobre un portal donde el titular ya está autenticado.
  - **Art. 9 Ley 18.331** — consentimiento del titular, en los casos en que
    el ZIP se destine a un proyecto de investigación (literal E, fines
    históricos / estadísticos / científicos).
  - El titular es a la vez *responsable* y *usuario* del tratamiento — no
    hay un tercero procesando los datos fuera de su dispositivo.

### 2. Minimización y finalidad

- Solo se capturan los documentos clínicos visibles en la línea de tiempo
  del titular. Ningún otro dato del portal (agenda, contactos, etc.) se
  extrae ni se toca.
- No se conservan credenciales, cookies, tokens ni identificadores de
  sesión en el ZIP ni en el log. Lo único que queda es el HTML renderizado
  del evento, su metadata de catálogo, y timestamps.
- La finalidad de cada corrida la decide el titular. El `README.txt`
  incluido en el ZIP describe en texto plano qué hay en el paquete y qué
  precauciones tomar si se decide compartirlo (médicos tratantes,
  investigación, archivo personal). La extensión no impone un uso concreto.

### 3. Credenciales y autenticación

- La extensión **nunca lee ni almacena** usuario, contraseña, token de
  sesión, cookies de cédula/CI, ni datos del certificado del dispositivo.
- No hay ningún `document.cookie`, `chrome.cookies.*`, ni
  `webRequest.onBeforeSendHeaders` en el código. El permiso `cookies` no
  está declarado en el manifest — no podría leerlas aunque quisiera.
- La sesión vive exclusivamente en el perfil de Chrome del titular; la
  extensión se limita a consumir el DOM que el portal ya autenticó.

### 4. Almacenamiento

| Lugar | Qué guarda | Vida útil | Riesgo |
|---|---|---|---|
| Memoria del Service Worker | Corpus completo durante la corrida | Hasta idle (~30 s) o cierre de browser | RAM, no persistente |
| `chrome.storage.session` | ZIP armado + snapshot de progreso | Hasta cerrar Chrome | RAM, no escribe disco |
| Disco del usuario | ZIP final si el titular confirma el `saveAs` | Lo que el titular decida | **Decisión del titular** |

- `chrome.storage.local` no se usa para datos clínicos. Eso sería
  persistencia a disco no cifrada a través de reinicios — descartado.
- `chrome.storage.session` sí se usa, porque por contrato vive en memoria
  del browser y se borra al cerrarlo. Es una trade-off explícita a cambio
  de sobrevivir al idle timeout del SW (§ Invariantes).
- El ZIP final va al disco **únicamente** mediante el diálogo nativo de
  `chrome.downloads` con `saveAs: true` — el titular elige carpeta, o
  cancela y nada llega al disco.

### 5. Sin exfiltración

- No hay `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` ni
  `navigator.sendBeacon` hacia ningún host distinto de
  `historiaclinicadigital.gub.uy`, y todo lo que va hacia ese host es el
  tráfico normal que ya generaría el usuario navegando (no se forjan
  requests propias).
- No hay telemetría, analítica, reporte de crashes ni "phone home". El log
  es estrictamente local y solo sale del navegador si el titular exporta
  el ZIP.

### 6. Integridad y trazabilidad

- Cada documento trae un **SHA-256** de su HTML en `metadata.json` — el
  pipeline server-side puede verificar que el archivo no se modificó entre
  la captura y el procesamiento.
- Cuando el documento es CDA nivel 1 (PDF embebido vía `<pre id="b64">`),
  el PDF se extrae a `docs/<id>.pdf` con su propio SHA-256
  (`attachmentSha256`), preservando los bytes originales del portal.
- `log.txt` contiene la trazabilidad completa de la corrida: cuántos
  eventos por página, reintentos, duplicados descartados, errores. El log
  **no contiene contenido clínico** — solo metadata de operación, para
  que pueda compartirse con los tutores sin exposición de datos sensibles.
- `metadata.json` incluye `errors[]` con los eventos que fallaron, de modo
  que una corrida parcial es auditable: se sabe qué falta y por qué.

### 7. Respeto al servidor del portal

- Delay mínimo obligatorio de 800 ms entre capturas.
- Backoff exponencial ante fallos (1 s → 16 s cap), y un máximo de 3
  reintentos por evento — la extensión nunca entra en un loop tight.
- Avance estrictamente lineal por las páginas del timeline, usando los
  mismos botones que usa un usuario humano. No hay API interna utilizada
  ni endpoints no documentados consumidos por fuera del UI.
- El tráfico generado es del orden de *decenas de clicks* por corrida,
  espaciados — está por debajo del que generaría el propio titular
  navegando manualmente su HCD.

### 8. Borrado y derecho al olvido

- Al cancelar una corrida y cerrar el browser: toda la RAM se libera.
  Nada sobrevive.
- Al iniciar una corrida nueva: la anterior se borra de `storage.session`
  antes de empezar (`clearPersistedZip`), para que "Descargar ZIP" nunca
  entregue un archivo viejo por error.
- El único artefacto persistente es el ZIP en disco — **lo elimina el
  titular cuando quiera**, es un archivo plano en la carpeta que eligió.

### 9. Superficie de ataque mínima

- Manifest V3, CSP estricta (`script-src 'self'; object-src 'self'`).
- Sin `unsafe-eval`, sin `new Function`, sin `innerHTML` con contenido del
  portal (se usa `textContent` para extraer texto y `XMLSerializer` para
  serializar el iframe).
- Todas las dependencias bundleadas — no hay sorpresas vía
  `<script src="https://…">`.
- Permisos del manifest reducidos al mínimo: `storage`, `downloads`,
  `scripting`, `tabs`, `webNavigation`. No declara `cookies`, `webRequest`,
  `<all_urls>`, `activeTab`, `nativeMessaging`, ni `management`.
- `host_permissions` scoped a un único dominio
  (`https://historiaclinicadigital.gub.uy/*`). La extensión es incapaz de
  correr o leer nada fuera de Mi HCD.

### 10. Reproducibilidad y auditoría externa

- Build determinístico: `npm ci && npm run build` regenera `dist/`
  idéntico a menos del hash de los chunks (Vite). El tribunal puede
  re-buildar desde el código fuente y comparar.
- Tests unitarios cubren slug, paginación y metadata (`npm test`, 34
  tests). No hay lógica clínica en la extensión — toda la interpretación
  sucede en el pipeline server-side, aguas abajo.
- Código fuente completo dentro del proyecto de tesis; sin binarios
  opacos, sin ofuscación.

### 11. Uso aceptable (lo que NO hay que hacer)

- No usar sobre la sesión de otra persona. La herramienta está pensada
  para que el titular ejerza su derecho de acceso sobre sus propios
  datos. El uso sobre cuentas de terceros — aun con consentimiento
  verbal — queda fuera del marco contemplado; si existe representación
  legal (p. ej. padre/madre de un menor, tutor, poder), esa
  responsabilidad corre por cuenta de quien ejecuta.
- No confundir el ZIP con un **documento oficial**. Es una copia fiel
  de lo renderizado por el portal; para trámites formales (juntas
  médicas, sede judicial, solicitudes de reintegro) corresponde pedir
  la copia oficial al operador del portal.
- No integrar esta extensión como componente de un producto comercial o
  clínico de producción — no está validada para eso (ver *Limitaciones*).
- Si el ZIP se comparte con terceros ajenos al equipo médico del titular,
  activar el toggle de anonimización básica (§13) y revisar igualmente
  el contenido antes de enviar — recordar que la anonimización es
  best-effort y no toca texto clínico libre.

### 12. Limitaciones conocidas

- Es un **scraper de UI**. Cualquier cambio del portal Mi HCD puede
  romperla; los selectores están centralizados en `src/lib/selectors.ts`
  para parchar rápido, pero no hay contrato con el portal.
- No tiene validación oficial de ASSE / MSP / AGESIC. Es una herramienta
  independiente del operador del portal.
- No intenta manejar documentos clínicos que no se rendericen como HTML
  en el iframe `CONTENIDOHTML` o como PDF embebido (`<pre id="b64">`).
  Formatos fuera de esos dos patrones se registran en `errors[]` del
  metadata.
- La autenticación por cédula con certificado / hardware token es manual:
  si la sesión expira durante la corrida, la extensión detecta pérdida de
  sesión y pausa; al reautenticar, se puede reanudar manualmente.

### 13. Anonimización básica (opcional)

La extensión incluye un **toggle opcional** "Anonimizar identificadores
directos" en el popup. Por defecto está **apagado** — el ZIP queda con el
contenido exacto del portal, como lo ve el titular en pantalla — porque el
titular suele querer compartir el paquete con un médico tratante, que
necesita los identificadores para poder usarlo. La anonimización tiene
sentido sobre todo cuando el ZIP se va a **archivar**, **subir a un
experimento de investigación** (como el pipeline IPS de este proyecto) o
**compartir con un tercero que no necesita identificarlo personalmente**.

**Qué anonimiza cuando está activado:**

| Token | Qué reemplaza | Fuente |
|---|---|---|
| `[PACIENTE]` | Nombre completo del titular tal como figura en el encabezado de los documentos | `patient.displayName` del portal |
| `[CI]` | Cédula de identidad uruguaya (formatos `1.234.567-8`, `12345678`, `1234567/8`) | Regex con filtro de longitud 7-8 dígitos |
| `[TEL_1]`, `[TEL_2]`... | Teléfonos uruguayos (móviles `09X XXX XXX`, fijos `2XXX XXXX`/`4XXX XXXX`, con o sin `+598`) | Regex de patrones UY |
| `[EMAIL_1]`, `[EMAIL_2]`... | Correos electrónicos | Regex RFC-ish pragmático |

Los contadores (`TEL_N`, `EMAIL_N`) **se mantienen estables a lo largo de
toda la corrida**: si el mismo número aparece en tres documentos distintos,
recibe el mismo token en los tres. Esto conserva correlaciones útiles para
análisis sin revelar el valor original.

**Qué NO anonimiza** (por diseño):

- **Texto clínico libre**: diagnósticos, evolución, HEA, plan terapéutico,
  resultados de laboratorio, nombres de medicamentos, dosis. Todo eso se
  preserva tal cual — es la razón de ser del ZIP.
- **Profesionales**: "Dra. María Rodríguez" queda tal cual. Son datos
  públicos del sistema de salud y su presencia es necesaria para
  interpretar el documento.
- **Prestadores**: ASSE, mutualistas, policlínicas también quedan tal cual.
- **Fechas**: se preservan — desplazarlas rompería la interpretación
  temporal del historial, y eliminarlas rompería la trazabilidad.
- **Atributos de HTML**: la anonimización nunca toca el interior de los
  tags (por ejemplo, un `mailto:foo@bar.com` en un `href` queda intacto),
  sólo actúa sobre texto visible para evitar romper estructura.
**Qué sí hace la extensión con los PDFs embebidos** (CDA nivel 1 con
`<pre id="b64">`, típicamente resultados de Laboratorio):

Cuando la anonimización básica está activada, además del reemplazo en el
HTML-wrapper, la extensión **superpone un rectángulo blanco opaco**
(`pdf-lib`) sobre la franja de datos del paciente en **cada página** del
PDF adjunto, acompañado de la etiqueta `[DATOS PERSONALES REDACTADOS]`.
La banda está posicionada para cubrir la tabla Nombre / Identificación /
Orden / Matrícula / Prestador / Fecha del estudio, dejando visible por
arriba el encabezado institucional del laboratorio (logo, dirección,
directora técnica) y por debajo los títulos clínicos del estudio
("HEMOGRAMA", "Método: …", etc.), que no son datos personales y se
preservan por trazabilidad. El código vive en
[`src/lib/pdf-redact.ts`](src/lib/pdf-redact.ts); los parámetros de
posición son dos constantes `HEADER_REDACT_TOP_OFFSET_PT` y
`HEADER_REDACT_HEIGHT_PT` tuneables a vista si algún prestador emite con
un layout distinto.

**Esto es redacción visual, no semántica.** El rectángulo cubre
ópticamente los datos pero **los bytes del texto original siguen intactos
en el content stream del PDF**. En un visor PDF estándar el texto sigue
siendo seleccionable y copiable aunque no se vea, y cualquier herramienta
forense puede extraerlo. Es una capa de "higiene visual" —el PDF no
muestra nombre ni CI en pantalla— pero **no** es desidentificación
formal.

**Por qué es razonable dejar la redacción visual como primera pasada y
diferir la real al pipeline server-side:**

1. La extensión corre en un Service Worker MV3 (limitado en memoria y
   sin DOM) — cargar un parser/renderer PDF completo capaz de eliminar
   bytes del content stream agregaría ~2 MB al bundle con riesgos
   conocidos de pdf.js en SW MV3.
2. Para este proyecto de investigación, todo ZIP pasa por el backend de
   la Plataforma IPS antes de que el texto llegue a cualquier LLM. Ese
   backend aplica [`app/ips/pdf_redact.py`](../platform/backend/app/ips/pdf_redact.py)
   usando `pymupdf` (`page.add_redact_annot` + `page.apply_redactions`),
   que **busca el nombre y la CI del titular en cada página y elimina
   el texto del content stream** — redacción real. Ese ZIP redactado es
   el que se persiste en `ingest_zip()` y alimenta el resto del
   pipeline.
3. El overlay visual de la extensión **no interfiere** con la pasada
   pymupdf — pymupdf trabaja sobre los objetos de texto del stream, no
   sobre rectángulos de anotación. Aplicarse las dos es idempotente.

**Limitación conocida del overlay visual de la extensión** (por diseño,
best-effort):

La banda se dibuja en una posición fija de cada página. Si un prestador
distinto emite el PDF con los datos del paciente en otra zona (p. ej.
pie de página, columna lateral), esa instancia **no queda cubierta
visualmente** por la extensión. En ese caso el dato sigue estando
redactado textualmente en el HTML-wrapper (donde sí lo captura el
anonimizador basado en regex), y vuelve a quedar cubierto en la pasada
pymupdf del backend — que opera por búsqueda de texto y no por
coordenadas, de modo que encuentra el dato independientemente de dónde
esté en la página. La capa visual de la extensión es complemento
cosmético, no línea de defensa única.

**Si la extensión se usa fuera del pipeline IPS** (p. ej. el titular
quiere compartir el ZIP con alguien que no va a pasarlo por la
plataforma), y si importa que el texto PDF no sea recuperable, entonces
hay que aplicar redacción real externa al ZIP antes de compartirlo (por
ejemplo con `pymupdf` localmente, o con `qpdf --linearize` + un redactor
PDF que elimine del stream). El `README.txt` dentro del ZIP explicita
esto cuando la corrida fue anonimizada.

**Cómo se verifica en el paquete:**

- `metadata.json` incluye `anonymized: true` y
  `anonymizationScope: "basic"` cuando la corrida fue anonimizada.
- El `README.txt` del ZIP explica qué se anonimizó y qué no.
- Los SHA-256 de cada documento se **recalculan sobre el HTML
  anonimizado**, de modo que `metadata.json` sigue siendo criptográficamente
  consistente con los archivos de `docs/` que lo acompañan.
- La operación es **idempotente**: aplicar la anonimización dos veces no
  cambia nada (cubierto por tests).

**Caveat explícito — es "best effort", no HIPAA Safe Harbor:**

Esta anonimización opera con **expresiones regulares** sobre el HTML
renderizado. Está pensada para cubrir los identificadores que sistemáticamente
aparecen en los encabezados y pies de los documentos del portal Mi HCD, no
para defenderse de un adversario determinado ni para garantizar
re-identificación imposible. Específicamente:

- No intenta detectar **nombres de terceros** mencionados en el cuerpo
  clínico (familiares, contactos de emergencia escritos en texto libre).
- No intenta detectar **direcciones postales**.
- No intenta detectar **fechas estadísticamente únicas** (por ej. fechas de
  internación que reduzcan el k-anonymity del set).
- Puede haber **falsos negativos** si el portal cambia el formato de
  presentación de un dato, y **falsos positivos** no son esperables
  porque los regex son conservadores.

**Recomendación**: si el ZIP se va a compartir con alguien fuera del círculo
de confianza médica del titular, revisar el contenido de los HTML antes de
enviarlo. La anonimización básica es un piso razonable, no un techo.

El código vive en `src/lib/anonymization/index.ts` y está cubierto por
tests (`src/lib/anonymization/anonymization.test.ts`) que validan
patrones, consistencia de tokens, preservación de contenido clínico,
respeto de atributos HTML y del `<pre id="b64">`.

---

```jsonc
{
  "schemaVersion": "1.0",
  "exportId": "<uuid v4>",
  "exportedAt": "<iso-8601>",
  "startedAt": "<iso-8601>",
  "source": { "portal": "Mi HCD — historiaclinicadigital.gub.uy", "baseUrl": "https://..." },
  "patient": { "displayName": "Juan Pérez", "documentHash": "<opt>" },
  "totals": { "expected": 45, "captured": 43, "failed": 2 },
  "documents": [
    {
      "id": "2026-04-15_policlinica_consulta-medica",
      "file": "docs/2026-04-15_policlinica_consulta-medica.html",
      "categoria": "Policlínica",
      "fecha": "2026-04-15",
      "prestador": "...", "profesional": "...", "descripcion": "...",
      "visualizarUrl": "https://...",
      "captureUrl": "https://...",
      "capturedAt": "<iso>",
      "sha256": "<hex64>"
    }
  ],
  "errors": [
    { "categoria": "...", "fecha": "...", "descripcion": "...", "url": "...", "message": "...", "occurredAt": "<iso>" }
  ]
}
```

Validado en `src/lib/zip-builder.test.ts` contra los campos obligatorios y el
patrón UUID v4.

---

## Roadmap

| Fase | Entregable | Estado |
|---|---|---|
| v1.0 | Scraper + ZIP + metadata schema v1.0 | ✅ implementado |
| v1.0 | Extracción PDF de CDA nivel 1 (`<pre id="b64">`) | ✅ implementado |
| v1.0 | Deduplicación SHA-256 + `ensurePage` idempotente | ✅ implementado |
| v1.0 | Persistencia de ZIP en `chrome.storage.session` | ✅ implementado |
| v1.0 | Anonimización básica opcional client-side | ✅ implementado |
| v1.0 | Auto-descarga + panel persistente "Corrida completada" | ✅ implementado |
| v1.1 | Tests de integración contra un snapshot offline del DOM del portal | pendiente |
| v1.2 | Modo "reanudar corrida" tras hibernación del SW | parcial (progreso sí, cola de trabajo no) |
| v1.x | Anonimización extendida (terceros mencionados, direcciones) | idea — requiere NER en el cliente |
| —    | Parseo CDA estructural | **fuera de alcance** — pipeline server-side |

---

## Distribución

La intención declarada del proyecto es que la extensión sea una **herramienta
libre para cualquier titular uruguayo** de Mi HCD que quiera ejercer el
derecho de acceso del art. 14 de la Ley 18.331. Durante la vigencia del
Proyecto Final el canal de distribución que tiene sentido es el **código
fuente + build local** desde este repositorio (es decir, "Load unpacked"
sobre `dist/`); una publicación más amplia requiere pasos adicionales que se
listan más abajo.

### Canales disponibles

| Canal | Qué implica | Estado |
|---|---|---|
| **Load unpacked** (código fuente) | El usuario clona o descarga el repo, corre `npm ci && npm run build`, carga `dist/` en `chrome://extensions/`. Máxima auditabilidad, cero intermediarios. | ✅ disponible hoy |
| **ZIP firmado + README** | Paquete `dist/` entregado al tribunal de tesis; reproducible con `npm ci && npm run build`. | ✅ para la entrega académica |
| **Chrome Web Store — Unlisted** | Enlace directo; la extensión no aparece en búsquedas de la Store. Útil para usuarios no-técnicos del círculo de prueba (tutor, compañeros, primeros titulares interesados). | pendiente |
| **Chrome Web Store — Public** | Listado público buscable desde Chrome. Requiere los pasos descritos abajo antes de activarlo. | pendiente |

### ¿Publicar en la Chrome Web Store como *Public*?

**Técnicamente la extensión cumple los requisitos** de la CWS: Manifest V3,
CSP estricta, permisos justificados de a uno, sin scripts remotos, sin código
ofuscado, sin telemetría, single-purpose claro. El proceso de review de
Google debería aprobarla.

**Antes de activar *Public* tiene sentido resolver algunos puntos**:

1. **Conversación previa con el operador del portal.** `historiaclinicadigital.gub.uy`
   es operado por ASSE / AGESIC. La extensión no hace nada que el titular
   no pudiera hacer manualmente en su propia sesión autenticada —
   consume el DOM que el portal ya le entrega, respetando un delay mínimo
   y backoff — y el fundamento legal (art. 14 Ley 18.331) es sólido.
   Aun así, publicar una herramienta que automatiza el acceso masivo
   sin avisar al operador genera tensión innecesaria; una nota previa de
   no-objeción (o al menos de notificación) evita fricciones.
2. **Política de privacidad pública.** Obligatoria para cualquier extensión
   que maneje datos personales (art. 93 del *Developer Program Policies*
   de la CWS). Alojarla en una URL estable reutilizable desde el popup y
   la ficha de la Store.
3. **Plan de sostenimiento.** La extensión es un *scraper de UI* — si el
   portal cambia un selector, la extensión se rompe. Antes de publicarla
   como *Public* conviene tener definido quién parchea cuando eso pase
   (hoy ese rol lo cubre el tesista; no escala al cerrar la tesis).
4. **Contacto de reporte de vulnerabilidades** visible en la ficha de la
   Store y en el repositorio.

Una vez hechos esos pasos, publicar en *Public* es compatible con el
objetivo del proyecto: que cualquier titular de Mi HCD pueda bajarse su
HCD sin tener que pedirle nada a nadie.

### Caveats permanentes para cualquier canal

- La extensión es **independiente del operador del portal**. No está
  validada por ASSE / MSP / AGESIC. Si en algún momento esas instituciones
  ofrecen un mecanismo oficial equivalente (p. ej. un botón de exportación
  nativo), ése debería ser el canal preferido y esta extensión pasa a ser
  un respaldo.
- El ZIP no es un documento oficial; es una **copia fiel** de lo que el
  portal le renderizó al titular en un momento dado. Para usos formales
  (ante un tribunal, una junta médica, etc.) lo correcto sigue siendo
  solicitar una copia oficial al operador del portal.
- Los resguardos técnicos (§3-§10) no cambian entre canales. Lo que cambia
  es el canal de actualización y la exposición a usuarios no-técnicos.

---

## Contribuir y reportar

- Bugs, falsos positivos/negativos de anonimización, mejoras de
  documentación: abrí un Issue en el repositorio (ver `CONTRIBUTING.md`).
- Problemas de seguridad: **no los abras como Issue público**. Mandá un
  mail según el procedimiento descrito en `SECURITY.md`.
- Política de privacidad: `PRIVACY.md`.

## Cómo citar

Si usás esta herramienta en trabajo académico, citá el repositorio
(`CITATION.cff`) y, cuando corresponda, la tesis que le da origen. GitHub
expone un botón "Cite this repository" en la página del repo que genera
el `BibTeX` / `APA` automáticamente a partir de ese archivo.

## Licencia y responsabilidad

El código se distribuye bajo la **licencia MIT** (ver archivo `LICENSE`).
Podés usarlo, modificarlo, redistribuirlo y sublicenciarlo con mínima
fricción, siempre manteniendo el aviso de copyright.

La herramienta se provee **"as is"**, sin garantía de ningún tipo, y
su uso está dirigido a titulares que accedan a su propia HCD. El autor
no asume responsabilidad por:

- El uso sobre sesiones de terceros — la base legal (art. 14) cubre
  exclusivamente al titular sobre sus propios datos. Si alguien desea
  descargar la HCD de otra persona debe contar con poder / representación
  legal válida en el marco uruguayo, y eso es ortogonal a la extensión.
- Decisiones clínicas que deriven de leer un ZIP descargado con la
  extensión sin validación del profesional tratante. El ZIP es una copia
  fiel de lo que el portal le muestra al titular, pero no reemplaza el
  acceso directo al sistema de salud para decisiones clínicas.
- La integración de la extensión (o de los ZIP generados) en sistemas
  de producción clínica sin una validación formal adicional.
- Daños derivados de cambios del portal Mi HCD que rompan la extracción —
  los selectores se parchan *best-effort*, no hay SLA.

La licencia MIT otorga permisos sobre el *código* de la extensión. No
otorga ni pretende otorgar derecho alguno sobre los datos de la Historia
Clínica Digital de nadie: esos datos son propiedad del titular y están
regidos por las leyes 18.331 y 18.335 del ordenamiento uruguayo.
