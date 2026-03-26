#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

echo "[1/5] Checking Node.js..."
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Please install Node.js 22 before offline deployment."
  exit 1
fi

echo "[2/5] Checking bundled dependencies..."
if [ ! -d node_modules ]; then
  echo "node_modules not found. Please recreate offline package from a machine with internet access."
  exit 1
fi

echo "[3/5] Preparing environment..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Please review SMTP config if needed."
fi

mkdir -p data uploads

echo "[4/5] Starting service..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 describe ticket-alert-system >/dev/null 2>&1 && pm2 delete ticket-alert-system >/dev/null 2>&1 || true
  pm2 start server.js --name ticket-alert-system
  pm2 save >/dev/null 2>&1 || true
  echo "Started with PM2."
  pm2 status ticket-alert-system || true
else
  echo "PM2 not found, running in foreground..."
  node server.js
fi

echo "[5/5] Done."
