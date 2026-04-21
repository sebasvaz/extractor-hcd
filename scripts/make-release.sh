#!/usr/bin/env bash
#
# Construye un ZIP distribuible de la extensión, listo para:
#   - Adjuntar a un GitHub Release
#   - Subir al Chrome Web Store
#   - Mandar a un tester o al tribunal
#
# Uso:
#   ./scripts/make-release.sh [version]
#   ./scripts/make-release.sh v1.0.0
#
# Si no pasás versión, usa la de package.json con prefijo "v".
# El ZIP se deja en ./release/extractor-hcd-<version>.zip y su sha256.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

if [[ $# -ge 1 ]]; then
  VERSION="$1"
else
  PKG_VERSION="$(node -p "require('./package.json').version")"
  VERSION="v$PKG_VERSION"
fi

ZIP_NAME="extractor-hcd-${VERSION}.zip"
RELEASE_DIR="${ROOT_DIR}/release"
ZIP_PATH="${RELEASE_DIR}/${ZIP_NAME}"

echo "==> Versión: $VERSION"
echo "==> Salida : $ZIP_PATH"

echo "==> Limpiando builds previos..."
rm -rf dist "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

echo "==> Instalando dependencias (npm ci)..."
npm ci

echo "==> Typecheck..."
npm run typecheck

echo "==> Tests..."
npm test

echo "==> Build (vite)..."
npm run build

if [[ ! -f dist/manifest.json ]]; then
  echo "ERROR: dist/manifest.json no existe. La build falló." >&2
  exit 1
fi

echo "==> Empaquetando ZIP..."
(
  cd dist
  zip -r -9 "${ZIP_PATH}" . >/dev/null
)

echo "==> Calculando SHA-256..."
if command -v sha256sum >/dev/null; then
  (cd "${RELEASE_DIR}" && sha256sum "${ZIP_NAME}") > "${ZIP_PATH}.sha256"
else
  # macOS
  (cd "${RELEASE_DIR}" && shasum -a 256 "${ZIP_NAME}") > "${ZIP_PATH}.sha256"
fi

echo ""
echo "=============================================="
echo "Listo:"
echo "  $ZIP_PATH"
echo "  $ZIP_PATH.sha256"
echo ""
cat "${ZIP_PATH}.sha256"
echo ""
echo "Podés:"
echo "  - Adjuntarlo a un GitHub Release"
echo "  - Subirlo a chrome.google.com/webstore/devconsole"
echo "  - Mandárselo a un tester (que haga 'Cargar extensión sin empaquetar' sobre la carpeta descomprimida)"
echo "=============================================="
