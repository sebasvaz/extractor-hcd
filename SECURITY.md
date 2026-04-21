# Política de seguridad

## Reporte de vulnerabilidades

Si encontrás un bug de seguridad en la extensión, por favor **no lo abras
como Issue público**. Una falla que afecte la confidencialidad o integridad
del HTML capturado, del ZIP generado o de los datos persistidos puede
impactar a cualquier usuario de la extensión que tenga sesión abierta en
`historiaclinicadigital.gub.uy`.

Mandá un mail a **sebasvaz@gmail.com** con:

- Versión de la extensión y de Chrome.
- Sistema operativo.
- Pasos para reproducir.
- Impacto estimado (ejecución de código, fuga de datos, escalamiento de
  permisos, etc.).
- Prueba de concepto (código, screenshots, grabación) — **sin incluir
  datos clínicos reales de nadie**; si necesitás ejemplos, usá un fixture
  sintético o redactá el contenido.

Me comprometo a acusar recibo en menos de 7 días corridos y a publicar un
fix o explicar por qué no se considera una falla dentro de los 30 días
siguientes, salvo complejidad mayor.

## Alcance

Son **en alcance** (me interesa que los reportes lleguen):

- Cualquier forma de exfiltrar el HTML, PDFs o metadata capturada a un
  destino fuera del dispositivo del usuario.
- Inyección de código arbitrario en el popup, el service worker o el
  content script.
- Elusión de la anonimización básica tal como está documentada en el
  README §13 (si encontrás una filtración de identificadores directos
  dentro de lo que se dice que se anonimiza — nombre, CI, teléfono UY,
  email — quiero saberlo).
- Persistencia no declarada: datos que queden fuera de
  `chrome.storage.session` cuando no deberían.
- Dependencias vulnerables con exploit demostrable en este contexto.

**Fuera de alcance** (limitaciones conocidas o decisiones de diseño):

- La anonimización básica no cubre texto clínico libre, profesionales,
  prestadores, fechas, ni PDFs embebidos de CDA nivel 1 (Laboratorio).
  Esto está documentado; reportes sobre este punto no se consideran
  vulnerabilidades.
- La extensión depende del portal: cambios en el HTML de Mi HCD pueden
  romper el scraper. No es un problema de seguridad, es un riesgo de
  compatibilidad.
- Ingeniería social fuera de la extensión (phishing del portal, malware
  preinstalado, etc.).

## Divulgación

Una vez publicado el fix, el reporte puede divulgarse con el CVE (si
aplica) y crédito al reportador salvo que pidas anonimato. Los datos
personales incluidos en el reporte no se publican.
