#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ticket-alert-system"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$ROOT_DIR/dist-offline"
BUILD_DIR="$OUTPUT_DIR/${APP_NAME}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="${APP_NAME}-offline-${TIMESTAMP}.tar.gz"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
mkdir -p "$OUTPUT_DIR"

echo "[1/6] Preparing offline build directory..."
rsync -a \
  --exclude '.git' \
  --exclude 'dist-offline' \
  --exclude 'data' \
  --exclude 'uploads' \
  --exclude '.env' \
  --exclude '*.log' \
  "$ROOT_DIR/" "$BUILD_DIR/"

echo "[2/6] Ensuring production dependencies exist..."
cd "$ROOT_DIR"
if [ ! -d node_modules ]; then
  npm install
fi

echo "[3/6] Copying node_modules..."
rsync -a "$ROOT_DIR/node_modules" "$BUILD_DIR/"

echo "[4/6] Preparing runtime directories..."
mkdir -p "$BUILD_DIR/data" "$BUILD_DIR/uploads"
cp -f "$ROOT_DIR/.env.example" "$BUILD_DIR/.env.example"
cp -f "$ROOT_DIR/.env.example" "$BUILD_DIR/.env"

echo "[5/6] Writing offline deploy helper..."
cat > "$BUILD_DIR/OFFLINE-README.md" <<'EOF'
# 离线部署说明

## 1. 解压

```bash
tar -xzf ticket-alert-system-offline-*.tar.gz
cd ticket-alert-system
```

## 2. 配置环境变量

```bash
cp .env.example .env
nano .env
```

## 3. 一键部署

```bash
bash offline-deploy.sh
```

如果机器装了 PM2，会自动使用 PM2；否则前台运行。
EOF

echo "[6/6] Creating archive..."
cd "$OUTPUT_DIR"
tar -czf "$ARCHIVE_NAME" "$APP_NAME"

echo "Offline package created: $OUTPUT_DIR/$ARCHIVE_NAME"
