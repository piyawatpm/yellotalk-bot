#!/bin/bash
# ============================================================================
# Run the YelloTalk bot on an Ubuntu server using the NATIVE GME Android SDK
# inside Redroid (Android-in-Docker). One command brings the whole thing up.
#
#   bash start-redroid.sh
#
# Prereqs (already set up on this box): docker, adb, node, the Android SDK at
# /root/android-sdk, and the GME bot build at /root/gmebuild.
# ============================================================================
GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERIAL="localhost:5555"
INSTANCES="${INSTANCES:-5}"   # independent bot app copies (com.gmebot.bot0..botN-1)
export PATH="$PATH:/usr/local/bin:/usr/bin"

echo -e "${GREEN}[1/6] binder kernel module + binderfs...${NC}"
modprobe binder_linux 2>/dev/null || true
mkdir -p /dev/binderfs
mountpoint -q /dev/binderfs 2>/dev/null || mount -t binder binder /dev/binderfs 2>/dev/null || true

echo -e "${GREEN}[2/6] Redroid (Android) container...${NC}"
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx redroid; then
  docker start redroid >/dev/null 2>&1 || true
else
  docker run -itd --privileged --name redroid -v /root/redroid-data:/data -p 5555:5555 \
    redroid/redroid:11.0.0-latest androidboot.redroid_gpu_mode=guest >/dev/null
fi

echo -e "${GREEN}[3/6] waiting for Android to boot...${NC}"
adb connect "$SERIAL" >/dev/null 2>&1
for i in $(seq 1 40); do
  [ "$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 3; adb connect "$SERIAL" >/dev/null 2>&1
done
echo "      Android up."

echo -e "${GREEN}[4/6] GME bot apps x${INSTANCES} (build/install + clear stale forwards)...${NC}"
# Build all N instance APKs if missing (or on --rebuild). Each is an independent
# app copy (com.gmebot.botN) = independent GME client, so N bots play at once.
if [ ! -f "/root/gmebuild/out/gmebot0.apk" ] || [ "$1" = "--rebuild" ]; then
  echo "      building $INSTANCES app copies..."
  INSTANCES=$INSTANCES bash /root/gmebuild/build.sh >/tmp/gmebuild.log 2>&1 || echo "      ⚠️  build failed — see /tmp/gmebuild.log"
fi
# Legacy single-instance app binds device port 9099 and collides with bot0 — remove it.
adb -s "$SERIAL" uninstall com.gmebot.test >/dev/null 2>&1 || true
for i in $(seq 0 $((INSTANCES-1))); do
  PKG="com.gmebot.bot$i"
  adb -s "$SERIAL" shell pm list packages 2>/dev/null | grep -q "$PKG" || \
    adb -s "$SERIAL" install -r "/root/gmebuild/out/gmebot$i.apk" >/dev/null 2>&1
  adb -s "$SERIAL" shell pm grant "$PKG" android.permission.RECORD_AUDIO >/dev/null 2>&1 || true
done
# The adapter (spawned per bot by bot-server) manages each app's lifecycle + its
# own adb forward on PORT+10000. Clear stale forwards so they can't shadow a
# bot-server-facing listen port (this collision once broke /play -> no audio).
adb -s "$SERIAL" forward --remove-all >/dev/null 2>&1
echo "      $INSTANCES app copies installed; stale adb forwards cleared."

echo -e "${GREEN}[5/6] npm deps...${NC}"
[ -d "$SCRIPT_DIR/node_modules" ] || (cd "$SCRIPT_DIR" && npm install >/dev/null 2>&1)
[ -d "$SCRIPT_DIR/web-portal/node_modules" ] || (cd "$SCRIPT_DIR/web-portal" && npm install >/dev/null 2>&1)

echo -e "${GREEN}[6/6] build portal (production) + start services via pm2...${NC}"
pm2 delete yt-bot yt-portal >/dev/null 2>&1 || true
# GROQ_BASE_URL routes groq through the US Vercel relay (groq 403s the HK IP).
GME_MODE=redroid GROQ_BASE_URL="${GROQ_BASE_URL:-https://groq-relay-fawn.vercel.app/api/openai/v1}" \
  pm2 start bot-server.js --name yt-bot --cwd "$SCRIPT_DIR" --time >/dev/null
# Production build: pre-compiled + minified routes. `next dev` compiles each
# route on-demand (20-30s page loads over the HK link) and Fast Refresh reloads
# the page — unusable as a control panel. Rebuild when portal code changes:
#   bash start-redroid.sh --rebuild
if [ ! -d "$SCRIPT_DIR/web-portal/.next" ] || [ "$1" = "--rebuild" ]; then
  echo "      building portal (next build)..."
  (cd "$SCRIPT_DIR/web-portal" && NODE_OPTIONS=--max-old-space-size=1536 npm run build >/tmp/portal-build.log 2>&1) \
    && echo "      portal built." || echo "      ⚠️  build failed — see /tmp/portal-build.log"
fi
pm2 start npm --name yt-portal --cwd "$SCRIPT_DIR/web-portal" --time -- run start >/dev/null
pm2 save >/dev/null 2>&1

IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || echo "<server-ip>")
echo ""
echo -e "${GREEN}✅ Running.${NC}"
echo -e "   Portal:   ${GREEN}http://${IP}:5252/control${NC}   (open ports 5252 + 5353 in the Tencent firewall)"
echo -e "   Logs:     ${YELLOW}pm2 logs yt-bot${NC}"
echo -e "   Restart:  ${YELLOW}bash start-redroid.sh${NC}"
echo -e "   Stop:     ${YELLOW}pm2 stop yt-bot yt-portal${NC}"
