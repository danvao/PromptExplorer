#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Instala Node.js 22 o superior para abrir PromptExplorer.'
  read -r answer
  exit 1
fi
if [ ! -d node_modules ]; then npm install || exit 1; fi
node server.mjs
