#!/bin/bash
#
# Start YelloTalk Bot on Ubuntu Linux
#
# This script:
#   1. Checks & installs system dependencies (build-essential, libcurl, etc.)
#   2. Builds the GME Music Bot for Linux (if not already built)
#   3. Starts all services (bot-server, web-portal, GME music bot)
#
# Usage:
#   chmod +x start-linux.sh
#   ./start-linux.sh              # normal start
#   ./start-linux.sh --rebuild    # force rebuild GME bot
#   ./start-linux.sh --skip-deps  # skip apt dependency check
#

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GME_BOT_DIR="$SCRIPT_DIR/gme-music-bot"
GME_BINARY="$GME_BOT_DIR/gme-music-bot-linux"
SDK_DIR="$SCRIPT_DIR/gme-linux-sdk"

FORCE_REBUILD=false
SKIP_DEPS=false

for arg in "$@"; do
    case "$arg" in
        --rebuild)    FORCE_REBUILD=true ;;
        --skip-deps)  SKIP_DEPS=true ;;
        --help|-h)
            echo "Usage: $0 [--rebuild] [--skip-deps]"
            echo ""
            echo "  --rebuild     Force rebuild GME Music Bot binary"
            echo "  --skip-deps   Skip system dependency check (faster startup)"
            echo ""
            exit 0
            ;;
    esac
done

echo -e "${BLUE}=== YelloTalk Bot — Linux Setup & Start ===${NC}"
echo ""

# ---- Step 1: Check system dependencies ----
if [ "$SKIP_DEPS" = false ]; then
    echo -e "${BLUE}[1/4] Checking system dependencies...${NC}"

    MISSING_PKGS=()

    check_pkg() {
        if ! dpkg -s "$1" &>/dev/null; then
            MISSING_PKGS+=("$1")
        fi
    }

    check_pkg "build-essential"
    check_pkg "libcurl4-openssl-dev"
    check_pkg "zlib1g-dev"
    check_pkg "python3"
    check_pkg "ffmpeg"

    # Check for yt-dlp (needed for YouTube music playback)
    if ! command -v yt-dlp &>/dev/null; then
        echo -e "${YELLOW}  yt-dlp not found, installing...${NC}"
        sudo apt update -qq
        sudo apt install -y yt-dlp 2>/dev/null || {
            # Fallback: install via pip if apt version is too old
            echo -e "  apt version unavailable, installing via pip..."
            pip3 install --break-system-packages yt-dlp 2>/dev/null || pip3 install yt-dlp
        }
    fi
    echo -e "  yt-dlp: $(yt-dlp --version 2>/dev/null || echo 'not found')"

    # Check for node
    if ! command -v node &>/dev/null; then
        echo -e "${RED}  Node.js is not installed!${NC}"
        echo "  Install via: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
        echo "  Or use nvm: https://github.com/nvm-sh/nvm"
        exit 1
    fi
    echo -e "  Node.js: $(node --version)"

    if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
        echo -e "${YELLOW}  Missing packages: ${MISSING_PKGS[*]}${NC}"
        echo -e "  Installing..."
        sudo apt update -qq
        sudo apt install -y "${MISSING_PKGS[@]}"
        echo -e "${GREEN}  Dependencies installed.${NC}"
    else
        echo -e "${GREEN}  All dependencies present.${NC}"
    fi
else
    echo -e "${BLUE}[1/4] Skipping dependency check (--skip-deps)${NC}"
fi

# ---- Step 2: Install npm packages ----
echo -e "${BLUE}[2/4] Checking npm packages...${NC}"

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo -e "  Installing root npm packages..."
    (cd "$SCRIPT_DIR" && npm install)
else
    echo -e "${GREEN}  Root node_modules present.${NC}"
fi

if [ -d "$SCRIPT_DIR/web-portal" ] && [ ! -d "$SCRIPT_DIR/web-portal/node_modules" ]; then
    echo -e "  Installing web-portal npm packages..."
    (cd "$SCRIPT_DIR/web-portal" && npm install)
else
    echo -e "${GREEN}  Web portal node_modules present.${NC}"
fi

# ---- Step 3: Build GME Music Bot ----
echo -e "${BLUE}[3/4] Preparing GME Music Bot...${NC}"

if [ ! -d "$SDK_DIR/lib" ]; then
    echo -e "${RED}  ERROR: gme-linux-sdk/lib/ not found.${NC}"
    echo "  Make sure the Android x86_64 .so files are in gme-linux-sdk/lib/"
    exit 1
fi

if [ "$FORCE_REBUILD" = true ] || [ ! -f "$GME_BINARY" ]; then
    if [ "$FORCE_REBUILD" = true ]; then
        echo -e "  Force rebuilding..."
        # Clear patch marker so stubs get rebuilt
        rm -f "$SDK_DIR/lib/.patched"
    else
        echo -e "  Binary not found, building..."
    fi
    (cd "$GME_BOT_DIR" && bash build_linux.sh)
    echo -e "${GREEN}  Build complete: $GME_BINARY${NC}"
else
    echo -e "${GREEN}  Binary already built: gme-music-bot-linux${NC}"
fi

# Verify the binary
if [ ! -x "$GME_BINARY" ]; then
    chmod +x "$GME_BINARY"
fi

echo -e "  Checking shared libraries..."
if ldd "$GME_BINARY" 2>&1 | grep -q "not found"; then
    echo -e "${RED}  WARNING: Some shared libraries are missing:${NC}"
    ldd "$GME_BINARY" 2>&1 | grep "not found"
    echo -e "${YELLOW}  The bot may fail to start. Try: ./start-linux.sh --rebuild${NC}"
else
    echo -e "${GREEN}  All shared libraries resolved.${NC}"
fi

# ---- Step 4: Start services ----
echo -e "${BLUE}[4/4] Starting services...${NC}"
echo ""

# Cleanup on exit
cleanup() {
    echo -e "\n${BLUE}Stopping all services...${NC}"
    kill $(jobs -p) 2>/dev/null
    wait 2>/dev/null
    echo -e "${GREEN}All services stopped.${NC}"
    exit
}
trap cleanup SIGINT SIGTERM

# Start bot server
echo -e "${GREEN}  Starting bot server (port 5353)...${NC}"
(cd "$SCRIPT_DIR" && node bot-server.js) &
BOT_PID=$!

# Start web portal
if [ -d "$SCRIPT_DIR/web-portal" ]; then
    echo -e "${GREEN}  Starting web portal (port 3000)...${NC}"
    (cd "$SCRIPT_DIR/web-portal" && npm run dev) &
    WEB_PID=$!
else
    echo -e "${YELLOW}  Web portal directory not found, skipping.${NC}"
    WEB_PID=""
fi

# GME Music Bot is spawned by bot-server.js on demand, no need to start separately
# But we can verify the binary works
echo -e "${GREEN}  GME Music Bot ready (spawned on demand by bot-server)${NC}"

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${GREEN}  All services started!${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo -e "  Bot Server:    http://localhost:5353  (PID: $BOT_PID)"
[ -n "$WEB_PID" ] && echo -e "  Web Portal:    http://localhost:3000  (PID: $WEB_PID)"
echo -e "  GME Music Bot: managed by bot-server (binary: gme-music-bot-linux)"
echo ""
echo -e "${BLUE}  Press CTRL+C to stop all services${NC}"
echo ""

wait
