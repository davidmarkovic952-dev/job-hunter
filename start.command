#!/bin/bash
# Dupli klik na ovaj fajl pokreće Job Hunter.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js nije instaliran."
  echo "Instaliraj ga: https://nodejs.org (LTS) ili u Terminalu: brew install node"
  read -p "Pritisni Enter za izlaz..."; exit 1
fi
if [ ! -d node_modules ]; then
  echo "Prvo pokretanje — instaliram pakete (1-3 min, preuzima i Chrome za PDF)..."
  npm install --no-audit --no-fund || { read -p "Instalacija nije uspela. Enter za izlaz..."; exit 1; }
fi
npm start
