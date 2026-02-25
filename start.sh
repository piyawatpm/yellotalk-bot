#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ==================== Install dependencies ====================
echo -e "${BLUE}Checking dependencies...${NC}"

# Check for node
if ! command -v node &>/dev/null; then
    echo -e "${RED}Node.js not found. Please install Node.js first.${NC}"
    exit 1
fi

# Check for npm
if ! command -v npm &>/dev/null; then
    echo -e "${RED}npm not found. Please install npm first.${NC}"
    exit 1
fi

# Check for cloudflared (needed for public tunnel)
if ! command -v cloudflared &>/dev/null; then
    echo -e "${YELLOW}cloudflared not found. Installing...${NC}"
    if [ "$(uname)" = "Darwin" ]; then
        brew install cloudflare/cloudflare/cloudflared 2>/dev/null || echo -e "${RED}Failed to install cloudflared. Install manually: brew install cloudflare/cloudflare/cloudflared${NC}"
    else
        # Linux: download binary
        curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared 2>/dev/null && chmod +x /usr/local/bin/cloudflared || echo -e "${RED}Failed to install cloudflared. See: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/${NC}"
    fi
fi

# Check for yt-dlp (needed for music)
if ! command -v yt-dlp &>/dev/null; then
    echo -e "${YELLOW}yt-dlp not found. Installing...${NC}"
    if [ "$(uname)" = "Darwin" ]; then
        brew install yt-dlp 2>/dev/null || pip3 install yt-dlp 2>/dev/null || echo -e "${RED}Failed to install yt-dlp. Install manually: brew install yt-dlp${NC}"
    else
        sudo apt-get install -y yt-dlp 2>/dev/null || pip3 install yt-dlp 2>/dev/null || echo -e "${RED}Failed to install yt-dlp. Install manually: pip3 install yt-dlp${NC}"
    fi
fi

# Check for ffmpeg (needed for audio conversion)
if ! command -v ffmpeg &>/dev/null; then
    echo -e "${YELLOW}ffmpeg not found. Installing...${NC}"
    if [ "$(uname)" = "Darwin" ]; then
        brew install ffmpeg 2>/dev/null || echo -e "${RED}Failed to install ffmpeg. Install manually: brew install ffmpeg${NC}"
    else
        sudo apt-get install -y ffmpeg 2>/dev/null || echo -e "${RED}Failed to install ffmpeg. Install manually: sudo apt install ffmpeg${NC}"
    fi
fi

# Install npm packages for root (bot-server)
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo -e "${YELLOW}Installing root packages...${NC}"
    (cd "$SCRIPT_DIR" && npm install)
else
    echo -e "${GREEN}Root packages OK${NC}"
fi

# Install npm packages for web-portal
if [ -d "$SCRIPT_DIR/web-portal" ] && [ ! -d "$SCRIPT_DIR/web-portal/node_modules" ]; then
    echo -e "${YELLOW}Installing web-portal packages...${NC}"
    (cd "$SCRIPT_DIR/web-portal" && npm install)
else
    echo -e "${GREEN}Web portal packages OK${NC}"
fi

# Install npm packages for gme-web-bot
if [ -d "$SCRIPT_DIR/gme-web-bot" ] && [ ! -d "$SCRIPT_DIR/gme-web-bot/node_modules" ]; then
    echo -e "${YELLOW}Installing gme-web-bot packages...${NC}"
    (cd "$SCRIPT_DIR/gme-web-bot" && npm install)
else
    echo -e "${GREEN}GME web bot packages OK${NC}"
fi

echo -e "${GREEN}All dependencies ready.${NC}"
echo ""

# ==================== Start services ====================
echo -e "${BLUE}Starting YelloTalk Bot Services...${NC}"

# Kill any existing bot processes first
echo -e "${YELLOW}Killing existing processes...${NC}"
pkill -f 'node bot-server.js' 2>/dev/null
pkill -f 'gme-music-bot' 2>/dev/null
pkill -f 'cloudflared tunnel' 2>/dev/null
# Free GME ports (9876-9899)
for pid in $(lsof -ti :9876-9899 2>/dev/null); do
    kill "$pid" 2>/dev/null
done
# Free bot-server port
for pid in $(lsof -ti :5353 2>/dev/null); do
    kill "$pid" 2>/dev/null
done
sleep 1
echo -e "${GREEN}Clean.${NC}"

# Function to cleanup background processes on exit
cleanup() {
    echo -e "\n${BLUE}Stopping services...${NC}"
    kill $(jobs -p) 2>/dev/null
    exit
}

# Set up trap to catch CTRL+C and other termination signals
trap cleanup SIGINT SIGTERM

# Start bot server
echo -e "${GREEN}Starting bot server...${NC}"
node bot-server.js &
BOT_PID=$!

# Start web portal (runs in subshell so cd doesn't affect parent)
echo -e "${GREEN}Starting web portal...${NC}"
(cd web-portal && npm run dev) &
WEB_PID=$!

# Start GME Music Bot (if built) — detect platform
if [ "$(uname)" = "Darwin" ]; then
    GME_BOT="./gme-music-bot/gme-music-bot"
    GME_BUILD_HINT="gme-music-bot/build.sh"
else
    GME_BOT="./gme-music-bot/gme-music-bot-linux"
    GME_BUILD_HINT="gme-music-bot/build_linux.sh"
fi
if [ -f "$GME_BOT" ]; then
    echo -e "${GREEN}Starting GME Music Bot...${NC}"
    "$GME_BOT" &
    GME_PID=$!
    echo -e "GME Music Bot PID: ${GME_PID} (HTTP API on port 9876)"
else
    echo -e "${YELLOW}GME Music Bot not found. Run ${GME_BUILD_HINT} to build it.${NC}"
    GME_PID=""
fi

# Start cloudflared tunnel for web portal
TUNNEL_PID=""
if command -v cloudflared &>/dev/null; then
    echo -e "${GREEN}Starting cloudflared tunnel for web portal (port 5252)...${NC}"
    cloudflared tunnel --url http://localhost:5252 2>&1 | while read -r line; do
        # Extract and display the public URL
        if echo "$line" | grep -qoE 'https://[a-z0-9-]+\.trycloudflare\.com'; then
            URL=$(echo "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com')
            echo -e "${GREEN}Public URL: ${URL}${NC}"
        fi
    done &
    TUNNEL_PID=$!
    echo -e "Cloudflared Tunnel PID: ${TUNNEL_PID}"
else
    echo -e "${YELLOW}cloudflared not installed — skipping public tunnel${NC}"
fi

echo -e "${BLUE}Services started!${NC}"
echo -e "Bot Server PID: ${BOT_PID} (port 5353)"
echo -e "Web Portal PID: ${WEB_PID} (port 5252)"
[ -n "$GME_PID" ] && echo -e "GME Music Bot PID: ${GME_PID} (port 9876)"
[ -n "$TUNNEL_PID" ] && echo -e "Cloudflared Tunnel PID: ${TUNNEL_PID} (public URL printed above)"
echo -e "\n${BLUE}Press CTRL+C to stop all services${NC}\n"

# Wait for all processes
wait
