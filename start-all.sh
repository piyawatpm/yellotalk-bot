#!/bin/bash
# Start both bot server and web portal

echo "🚀 Starting YelloTalk Bot System..."
echo ""

# Start bot server in background
echo "Starting bot control server..."
node bot-server.js &
BOT_PID=$!

# Wait for bot server to be ready
sleep 3

# Start web portal
echo "Starting web portal..."
cd web-portal
npm run dev

# Cleanup on exit
trap "kill $BOT_PID 2>/dev/null" EXIT
