#!/bin/bash
# Build GME Music Bot for Linux (Ubuntu)
#
# Prerequisites:
#   sudo apt install build-essential libcurl4-openssl-dev zlib1g-dev python3
#
set -e

SDK_PATH="../gme-linux-sdk"

echo "Building GME Music Bot (Linux)..."

# Build all stubs + patch .so files if not already done
if [ ! -f "$SDK_PATH/lib/libbionic_compat.so" ] || [ ! -f "$SDK_PATH/lib/.patched" ]; then
    echo "Running compatibility layer setup..."
    (cd "$SDK_PATH/stubs" && bash build_stubs.sh)
fi

# Resolve absolute path for rpath-link (build-time dependency resolution)
ABS_SDK_LIB="$(cd "$SDK_PATH/lib" && pwd)"

# Compile: link against the patched GME .so files + bionic compat
# --disable-new-dtags: use DT_RPATH (inherited by deps) instead of DT_RUNPATH
# -rpath-link: help linker find deps of shared libs at link time
g++ -std=c++17 \
    main_linux.cpp \
    -o gme-music-bot-linux \
    -I "$SDK_PATH/include" \
    -L "$SDK_PATH/lib" \
    -lgmesdk -lgmefdkaac -lgmelamemp3 -lgmeogg -lgmefaad2 -lgmesoundtouch \
    -lbionic_compat -llog \
    -lcurl -lpthread -ldl -lz -lm \
    -Wl,-rpath,'$ORIGIN/../gme-linux-sdk/lib' \
    -Wl,--disable-new-dtags \
    -Wl,-rpath-link,"$ABS_SDK_LIB" \
    2>&1

if [ $? -eq 0 ]; then
    echo ""
    echo "Build successful: ./gme-music-bot-linux"
    echo ""
    echo "Usage:"
    echo "  ./gme-music-bot-linux [--port PORT] [--bot-id ID] [--callback-url URL] [room_id] [gme_user_id] [music.mp3]"
    echo ""
    echo "Or start without args and control via HTTP:"
    echo "  ./gme-music-bot-linux"
    echo "  ./gme-music-bot-linux --port 9877 --bot-id bot-2"
    echo "  curl http://localhost:9876/status"
    echo "  curl -X POST http://localhost:9876/join -d '{\"room\":\"12345\",\"user\":\"67890\"}'"
    echo "  curl -X POST http://localhost:9876/play -d '{\"file\":\"song.mp3\",\"loop\":true}'"
    echo ""
    echo "Verify shared libraries:"
    echo "  ldd ./gme-music-bot-linux"
else
    echo "Build failed"
    exit 1
fi
