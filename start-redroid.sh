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
APK="/root/gmebuild/out/gmebot.apk"
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

echo -e "${GREEN}[4/6] GME bot app (install + forward)...${NC}"
[ -f "$APK" ] || { echo "      building APK..."; bash /root/gmebuild/build.sh >/dev/null 2>&1; }
if ! adb -s "$SERIAL" shell pm list packages 2>/dev/null | grep -q com.gmebot.test; then
  adb -s "$SERIAL" install -r "$APK" >/dev/null 2>&1
fi
adb -s "$SERIAL" shell pm grant com.gmebot.test android.permission.RECORD_AUDIO >/dev/null 2>&1 || true
adb -s "$SERIAL" shell am start -n com.gmebot.test/.MainActivity >/dev/null 2>&1
adb -s "$SERIAL" forward tcp:9877 tcp:9099 >/dev/null 2>&1
echo "      app running, port 9877 -> 9099 forwarded."

echo -e "${GREEN}[5/6] npm deps...${NC}"
[ -d "$SCRIPT_DIR/node_modules" ] || (cd "$SCRIPT_DIR" && npm install >/dev/null 2>&1)
[ -d "$SCRIPT_DIR/web-portal/node_modules" ] || (cd "$SCRIPT_DIR/web-portal" && npm install >/dev/null 2>&1)

echo -e "${GREEN}[6/6] bot-server (GME_MODE=redroid) + portal via pm2...${NC}"
pm2 delete yt-bot yt-portal >/dev/null 2>&1 || true
GME_MODE=redroid pm2 start bot-server.js --name yt-bot --cwd "$SCRIPT_DIR" --time >/dev/null
pm2 start npm --name yt-portal --cwd "$SCRIPT_DIR/web-portal" --time -- run dev >/dev/null
pm2 save >/dev/null 2>&1

IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || echo "<server-ip>")
echo ""
echo -e "${GREEN}✅ Running.${NC}"
echo -e "   Portal:   ${GREEN}http://${IP}:5252/control${NC}   (open ports 5252 + 5353 in the Tencent firewall)"
echo -e "   Logs:     ${YELLOW}pm2 logs yt-bot${NC}"
echo -e "   Restart:  ${YELLOW}bash start-redroid.sh${NC}"
echo -e "   Stop:     ${YELLOW}pm2 stop yt-bot yt-portal${NC}"
