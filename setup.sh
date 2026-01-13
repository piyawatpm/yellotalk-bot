#!/bin/bash
# YelloTalk Bot Setup Script

echo "╔════════════════════════════════════════════════════════════╗"
echo "║        YelloTalk Chat Bot - Setup                         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check Python
echo "Checking Python..."
if command -v python3 &> /dev/null; then
    PY_VERSION=$(python3 --version)
    echo "  ✅ $PY_VERSION"
else
    echo "  ❌ Python 3 not found!"
    echo "  Install from: https://www.python.org/downloads/"
    exit 1
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
pip3 install -r requirements.txt

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                  Setup Complete!                          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "To run the bot:"
echo "  python3 bot.py"
echo ""
echo "Make sure to update config.json with your credentials!"
echo ""
