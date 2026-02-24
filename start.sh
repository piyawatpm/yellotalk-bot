#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting YelloTalk Bot Services...${NC}"

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

echo -e "${BLUE}Services started!${NC}"
echo -e "Bot Server PID: ${BOT_PID} (port 5353)"
echo -e "Web Portal PID: ${WEB_PID} (port 3000)"
[ -n "$GME_PID" ] && echo -e "GME Music Bot PID: ${GME_PID} (port 9876)"
echo -e "\n${BLUE}Press CTRL+C to stop all services${NC}\n"

# Wait for all processes
wait
