# Plan de trabajo — visor local de la HC

Surge de probar `visor-hc.html` (v1.4.0) con 22 HC reales de familia y
amigos: 1494 documentos, 15 paquetes anonimizados, todos de versiones que no
traían `visor.html`. Las pruebas se hicieron en local; ningún dato de esas HC
se guarda en el repo.

Cada fase es un PR. Las fases 1 a 4 corrigen problemas encontrados; las
fases 5 a 8 suman funcionalidades. El orden de 5 en adelante se puede
cambiar.

## Diagnóstico (resumen)

| Id | Problema | Alcance en la muestra |
|---|---|---|
| A | El scraper guarda los datos en el campo equivocado: `prestador` vacío; `descripcion` con la fila cruda del portal (fecha, sigla, nombre completo del prestador separados por tabulaciones) o un OID; `profesional` con `NOMBRE\nDescripción: servicio de X`. | 1494 documentos |
| B | Texto con acentos rotos (UTF-8 leído como Latin-1: "cardiologÃ­a"). | 305 documentos |
| C | La anonimización deja la fecha de nacimiento y el sexo del cabezal CDA. | 877 de 1168 HTML anonimizados |
| D | Imágenes y PDF embebidos con `<iframe src="data:…">` quedan en gris en el visor suelto (CSP). | 6 documentos |
| E | Los documentos no descargados se listan con el texto crudo y ocupan el resumen. | 276 documentos |
| F | La categoría "Otros" no tiene ícono ni color. | 11 documentos |
| G | El visor no dice de dónde viene ni enlaza a la Plataforma IPS. | todos |

## Fase 1 — Visor: datos legibles y origen ✅ (#3, v1.5.0)

Arregla en el visor lo que se ve mal, también para ZIPs viejos, sin tocar
el scraper.

- Normalización al abrir: sigla y nombre completo del prestador desde la
  fila del portal; profesional y especialidad desde "Descripción:"; OIDs
  descartados como título; nombres en mayúscula inicial; acentos rotos
  reparados (A, B).
- Cabezal del documento (`<title>`, Prestador, Profesional, Fecha del
  evento) como fuente de título, prestador y hora. Nunca se leen nombre,
  documento ni fecha de nacimiento del paciente.
- Título = especialidad o título del documento; hora del evento visible.
- Filtro por especialidad.
- No descargados en una sección plegable y legible (E).
- "Otros" con ícono y color (F).
- CSP del visor suelto con `frame-src blob: data:` (D).
- Origen: marca "Plataforma IPS", versión del visor y de la extensión,
  identificador de la exportación, y un link a la plataforma (G).

## Fase 2 — Extensión: corregir el scraper (raíz de A y B) ✅ (este PR, falta probar en el portal)

- `timeline-row.ts` lee cada fila del timeline por rótulos ("Profesional:",
  "Descripción:") y por columnas (fecha, prestador, "Nombre completo del
  prestador"), sin depender del DOM. Con las 1494 filas de la muestra:
  prestador en las 977 filas con columnas, profesional sin la línea de
  descripción y 0 textos con acentos rotos.
- La reparación de acentos (UTF-8 leído como Latin-1, también doble) se hace
  al capturar, con la misma regla que el visor.
- Los ids y nombres de archivo siguen usando la descripción vieja
  (`idDescripcion`, interna): un ZIP nuevo no duplica los documentos de uno
  viejo en la plataforma.
- `metadata.json` suma `producer: { name, version }`, `prestadorNombre` y,
  en cada PDF, `analitos` (nombre, valor, unidad, referencia). La plataforma
  los acepta (`extra="allow"`); el ZIP de demo pasa `ingest_zip` y el
  escaneo de PII residual sin hallazgos.
- Los analitos se leen en el service worker con pdf.js (build legacy, sin
  DOM) y el parser del visor, después de la anonimización. Nunca se guarda el
  texto del PDF: en los paquetes anonimizados el cabezal del PDF solo se tapa
  visualmente. Así "Mis análisis" también funciona en el `visor.html` del ZIP.
- Costo: el service worker pasa de 0,7 MB a 2,3 MB (pdf.js).
- Falta: descargar con la sesión del titular y comparar campos, analitos e
  ids contra un ZIP anterior.

## Fase 3 — Extensión: anonimización del cabezal (C) ✅ decidido: se conservan

- La fecha de nacimiento y el sexo del cabezal del CDA **se conservan** en
  los paquetes anonimizados (decisión del 04/10/2026). La Plataforma IPS los
  usa: `fhir_composer.py` completa edad y sexo del Patient desde la
  narrativa, `post_validators.py` extrae la fecha de nacimiento del texto
  para controlar la edad (F1-02) y el calendario de vacunación cruza por
  edad. Sacarlos degradaría los IPS y cambiaría los paquetes respecto al
  corpus ya evaluado.
- Queda documentado en el README (§13), en el popup y en el motor de
  anonimización.

## Fase 4 — Plataforma: revisar la ingesta ✅ revisada (sin cambios antes de la defensa)

Qué usa la plataforma de `metadata.json` (`backend/app/ips/normalize.py`):

- **Profesional**: la primera línea de `profesional`. Con el formato viejo
  ("NOMBRE\nDescripción: servicio de X") la primera línea ya era el nombre,
  así que el problema A no le afectaba. Con la v1.9 llega el nombre solo y,
  si el portal no trae profesional, el campo queda vacío y se usa
  "Profesional desconocido" (antes podía colarse la línea de descripción).
- **Institución**: busca cuatro nombres conocidos (Asociación Española,
  Médica Uruguaya, MSP) en `descripcion` + `profesional` y, si no aparecen,
  en el HTML del documento. No lee `prestador`. En la base de investigación
  1079 de 1326 eventos (81 %) quedan como "Desconocida".
- La institución y el profesional alimentan el esqueleto FHIR
  (Organization, Practitioner, Encounter) y las líneas de tiempo de las
  vistas de evaluador e investigador.

Efecto de la v1.9: `descripcion` ya no trae el nombre completo del
prestador, así que el primer intento de la institución deja de encontrarlo
y queda el del HTML. Los ZIP ya ingresados no cambian.

Mejora posible para después de la defensa (toca el pipeline): que
`normalize.py` lea `prestador` y `prestadorNombre` y use un directorio de
prestadores en lugar de cuatro palabras clave.

## Fase 5 — Lo esencial de mi historia ✅ (#4, v1.6.0)

1. **Mi carné de vacunas**: juntar las secciones "Historial de vacunas"
   (vacuna, fecha, dosis, vía, vacunatorio) en una tabla imprimible.
2. **Mis diagnósticos y medicamentos**: listas a partir de las secciones
   "Diagnósticos", "Prescripciones de Medicamentos", "Motivos de consulta",
   con link a cada documento.
3. **Mis médicos y prestadores**: quién me atendió, cuántas veces, última
   consulta; mapa de calor de consultas por año y mes.

Implementación: `visor.html` lleva el HTML de cada documento (escapado en el
JSON del índice) y `viewer-extract.js` extrae en el navegador texto,
cabezal, vacunas, diagnósticos y medicamentos, con el mismo código para el
visor embebido y el suelto. En la muestra real: 469 dosis de vacunas con los
cinco campos, 1010 diagnósticos y 753 medicamentos, sin rótulos de
formulario colados.

## Fase 6 — Entender lo que dice ✅ (#5, v1.7.0)

4. **Siglas y términos explicados** al pasar el mouse (HTA, DM2…),
   reutilizando `clinical_abbreviations.py` de la plataforma.
5. **Búsqueda con sinónimos** (hipertensión ↔ HTA) y tolerante a errores.
6. **Accesibilidad**: tamaño de letra y lectura en voz alta del documento
   con `speechSynthesis` (funciona sin red).

Implementación: `viewer-glossary.js` con 51 siglas del seed de la plataforma
(sin las de 2 letras ni las que no son siglas), explicadas al pasar el mouse
y en la vista "Siglas de tu historia"; búsqueda con sinónimos en los dos
sentidos y "¿Quisiste decir…?" por distancia de edición sobre las palabras
de los documentos; tamaño de letra guardado en el navegador; lectura en voz
alta con las siglas expandidas. Además, especialidades escritas distinto
unificadas y reparación de texto codificado dos veces (en la muestra real
quedan 0 campos con acentos rotos).

## Fase 7 — Usar la historia ✅ (#6, v1.8.0)

7. **Llevar a la consulta**: marcar documentos e imprimir un único PDF.
8. **Notas y favoritos** por documento, guardados solo en ese navegador.
9. **Qué hay de nuevo**: al abrir un ZIP más reciente, resaltar los
   documentos nuevos.
10. **Documentos repetidos**: marcar los que comparten fecha, título y
    texto, con opción de ocultarlos.

Implementación: `viewer-dossier.js` arma "Llevar a la consulta" (portada con
índice, resumen opcional y un documento por página, con el HTML limpio de
scripts, iframes, objetos, manejadores `on*` y links `javascript:`; si algo
quedara, falla cerrado). Favoritos, notas, selección para la consulta e
historial de descargas se guardan en `localStorage` (solo en ese navegador).
"Qué hay de nuevo" compara con la descarga anterior que comparte al menos un
30% de los documentos.

Corrección del diagnóstico: los "68 repetidos" eran pares con la misma
descripción porque esta traía la fila cruda del portal (problema A), no
documentos duplicados. Con datos normalizados no hay duplicados exactos en
la muestra: la extensión ya descarta HTML idénticos por SHA-256 al
descargar. El detector queda como red de seguridad.

## Fase 8 — Más allá del ZIP ✅ (#7, v1.8.0)

11. **Varias HC a la vez**: abrir los ZIP de la familia y alternar entre
    personas (cuidadores).
12. **Laboratorio**: buscar dentro de los PDF y graficar analitos en el
    tiempo. Requiere extraer el texto de los PDF en la extensión.
13. **Abrir mi IPS**: mostrar el Resumen del Paciente de la plataforma
    junto a la historia.

8a (este PR): varias historias en `visor-hc.html` con selector de persona
(favoritos, notas y consulta se guardan por persona) y "Mi Resumen del
Paciente (IPS)": `viewer-ips.js` lee el `ips-fhir.json` que la plataforma
deja descargar y el visor muestra cada ítem con los documentos de la
historia donde aparece (búsqueda con sinónimos). El Bundle no trae el
documento de origen de cada ítem, por eso el vínculo es por búsqueda.

8b: "Mis análisis", solo en `visor-hc.html` (decisión: no tocar la
extensión ni el portal). pdf.js 3.11 (Apache 2.0) va inline en el visor
suelto (~1,4 MB), en el hilo principal y sin eval; `viewer-lab.js` arma las
líneas por posición y extrae analito, valor, unidad y referencia. En la
muestra real: 333 de 335 PDF con texto, 3418 resultados leídos y, en la HC
con más PDF (76), 107 análisis graficados. Lo leído de los PDF también entra
en la búsqueda. El visor dentro del ZIP muestra un aviso para abrir el ZIP
con `visor-hc.html`. Pendiente para la fase 2: que la extensión guarde el
texto de los PDF al descargar, para que el visor embebido también grafique.

## Cómo se valida cada fase

- Tests unitarios con datos sintéticos (nunca HC reales en el repo).
- Prueba local con las HC de "Familia y amigos" en `file://`, con capturas
  que no salen de la máquina, y borrado de las copias al terminar.
- Para fases que tocan el ZIP: pasar el resultado por `ingest_zip` y
  `scan_zip_for_residual_pii` de la plataforma.
