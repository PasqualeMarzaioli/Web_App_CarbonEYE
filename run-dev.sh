#!/usr/bin/env bash
# run-dev.sh — Local development launcher that loads environment secrets, builds frontend and API server, and starts the Node.js API server with static assets.
# Author: Pasquale Marzaioli
# Local dev launcher for the sito stack.
# Loads the repo-root .env (Azure secrets) then sito/.env (mappings + sito-only vars),
# builds frontend + api-server, and starts the api-server.
set -euo pipefail

SITO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_ENV="$(cd "$SITO_DIR/.." && pwd)/.env"
SITO_ENV="$SITO_DIR/.env"

if [[ ! -f "$ROOT_ENV" ]]; then
  echo "ERROR: root .env not found at $ROOT_ENV" >&2
  exit 1
fi
if [[ ! -f "$SITO_ENV" ]]; then
  echo "ERROR: sito .env not found at $SITO_ENV" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ROOT_ENV"
# shellcheck disable=SC1090
source "$SITO_ENV"
set +a

CMD="${1:-serve}"

copy_static() {
  local frontend_dist="$SITO_DIR/artifacts/carboneye/dist/public"
  local api_static="$SITO_DIR/artifacts/api-server/dist/static"

  if [[ ! -f "$frontend_dist/index.html" ]]; then
    echo "ERROR: frontend build output missing at $frontend_dist" >&2
    exit 1
  fi

  rm -rf "$api_static"
  mkdir -p "$api_static"
  cp -R "$frontend_dist"/. "$api_static"/
}

case "$CMD" in
  build-frontend)
    cd "$SITO_DIR/artifacts/carboneye"
    pnpm run build
    ;;
  build-api)
    cd "$SITO_DIR/artifacts/api-server"
    pnpm run build
    ;;
  build)
    "$0" build-frontend
    "$0" build-api
    copy_static
    ;;
  serve|start)
    cd "$SITO_DIR/artifacts/api-server"
    if [[ ! -f dist/index.mjs || ! -f dist/static/index.html ]]; then
      echo "[run-dev] dist/ or static assets missing — running full build first"
      "$0" build
    fi
    exec node --enable-source-maps ./dist/index.mjs
    ;;
  dev-frontend)
    cd "$SITO_DIR/artifacts/carboneye"
    exec pnpm run dev
    ;;
  *)
    echo "Usage: $0 [serve|build|build-frontend|build-api|dev-frontend]" >&2
    exit 1
    ;;
esac
