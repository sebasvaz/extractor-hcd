# Contribuir

Gracias por el interés. Este proyecto nació como Proyecto Final de la
Licenciatura en Sistemas de la Universidad ORT Uruguay y, una vez defendido
(setiembre 2026), queda disponible como herramienta libre para cualquier
titular de la Historia Clínica Digital uruguaya.

## Contexto importante

Hasta la defensa del proyecto final, los *cambios de alcance* (nuevas
features grandes, cambios en la arquitectura, integraciones con LLM, etc.)
no se aceptan — estabilidad pesa más que extensión, y cualquier cambio
tiene que ser defendible frente al tribunal.

Sí son bienvenidos, también antes de la defensa:

- Reportes de bugs (Issue o email si es un tema de seguridad — ver
  `SECURITY.md`).
- Fixes de regresiones cuando el portal Mi HCD cambia su HTML.
- Mejoras de documentación.
- Traducciones (por ahora solo español).
- Reportes de falsos positivos/negativos en la anonimización básica
  (acompañados de un fixture sintético reproducible, **sin datos reales
  de nadie**).

## Antes de abrir un Issue

1. Buscá si ya existe el mismo reporte.
2. Incluí: versión de la extensión, versión de Chrome, sistema operativo,
   pasos para reproducir, y un fragmento mínimo de HTML sintético que
   dispare el problema (sin datos reales).
3. Si el bug involucra un documento clínico específico, **no pegues su
   contenido**; describilo en términos estructurales (p.ej. "evento de
   categoría Laboratorio con PDF embebido en `<pre id="b64">` que tiene
   una metadata con apellido compuesto").

## Setup local

```bash
cd extension/
nvm use           # usa la versión de .nvmrc
npm ci
npm run typecheck
npm run test
npm run build
```

Cargá la build desde `chrome://extensions` → "Cargar extensión sin
empaquetar" → elegí la carpeta `dist/`.

## Estilo

TypeScript en modo estricto. Tests con Vitest. Comentarios útiles en
español (lo que está en el repo ya sigue esa convención).

No se usan imports desde CDN — todo bundleado. La CSP del manifest es
estricta a propósito (ver `PRIVACY.md` §7).

## Pull requests

- Una PR chica y enfocada es mucho mejor que una grande.
- Incluí test para el cambio (si aplica).
- Que `npm run typecheck && npm run test && npm run build` pase verde
  antes de abrir la PR.
- Describí qué cambia y por qué en la descripción de la PR.

## Conducta

Actuá con respeto. No publiqués ni reenvíes datos personales de terceros
en el proceso de contribución (ni en issues, ni en PRs, ni en commits).
