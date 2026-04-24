# Política de Privacidad — Extractor de HCD

**Última actualización:** 2026-04-20
**Versión de la extensión:** 1.0.0

Este documento describe cómo la extensión **Extractor de HCD** trata los datos
del usuario. Está redactado para cumplir con los requisitos del Chrome Web
Store (sección "Limited Use" y "User Data") y con la Ley N° 18.331 de
Protección de Datos Personales de Uruguay.

---

## 1. Qué hace la extensión

La extensión automatiza lo que cualquier titular puede hacer manualmente en
el portal **Mi HCD** (`https://historiaclinicadigital.gub.uy`): recorrer su
timeline de eventos asistenciales, abrir cada documento, guardarlo en
formato HTML y empaquetar todo en un archivo ZIP que queda descargado en el
dispositivo del usuario.

Se ejecuta exclusivamente sobre la sesión ya autenticada del titular. No
crea cuentas, no inicia sesión, no almacena credenciales.

## 2. Qué datos se acceden

Cuando el usuario inicia una corrida, la extensión accede, mientras la
sesión del titular está abierta en `historiaclinicadigital.gub.uy`, a:

- El listado de eventos del timeline (categoría, fecha, prestador,
  profesional, descripción breve).
- El contenido del iframe `CONTENIDOHTML` de cada evento (HTML renderizado
  del documento clínico).
- Los PDFs embebidos en CDA nivel 1 (por ejemplo, resultados de
  laboratorio).
- El nombre del titular tal como lo muestra el portal (para armar el
  nombre del archivo ZIP y, opcionalmente, para anonimizar).

**No se accede a**: credenciales (usuario/contraseña, CI como input,
tokens), cookies del portal, otras pestañas del navegador, marcadores,
historial, contactos, geolocalización, cámara, micrófono, clipboard.

## 3. Dónde se almacenan los datos

Los datos se mantienen **exclusivamente en el dispositivo del usuario**:

- Durante la corrida: en memoria de la extensión y en
  `chrome.storage.session` (se borra cuando el navegador cierra).
- Al terminar: se entrega como archivo ZIP a `chrome.downloads` y queda en
  la carpeta de Descargas del usuario.

**Nada se envía a servidores externos. La extensión no hace peticiones a
ningún dominio fuera de `historiaclinicadigital.gub.uy`.**

## 4. Con quién se comparten los datos

**Con nadie.** La extensión no tiene backend, no usa servicios de
analytics, no envía telemetría, no incluye publicidad ni trackers, no usa
SDKs de terceros que comuniquen datos hacia afuera. Los dos componentes
externos son JSZip (empaquetado del corpus) y `pdf-lib` (redacción visual
del cabezal de los PDFs de laboratorio cuando la anonimización básica
está activada), ambos **empaquetados localmente con la extensión, no
cargados desde CDN**, y ambos corren íntegramente en el navegador.

## 5. Qué pasa con el ZIP resultante

El ZIP queda bajo el control exclusivo del usuario. Qué hacer con él
—archivarlo, abrirlo, compartirlo con su médico, subirlo a un proveedor de
IA, destruirlo— es decisión del usuario y responsabilidad del usuario.

Si el ZIP va a compartirse con terceros, recomendamos activar la
anonimización básica al iniciar la corrida (ver §13 del README). Tener en
cuenta las limitaciones documentadas; en particular, sobre los PDFs
embebidos de Laboratorio (CDA nivel 1):

- Cuando la anonimización básica está activada, la extensión **superpone
  un rectángulo blanco** sobre la franja de datos del paciente en cada
  página del PDF. Eso impide que el nombre, la CI, etc. se vean al abrir
  el archivo en un visor.
- Esto es **redacción visual, no semántica**: los bytes del texto
  original permanecen en el content stream del PDF y son recuperables
  con un selector de texto o con herramientas forenses. Un visor PDF
  estándar permite, por ejemplo, seleccionar "invisible" sobre la banda
  blanca y copiar el dato.
- Para desidentificación formal (eliminación real del stream), el ZIP
  debe pasar por la segunda pasada con `pymupdf` en el backend del
  pipeline IPS del proyecto (o por una herramienta equivalente fuera de
  la extensión). El `README.txt` incluido dentro del ZIP explicita este
  punto cuando la corrida fue anonimizada.

## 6. Base legal (Uruguay)

El tratamiento de datos descrito se apoya en el **derecho de acceso del
titular** previsto en el artículo 14 de la Ley N° 18.331. La extensión es
una herramienta que el titular ejecuta en su propia sesión, sobre sus
propios datos, en su propio dispositivo.

Los datos clínicos son **datos sensibles** bajo el artículo 18 de la misma
ley. El titular es el responsable del tratamiento posterior (custodia,
compartición con terceros). La extensión no actúa como "encargado del
tratamiento" — no procesa datos por cuenta de nadie más.

## 7. Permisos de Chrome y su justificación

| Permiso | Para qué |
|---|---|
| `scripting` + `host_permissions: historiaclinicadigital.gub.uy/*` | Inyectar el content script que recorre el timeline. |
| `downloads` | Entregar el ZIP al usuario. |
| `storage` | Guardar el progreso de la corrida y el ZIP resultante de forma que sobreviva al idle del service worker de MV3. Solo `chrome.storage.session` (volátil). |
| `tabs` | Detectar si la pestaña activa está en el portal para habilitar el botón "Iniciar". |

Ningún permiso permite a la extensión comunicarse con Internet fuera del
portal.

## 8. Derechos del titular

Como usuario de esta extensión y titular de los datos:

- Podés **desinstalar** la extensión en cualquier momento. Al desinstalar
  se borra también el estado persistido en `chrome.storage.session`.
- Podés **no ejecutar** una corrida (la extensión no hace nada hasta que
  presionás "Iniciar").
- Podés **cancelar** una corrida en curso.
- Podés **eliminar** el ZIP descargado cuando quieras — está bajo tu
  control.

Tus derechos de acceso, rectificación, actualización, inclusión o supresión
sobre tu historia clínica frente al prestador se ejercen directamente
contra el prestador y/o la Unidad Regulatoria y de Control de Datos
Personales (URCDP), no contra esta extensión.

## 9. Seguridad

El código es abierto (licencia MIT, ver `LICENSE`). Podés auditarlo.

Pese a las protecciones técnicas (CSP estricta, `Trusted Types`,
dependencias bundleadas, sin eval), ninguna extensión de navegador puede
garantizar que tu dispositivo esté libre de malware. Si sospechás que tu
dispositivo está comprometido, no ejecutes la extensión hasta remediarlo.

## 10. Cambios a esta política

Si la funcionalidad cambia (por ejemplo, si una versión futura agregara
integración opcional con un LLM externo), este documento se actualizará y
la nueva versión requerirá una re-aceptación del usuario antes de habilitar
la funcionalidad nueva.

## 11. Contacto

Dudas, reportes de seguridad, o solicitudes sobre esta política:

- GitHub Issues: `https://github.com/sebasvaz/extractor-hcd/issues`
- Autor: Sebastián Vázquez — `sebasvaz@gmail.com`

Esta herramienta fue desarrollada en el marco del Proyecto Final de la
Licenciatura en Sistemas, Facultad de Ingeniería, Universidad ORT Uruguay.
