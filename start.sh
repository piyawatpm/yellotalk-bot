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
        if command -v brew &>/dev/null; then
            brew install cloudflare/cloudflare/cloudflared 2>/dev/null || echo -e "${RED}Failed to install cloudflared via brew${NC}"
        else
            # No brew — download binary directly
            curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz -o /tmp/cloudflared.tgz 2>/dev/null \
              && tar -xzf /tmp/cloudflared.tgz -C /tmp 2>/dev/null \
              && mv /tmp/cloudflared /usr/local/bin/cloudflared 2>/dev/null \
              && chmod +x /usr/local/bin/cloudflared \
              || echo -e "${YELLOW}Could not install cloudflared automatically. Skipping tunnel.${NC}"
            rm -f /tmp/cloudflared.tgz 2>/dev/null
        fi
    else
        # Linux: download binary
        curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared 2>/dev/null && chmod +x /usr/local/bin/cloudflared || echo -e "${YELLOW}Could not install cloudflared automatically. Skipping tunnel.${NC}"
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

# Kill any existing bot processes first (but NOT cloudflared!)
echo -e "${YELLOW}Killing existing processes...${NC}"
pkill -f 'node bot-server.js' 2>/dev/null
pkill -f 'gme-music-bot' 2>/dev/null
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

# Function to cleanup — only kill bot/portal/gme, NOT tunnels
cleanup() {
    echo -e "\n${BLUE}Stopping services (tunnels stay alive)...${NC}"
    [ -n "$BOT_PID" ] && kill "$BOT_PID" 2>/dev/null
    [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null
    [ -n "$GME_PID" ] && kill "$GME_PID" 2>/dev/null
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
if [ ! -f "$GME_BOT" ]; then
    echo -e "${YELLOW}GME Music Bot not found. Building...${NC}"
    (cd "$SCRIPT_DIR/gme-music-bot" && bash "$(basename "$GME_BUILD_HINT")")
fi
if [ -f "$GME_BOT" ]; then
    echo -e "${GREEN}Starting GME Music Bot...${NC}"
    "$GME_BOT" &
    GME_PID=$!
    echo -e "GME Music Bot PID: ${GME_PID} (HTTP API on port 9876)"
else
    echo -e "${RED}GME Music Bot build failed. Skipping.${NC}"
    GME_PID=""
fi

# ==================== Cloudflared tunnels ====================
# Tunnels persist across restarts using PID files

TUNNEL_PID=""
API_TUNNEL_PID=""
PORTAL_PID_FILE="$SCRIPT_DIR/.tunnel-portal.pid"
API_PID_FILE="$SCRIPT_DIR/.tunnel-api.pid"

# Check if a saved PID is still alive
is_tunnel_alive() {
    local pid_file="$1"
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            echo "$pid"
            return 0
        fi
    fi
    return 1
}

if command -v cloudflared &>/dev/null; then
    # Check if portal tunnel is still alive
    EXISTING_PORTAL=$(is_tunnel_alive "$PORTAL_PID_FILE")
    EXISTING_API=$(is_tunnel_alive "$API_PID_FILE")

    if [ -n "$EXISTING_PORTAL" ]; then
        SAVED_PORTAL_URL=""
        [ -f "$SCRIPT_DIR/.portal-tunnel-url" ] && SAVED_PORTAL_URL=$(cat "$SCRIPT_DIR/.portal-tunnel-url")
        [ -z "$SAVED_PORTAL_URL" ] && [ -f "$SCRIPT_DIR/.tunnel-portal.log" ] && SAVED_PORTAL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$SCRIPT_DIR/.tunnel-portal.log" 2>/dev/null | head -1)
        [ -n "$SAVED_PORTAL_URL" ] && echo "$SAVED_PORTAL_URL" > "$SCRIPT_DIR/.portal-tunnel-url"
        echo -e "${GREEN}Portal tunnel already running (PID: ${EXISTING_PORTAL}) — ${SAVED_PORTAL_URL:-unknown URL}${NC}"
        TUNNEL_PID="$EXISTING_PORTAL"
    else
        rm -f "$SCRIPT_DIR/.portal-tunnel-url"
        echo -e "${GREEN}Starting cloudflared tunnel for web portal (port 5252)...${NC}"
        # Launch in subshell so CTRL+C doesn't kill it
        TUNNEL_PID=$(bash -c 'nohup cloudflared tunnel --url http://localhost:5252 > "'"$SCRIPT_DIR"'/.tunnel-portal.log" 2>&1 & echo $!')
        echo "$TUNNEL_PID" > "$PORTAL_PID_FILE"
        # Wait for URL to appear in log
        for i in $(seq 1 15); do
            PORTAL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$SCRIPT_DIR/.tunnel-portal.log" 2>/dev/null | head -1)
            if [ -n "$PORTAL_URL" ]; then
                echo -e "${GREEN}Portal URL: ${PORTAL_URL}${NC}"
                echo "$PORTAL_URL" > "$SCRIPT_DIR/.portal-tunnel-url"
                break
            fi
            sleep 1
        done
    fi

    if [ -n "$EXISTING_API" ]; then
        SAVED_API_URL=""
        [ -f "$SCRIPT_DIR/.api-tunnel-url" ] && SAVED_API_URL=$(cat "$SCRIPT_DIR/.api-tunnel-url")
        [ -z "$SAVED_API_URL" ] && [ -f "$SCRIPT_DIR/.tunnel-api.log" ] && SAVED_API_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$SCRIPT_DIR/.tunnel-api.log" 2>/dev/null | head -1)
        [ -n "$SAVED_API_URL" ] && echo "$SAVED_API_URL" > "$SCRIPT_DIR/.api-tunnel-url"
        echo -e "${GREEN}API tunnel already running (PID: ${EXISTING_API}) — ${SAVED_API_URL:-unknown URL}${NC}"
        API_TUNNEL_PID="$EXISTING_API"
    else
        rm -f "$SCRIPT_DIR/.api-tunnel-url"
        echo -e "${GREEN}Starting cloudflared tunnel for bot-server API (port 5353)...${NC}"
        # Launch in subshell so CTRL+C doesn't kill it
        API_TUNNEL_PID=$(bash -c 'nohup cloudflared tunnel --url http://localhost:5353 > "'"$SCRIPT_DIR"'/.tunnel-api.log" 2>&1 & echo $!')
        echo "$API_TUNNEL_PID" > "$API_PID_FILE"
        # Wait for URL to appear in log
        for i in $(seq 1 15); do
            API_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$SCRIPT_DIR/.tunnel-api.log" 2>/dev/null | head -1)
            if [ -n "$API_URL" ]; then
                echo -e "${GREEN}API URL: ${API_URL}${NC}"
                echo "$API_URL" > "$SCRIPT_DIR/.api-tunnel-url"
                break
            fi
            sleep 1
        done
    fi
else
    echo -e "${YELLOW}cloudflared not installed — skipping public tunnels${NC}"
fi

# Read tunnel URLs from files
PORTAL_URL=""
API_URL=""
[ -f "$SCRIPT_DIR/.portal-tunnel-url" ] && PORTAL_URL=$(cat "$SCRIPT_DIR/.portal-tunnel-url")
[ -f "$SCRIPT_DIR/.api-tunnel-url" ] && API_URL=$(cat "$SCRIPT_DIR/.api-tunnel-url")

# Set terminal title with URLs (always visible in title bar/tab)
TITLE="YelloTalk Bot"
[ -n "$PORTAL_URL" ] && TITLE="$TITLE | Portal: $PORTAL_URL"
printf '\033]0;%s\007' "$TITLE"

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}YelloTalk Bot Services Started${NC}                                      ${BLUE}║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║${NC}  📡 Local API:    http://localhost:5353                              ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  🌐 Local Portal: http://localhost:5252                              ${BLUE}║${NC}"
if [ -n "$PORTAL_URL" ]; then
echo -e "${BLUE}║${NC}                                                                      ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  🔗 ${GREEN}Portal: ${PORTAL_URL}${NC}"
fi
if [ -n "$API_URL" ]; then
echo -e "${BLUE}║${NC}  🔗 ${GREEN}API:    ${API_URL}${NC}"
fi
echo -e "${BLUE}╠══════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║${NC}  ${YELLOW}Tunnels persist across restarts. pkill cloudflared to reset.${NC}        ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  ${YELLOW}Press CTRL+C to stop bot (tunnels stay alive).${NC}                      ${BLUE}║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Wait for all processes
wait
