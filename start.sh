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

# Check for tailscale (macOS only — used for a permanent public URL on the Mac).
# Linux servers use their public IP directly, so we don't install Tailscale there.
if [ "$(uname)" = "Darwin" ] && ! command -v tailscale &>/dev/null && [ ! -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
    echo -e "${YELLOW}tailscale not found. Installing (permanent public URL)...${NC}"
    if command -v brew &>/dev/null; then
        brew install tailscale 2>/dev/null || echo -e "${YELLOW}Could not install tailscale via brew — will use cloudflared fallback.${NC}"
    else
        echo -e "${YELLOW}Homebrew not found — install Tailscale from https://tailscale.com/download/macos (falls back to cloudflared meanwhile).${NC}"
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

# Sync npm packages. Run `npm install` EVERY time — it's idempotent (a no-op when
# the lockfile is already satisfied) but it PICKS UP newly-added deps. The old
# `[ ! -d node_modules ]` guard skipped installs whenever node_modules existed, so
# a dependency added to package.json (e.g. the 3D console's `three`) silently
# broke the build.
echo -e "${BLUE}Syncing npm packages...${NC}"
(cd "$SCRIPT_DIR" && npm install --no-audit --no-fund) || echo -e "${RED}⚠️  root npm install failed${NC}"
if [ -d "$SCRIPT_DIR/web-portal" ]; then
    (cd "$SCRIPT_DIR/web-portal" && npm install --no-audit --no-fund) || echo -e "${RED}⚠️  web-portal npm install failed${NC}"
fi
if [ -d "$SCRIPT_DIR/gme-web-bot" ]; then
    (cd "$SCRIPT_DIR/gme-web-bot" && npm install --no-audit --no-fund) || echo -e "${RED}⚠️  gme-web-bot npm install failed${NC}"
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

# Pre-build GME Music Bot if not built (bot-server.js spawns it on demand)
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
    if [ -f "$GME_BOT" ]; then
        echo -e "${GREEN}GME Music Bot built successfully${NC}"
    else
        echo -e "${RED}GME Music Bot build failed.${NC}"
    fi
else
    echo -e "${GREEN}GME Music Bot binary OK (spawned on demand by bot-server)${NC}"
fi
GME_PID=""

# ==================== Public tunnels ====================
# Preferred: Tailscale Funnel. The public URL is bound to THIS Mac's tailnet
# identity (its MagicDNS name), so it NEVER changes — not on restart, reboot,
# sleep, or when the Mac moves to a different Wi-Fi/network.
# Fallback: cloudflared quick tunnels (random *.trycloudflare.com each start).

TUNNEL_MODE=""
TS_BIN="$(command -v tailscale 2>/dev/null)"
if [ -z "$TS_BIN" ] && [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
    TS_BIN="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
fi

# Tailscale backend state: "Running" = logged in & connected, "" = daemon not reachable.
ts_state() {
    "$TS_BIN" status --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('BackendState',''))" 2>/dev/null
}

# Ensure the daemon is running AND this Mac is logged in. Auto-starts the daemon
# and opens a browser login when needed. Returns 0 only when state is "Running".
ensure_tailscale() {
    [ -z "$TS_BIN" ] && return 1
    if [ -z "$(ts_state)" ]; then
        echo -e "${YELLOW}Starting Tailscale daemon (may prompt for your password)...${NC}"
        local ts_daemon
        ts_daemon="$(command -v tailscaled 2>/dev/null)"
        if command -v brew &>/dev/null; then
            sudo brew services start tailscale 2>/dev/null || { [ -n "$ts_daemon" ] && sudo "$ts_daemon" install-system-daemon 2>/dev/null; }
        elif [ -n "$ts_daemon" ]; then
            sudo "$ts_daemon" install-system-daemon 2>/dev/null
        fi
        for _ in $(seq 1 10); do [ -n "$(ts_state)" ] && break; sleep 1; done
    fi
    if [ "$(ts_state)" != "Running" ]; then
        echo -e "${YELLOW}Logging in to Tailscale — a browser will open. Finish it, then setup continues...${NC}"
        "$TS_BIN" up 2>/dev/null || sudo "$TS_BIN" up 2>/dev/null
    fi
    [ "$(ts_state)" = "Running" ]
}

if [ -n "$TS_BIN" ] && ensure_tailscale; then
    # Resolve this node's stable MagicDNS name.
    TS_HOST=$("$TS_BIN" status --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))" 2>/dev/null)
    if [ -n "$TS_HOST" ]; then
        echo -e "${GREEN}Setting up Tailscale Funnel (permanent URLs)...${NC}"
        # Funnel allows public ports 443/8443/10000 only: portal->443, API->8443.
        # --bg persists in tailscaled and is restored automatically after reboot.
        ts_ok=1
        for pair in "443:5252" "8443:5353"; do
            pub="${pair%%:*}"; loc="${pair##*:}"
            if ! out=$("$TS_BIN" funnel --bg --https="$pub" "http://127.0.0.1:$loc" 2>&1); then
                echo -e "${YELLOW}Tailscale Funnel could not start:${NC}"
                echo "$out"
                ts_ok=0
                break
            fi
        done
        if [ "$ts_ok" = 1 ]; then
            PORTAL_URL="https://${TS_HOST}"
            API_URL="https://${TS_HOST}:8443"
            echo "$PORTAL_URL" > "$SCRIPT_DIR/.portal-tunnel-url"
            echo "$API_URL"    > "$SCRIPT_DIR/.api-tunnel-url"
            TUNNEL_MODE="tailscale"
            echo -e "${GREEN}Tailscale Funnel ready — permanent URLs for this Mac:${NC}"
            echo -e "  ${GREEN}Portal: ${PORTAL_URL}${NC}"
            echo -e "  ${GREEN}API:    ${API_URL}${NC}"
        else
            echo -e "${YELLOW}Funnel not enabled for your tailnet yet. Enable it, then re-run:${NC}"
            echo -e "  ${YELLOW}https://tailscale.com/kb/1223/funnel${NC}"
        fi
    fi
elif [ -n "$TS_BIN" ]; then
    echo -e "${YELLOW}Tailscale setup didn't finish (login or Funnel still pending) — using cloudflared fallback for now.${NC}"
fi

# ---- Fallback: cloudflared quick tunnels (used only if Tailscale isn't ready) ----
# These run as launchd services — they survive CTRL+C, restarts, and sleep.
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

if [ "$TUNNEL_MODE" != "tailscale" ] && [ -n "$CLOUDFLARED_BIN" ]; then
    mkdir -p "$LAUNCH_AGENTS_DIR"

    # Helper: get current URL for a tunnel service, verifying it actually works
    resolve_tunnel_url() {
        local label="$1"
        local port="$2"
        local plist="$3"
        local logfile="$4"
        local urlfile="$5"

        if launchctl list 2>/dev/null | grep -q "$label"; then
            # Service is running — always read URL from log (may have changed after reboot)
            local log_url=""
            [ -f "$logfile" ] && log_url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$logfile" 2>/dev/null | tail -1)

            if [ -n "$log_url" ]; then
                # Verify the URL actually works (quick 3s check)
                local http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$log_url" 2>/dev/null)
                if [ "$http_code" != "000" ]; then
                    echo "$log_url" > "$urlfile"
                    echo -e "${GREEN}Tunnel service running ($label) — ${log_url}${NC}"
                    echo "$log_url"
                    return 0
                fi
            fi

            # URL not found or dead — restart service
            echo -e "${YELLOW}Tunnel $label has stale/missing URL. Restarting...${NC}"
            rm -f "$logfile" "$urlfile"
            setup_tunnel_service "$label" "$port" "$plist" "$logfile"
            local new_url=$(get_tunnel_url "$logfile")
            if [ -n "$new_url" ]; then
                echo "$new_url" > "$urlfile"
                echo -e "${GREEN}Tunnel URL: ${new_url}${NC}"
                echo "$new_url"
                return 0
            fi
            echo -e "${YELLOW}Tunnel started but URL not ready. Check log: $logfile${NC}"
            return 1
        else
            # Service not installed — install it
            echo -e "${GREEN}Installing tunnel service ($label, port $port)...${NC}"
            rm -f "$logfile" "$urlfile"
            setup_tunnel_service "$label" "$port" "$plist" "$logfile"
            local new_url=$(get_tunnel_url "$logfile")
            if [ -n "$new_url" ]; then
                echo "$new_url" > "$urlfile"
                echo -e "${GREEN}Tunnel URL: ${new_url}${NC}"
                echo "$new_url"
                return 0
            fi
            echo -e "${YELLOW}Tunnel started but URL not ready. Check log: $logfile${NC}"
            return 1
        fi
    }

    # --- Portal tunnel (port 5252) ---
    PORTAL_URL=$(resolve_tunnel_url "com.yellotalk.tunnel-portal" 5252 "$PORTAL_PLIST" "$PORTAL_LOG" "$SCRIPT_DIR/.portal-tunnel-url")

    # --- API tunnel (port 5353) ---
    API_URL=$(resolve_tunnel_url "com.yellotalk.tunnel-api" 5353 "$API_PLIST" "$API_LOG" "$SCRIPT_DIR/.api-tunnel-url")
elif [ "$TUNNEL_MODE" != "tailscale" ]; then
    echo -e "${YELLOW}No public tunnel: install Tailscale (recommended, stable URL) or cloudflared.${NC}"
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
if [ "$TUNNEL_MODE" = "tailscale" ]; then
echo -e "${BLUE}║${NC}  ${YELLOW}Tailscale Funnel: URLs are permanent & follow this Mac anywhere.${NC}     ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  ${YELLOW}Turn off tunnels: tailscale funnel reset${NC}                            ${BLUE}║${NC}"
else
echo -e "${BLUE}║${NC}  ${YELLOW}Tunnels run as launchd services (survive CTRL+C & restarts).${NC}        ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  ${YELLOW}Reset tunnels: launchctl stop com.yellotalk.tunnel-portal${NC}           ${BLUE}║${NC}"
fi
echo -e "${BLUE}║${NC}  ${YELLOW}Press CTRL+C to stop bot only.${NC}                                      ${BLUE}║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Wait for all processes
wait
