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

echo -e "${GREEN}[5/7] Cloudflare WARP proxy (free YouTube bot-check bypass; yt-dlp only)...${NC}"
# Gives yt-dlp a clean Cloudflare egress IP via a local SOCKS proxy on :40000,
# WITHOUT changing the box default route (GME/China path stays intact). This is
# what beats YouTube's "confirm you're not a bot" on the datacenter IP — no
# cookies to babysit.
if ! command -v warp-cli >/dev/null 2>&1; then
  curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg 2>/dev/null
  . /etc/os-release
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ ${VERSION_CODENAME} main" > /etc/apt/sources.list.d/cloudflare-client.list
  apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq cloudflare-warp >/dev/null 2>&1
fi
systemctl enable --now warp-svc >/dev/null 2>&1; sleep 2
warp-cli --accept-tos registration new >/dev/null 2>&1 || warp-cli --accept-tos register >/dev/null 2>&1 || true
warp-cli --accept-tos mode proxy >/dev/null 2>&1 || warp-cli --accept-tos set-mode proxy >/dev/null 2>&1 || true
warp-cli --accept-tos connect >/dev/null 2>&1 || true
grep -q "socks5://127.0.0.1:40000" /etc/yt-dlp.conf 2>/dev/null || echo "--proxy socks5://127.0.0.1:40000" >> /etc/yt-dlp.conf
echo "      WARP proxy on :40000; yt-dlp routed through it (box default route unchanged)."

echo -e "${GREEN}[6/7] npm deps...${NC}"
[ -d "$SCRIPT_DIR/node_modules" ] || (cd "$SCRIPT_DIR" && npm install >/dev/null 2>&1)
[ -d "$SCRIPT_DIR/web-portal/node_modules" ] || (cd "$SCRIPT_DIR/web-portal" && npm install >/dev/null 2>&1)

echo -e "${GREEN}[7/7] build portal (production) + start services via pm2...${NC}"
pm2 delete yt-bot yt-portal >/dev/null 2>&1 || true
# GROQ_BASE_URL routes groq through the US Vercel relay (groq 403s the HK IP).
# NOTE: no /openai/v1 suffix — groq-sdk appends /openai/v1/chat/completions itself.
GME_MODE=redroid GROQ_BASE_URL="${GROQ_BASE_URL:-https://groq-relay-fawn.vercel.app/api}" \
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
# Cap pm2 logs so the verbose bot-server can't fill the disk (20MB x5 compressed).
pm2 install pm2-logrotate >/dev/null 2>&1 || true
pm2 set pm2-logrotate:max_size 20M >/dev/null 2>&1 || true
pm2 set pm2-logrotate:retain 5 >/dev/null 2>&1 || true
pm2 set pm2-logrotate:compress true >/dev/null 2>&1 || true
pm2 save >/dev/null 2>&1

IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || echo "<server-ip>")
echo ""
echo -e "${GREEN}✅ Running.${NC}"
echo -e "   Portal:   ${GREEN}http://${IP}:5252/control${NC}   (open ports 5252 + 5353 in the Tencent firewall)"
echo -e "   Logs:     ${YELLOW}pm2 logs yt-bot${NC}"
echo -e "   Restart:  ${YELLOW}bash start-redroid.sh${NC}"
echo -e "   Stop:     ${YELLOW}pm2 stop yt-bot yt-portal${NC}"
