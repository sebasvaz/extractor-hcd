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

## Fase 2 — Extensión: corregir el scraper (raíz de A y B)

- Revisar el mapeo de columnas del timeline de Mi HCD (`scraper.ts`,
  `extractDescripcion`, `extractCell`) para que `prestador`, `profesional`
  y `descripcion` lleguen en su campo.
- Corregir la decodificación que produce el texto con acentos rotos.
- Sumar a `metadata.json` un bloque `producer: { name, version }`. La
  plataforma lo acepta: `HcdMetadata` usa `extra="allow"`.
- Requiere probar contra el portal real con la sesión del titular.

## Fase 3 — Extensión: anonimización del cabezal (C)

- Tokenizar o quitar fecha de nacimiento y sexo del cabezal CDA cuando la
  anonimización está activa.
- Coordinar con el escaneo de PII residual de la plataforma
  (`pii_residual_check.py`) para que lo detecte en paquetes viejos.

## Fase 4 — Plataforma: revisar la ingesta

- Verificar si `normalize.py`, `fhir_composer.py` o `pdf_redact.py` usan
  `descripcion`, `profesional` o `prestador` de `metadata.json` y si el
  problema A les afecta.
- Si afecta, reutilizar las mismas reglas de normalización del visor.

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

## Fase 6 — Entender lo que dice ✅ (este PR)

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

## Fase 7 — Usar la historia

7. **Llevar a la consulta**: marcar documentos e imprimir un único PDF.
8. **Notas y favoritos** por documento, guardados solo en ese navegador.
9. **Qué hay de nuevo**: al abrir un ZIP más reciente, resaltar los
   documentos nuevos.
10. **Documentos repetidos**: agrupar los que comparten fecha y contenido
    (68 en la muestra).

## Fase 8 — Más allá del ZIP

11. **Varias HC a la vez**: abrir los ZIP de la familia y alternar entre
    personas (cuidadores).
12. **Laboratorio**: buscar dentro de los PDF y graficar analitos en el
    tiempo. Requiere extraer el texto de los PDF en la extensión.
13. **Abrir mi IPS**: mostrar el Resumen del Paciente de la plataforma
    junto a la historia.

## Cómo se valida cada fase

- Tests unitarios con datos sintéticos (nunca HC reales en el repo).
- Prueba local con las HC de "Familia y amigos" en `file://`, con capturas
  que no salen de la máquina, y borrado de las copias al terminar.
- Para fases que tocan el ZIP: pasar el resultado por `ingest_zip` y
  `scan_zip_for_residual_pii` de la plataforma.
