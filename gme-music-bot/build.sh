#!/bin/bash
# Build GME Music Bot for macOS

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

SDK_PATH="../gme-mac-sdk/GME_SDK"
FRAMEWORK_PATH="$SDK_PATH/GMESDK.framework"

# Auto-download GME macOS SDK if not present
if [ ! -d "$FRAMEWORK_PATH" ]; then
    echo "📦 GME macOS SDK not found. Downloading..."
    GME_SDK_URL="https://dldir1v6.qq.com/hudongzhibo/QCloud_TGP/GME/GME2.9.15.intl/Mac/GME_mac_audio_sdk_2.9.15.6fa587cb.zip"
    TMP_ZIP="/tmp/gme-mac-sdk.zip"

    curl -L -o "$TMP_ZIP" "$GME_SDK_URL"
    if [ $? -ne 0 ]; then
        echo "❌ Failed to download GME SDK"
        exit 1
    fi

    # Extract to parent directory
    mkdir -p "../gme-mac-sdk"
    unzip -o "$TMP_ZIP" -d "../gme-mac-sdk"
    rm -f "$TMP_ZIP"

    # Verify extraction
    if [ ! -d "$FRAMEWORK_PATH" ]; then
        echo "❌ SDK extracted but GMESDK.framework not found at expected path"
        echo "   Contents of ../gme-mac-sdk/:"
        ls -la ../gme-mac-sdk/
        exit 1
    fi

    echo "✅ GME SDK downloaded and extracted"
fi

echo "🔨 Building GME Music Bot..."

clang++ -x objective-c++ \
    -std=c++17 \
    -ObjC++ \
    main.mm \
    -o gme-music-bot \
    -F "$SDK_PATH" \
    -framework GMESDK \
    -framework Foundation \
    -framework CoreAudio \
    -framework AudioToolbox \
    -framework AVFoundation \
    -framework AppKit \
    -framework Security \
    -framework SystemConfiguration \
    -framework CoreFoundation \
    -I "$FRAMEWORK_PATH/Headers" \
    -L "$SDK_PATH" \
    -lgmefdkaac \
    -lgmelamemp3 \
    -lgmeogg \
    -lgmesoundtouch \
    -lgmeai \
    -liconv \
    -lresolv \
    -rpath "@executable_path/../gme-mac-sdk/GME_SDK" \
    -rpath "$SDK_PATH" \
    2>&1

if [ $? -eq 0 ]; then
    echo "✅ Build successful: ./gme-music-bot"
    echo ""
    echo "Usage:"
    echo "  ./gme-music-bot [--port PORT] [--bot-id ID] [--callback-url URL] [room_id] [gme_user_id] [music.mp3]"
    echo ""
    echo "Or start without args and control via HTTP:"
    echo "  ./gme-music-bot"
    echo "  ./gme-music-bot --port 9877 --bot-id bot-2"
    echo "  curl http://localhost:9876/status"
    echo "  curl -X POST http://localhost:9876/join -d '{\"room\":\"12345\",\"user\":\"67890\"}'"
    echo "  curl -X POST http://localhost:9876/play -d '{\"file\":\"song.mp3\",\"loop\":true}'"
else
    echo "❌ Build failed"
fi
