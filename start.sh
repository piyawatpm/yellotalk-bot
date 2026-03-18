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
    echo -e "\n${BLUE}Stopping services (tunnels stay alive as launchd services)...${NC}"
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

# ==================== Cloudflared tunnels (launchd services) ====================
# Tunnels run as macOS launchd services — they survive CTRL+C, restarts, and sleep.
# Only a reboot or `launchctl stop` kills them (and launchd auto-restarts on reboot).

CLOUDFLARED_BIN=$(which cloudflared 2>/dev/null)
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PORTAL_PLIST="$LAUNCH_AGENTS_DIR/com.yellotalk.tunnel-portal.plist"
API_PLIST="$LAUNCH_AGENTS_DIR/com.yellotalk.tunnel-api.plist"
PORTAL_LOG="$SCRIPT_DIR/.tunnel-portal.log"
API_LOG="$SCRIPT_DIR/.tunnel-api.log"

# Helper: install and start a launchd tunnel service
setup_tunnel_service() {
    local label="$1"
    local port="$2"
    local plist="$3"
    local logfile="$4"

    # Create plist
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${CLOUDFLARED_BIN}</string>
        <string>tunnel</string>
        <string>--url</string>
        <string>http://localhost:${port}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logfile}</string>
    <key>StandardErrorPath</key>
    <string>${logfile}</string>
</dict>
</plist>
PLIST

    # Load and start
    launchctl unload "$plist" 2>/dev/null
    launchctl load "$plist"
}

# Helper: get tunnel URL from log file (wait up to 15s)
get_tunnel_url() {
    local logfile="$1"
    for i in $(seq 1 15); do
        local url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$logfile" 2>/dev/null | head -1)
        if [ -n "$url" ]; then
            echo "$url"
            return 0
        fi
        sleep 1
    done
    return 1
}

if [ -n "$CLOUDFLARED_BIN" ]; then
    mkdir -p "$LAUNCH_AGENTS_DIR"

    # --- Portal tunnel (port 5252) ---
    # Check if service is already running with a valid URL
    PORTAL_URL=""
    if launchctl list 2>/dev/null | grep -q 'com.yellotalk.tunnel-portal'; then
        # Service exists, check if URL is saved
        [ -f "$SCRIPT_DIR/.portal-tunnel-url" ] && PORTAL_URL=$(cat "$SCRIPT_DIR/.portal-tunnel-url")
        # Fallback: read from log
        [ -z "$PORTAL_URL" ] && [ -f "$PORTAL_LOG" ] && PORTAL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$PORTAL_LOG" 2>/dev/null | head -1)

        if [ -n "$PORTAL_URL" ]; then
            echo -e "${GREEN}Portal tunnel service running — ${PORTAL_URL}${NC}"
            echo "$PORTAL_URL" > "$SCRIPT_DIR/.portal-tunnel-url"
        else
            # Service running but no URL — restart it
            echo -e "${YELLOW}Portal tunnel service running but no URL found. Restarting...${NC}"
            rm -f "$PORTAL_LOG"
            setup_tunnel_service "com.yellotalk.tunnel-portal" 5252 "$PORTAL_PLIST" "$PORTAL_LOG"
            PORTAL_URL=$(get_tunnel_url "$PORTAL_LOG")
            if [ -n "$PORTAL_URL" ]; then
                echo -e "${GREEN}Portal URL: ${PORTAL_URL}${NC}"
                echo "$PORTAL_URL" > "$SCRIPT_DIR/.portal-tunnel-url"
            fi
        fi
    else
        echo -e "${GREEN}Installing portal tunnel service (port 5252)...${NC}"
        rm -f "$PORTAL_LOG" "$SCRIPT_DIR/.portal-tunnel-url"
        setup_tunnel_service "com.yellotalk.tunnel-portal" 5252 "$PORTAL_PLIST" "$PORTAL_LOG"
        PORTAL_URL=$(get_tunnel_url "$PORTAL_LOG")
        if [ -n "$PORTAL_URL" ]; then
            echo -e "${GREEN}Portal URL: ${PORTAL_URL}${NC}"
            echo "$PORTAL_URL" > "$SCRIPT_DIR/.portal-tunnel-url"
        else
            echo -e "${YELLOW}Portal tunnel started but URL not ready yet. Check log: $PORTAL_LOG${NC}"
        fi
    fi

    # --- API tunnel (port 5353) ---
    API_URL=""
    if launchctl list 2>/dev/null | grep -q 'com.yellotalk.tunnel-api'; then
        [ -f "$SCRIPT_DIR/.api-tunnel-url" ] && API_URL=$(cat "$SCRIPT_DIR/.api-tunnel-url")
        [ -z "$API_URL" ] && [ -f "$API_LOG" ] && API_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$API_LOG" 2>/dev/null | head -1)

        if [ -n "$API_URL" ]; then
            echo -e "${GREEN}API tunnel service running — ${API_URL}${NC}"
            echo "$API_URL" > "$SCRIPT_DIR/.api-tunnel-url"
        else
            echo -e "${YELLOW}API tunnel service running but no URL found. Restarting...${NC}"
            rm -f "$API_LOG"
            setup_tunnel_service "com.yellotalk.tunnel-api" 5353 "$API_PLIST" "$API_LOG"
            API_URL=$(get_tunnel_url "$API_LOG")
            if [ -n "$API_URL" ]; then
                echo -e "${GREEN}API URL: ${API_URL}${NC}"
                echo "$API_URL" > "$SCRIPT_DIR/.api-tunnel-url"
            fi
        fi
    else
        echo -e "${GREEN}Installing API tunnel service (port 5353)...${NC}"
        rm -f "$API_LOG" "$SCRIPT_DIR/.api-tunnel-url"
        setup_tunnel_service "com.yellotalk.tunnel-api" 5353 "$API_PLIST" "$API_LOG"
        API_URL=$(get_tunnel_url "$API_LOG")
        if [ -n "$API_URL" ]; then
            echo -e "${GREEN}API URL: ${API_URL}${NC}"
            echo "$API_URL" > "$SCRIPT_DIR/.api-tunnel-url"
        else
            echo -e "${YELLOW}API tunnel started but URL not ready yet. Check log: $API_LOG${NC}"
        fi
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
echo -e "${BLUE}║${NC}  ${YELLOW}Tunnels run as launchd services (survive CTRL+C & restarts).${NC}        ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  ${YELLOW}Reset tunnels: launchctl stop com.yellotalk.tunnel-portal${NC}           ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  ${YELLOW}Press CTRL+C to stop bot only.${NC}                                      ${BLUE}║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Wait for all processes
wait
