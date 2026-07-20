#!/bin/bash
#
# Download Tencent GME H5 (Web) SDK and extract WebRTCService.min.js
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SDK_DIR="$SCRIPT_DIR/sdk"
SDK_URL="https://dldir1v6.qq.com/hudongzhibo/QCloud_TGP/GME/H5/intl/GME_intl_Web_SDK_2.8.1.53.zip"
ZIP_FILE="/tmp/gme-h5-sdk.zip"
EXTRACT_DIR="/tmp/gme-h5-sdk-extract"

if [ -f "$SDK_DIR/WebRTCService.min.js" ]; then
  echo "SDK already downloaded: $SDK_DIR/WebRTCService.min.js"
  exit 0
fi

echo "Downloading GME H5 SDK..."
curl -L -o "$ZIP_FILE" "$SDK_URL"

echo "Extracting..."
rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"
unzip -o "$ZIP_FILE" -d "$EXTRACT_DIR"

# Find the browser bundle. Newer GME H5 packages ship the minified browser
# build as dist/WebRTCService.js (with a *.source.js sibling and an npm-package/
# variant). Prefer an explicit *.min.js, else the dist bundle (not source, not
# the npm-package module build). It exposes the global window.WebGMEAPI.
SDK_JS=$(find "$EXTRACT_DIR" -name "WebRTCService.min.js" | head -1)
if [ -z "$SDK_JS" ]; then
  SDK_JS=$(find "$EXTRACT_DIR" -name "WebRTCService.js" ! -name "*.source.js" ! -path "*npm-package*" | head -1)
fi

if [ -z "$SDK_JS" ]; then
  echo "ERROR: WebRTCService browser bundle not found in archive."
  echo "Contents:"
  find "$EXTRACT_DIR" -type f
  exit 1
fi
echo "Using SDK bundle: $SDK_JS"

mkdir -p "$SDK_DIR"
cp "$SDK_JS" "$SDK_DIR/WebRTCService.min.js"

# Clean up
rm -rf "$ZIP_FILE" "$EXTRACT_DIR"

echo "SDK ready: $SDK_DIR/WebRTCService.min.js"
