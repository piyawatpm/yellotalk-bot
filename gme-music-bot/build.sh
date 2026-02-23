#!/bin/bash
# Build GME Music Bot for macOS

SDK_PATH="../gme-mac-sdk/GME_SDK"
FRAMEWORK_PATH="$SDK_PATH/GMESDK.framework"

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
    echo "  ./gme-music-bot <gme_room_id> <user_gme_id> [music.mp3]"
    echo ""
    echo "Or start without args and control via HTTP:"
    echo "  ./gme-music-bot"
    echo "  curl http://localhost:9876/status"
    echo "  curl -X POST http://localhost:9876/join -d '{\"room\":\"12345\",\"user\":\"67890\"}'"
    echo "  curl -X POST http://localhost:9876/play -d '{\"file\":\"song.mp3\",\"loop\":true}'"
else
    echo "❌ Build failed"
fi
