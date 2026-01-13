# Quick Start Guide

## 🚀 Run the Bot (3 steps)

### Step 1: Open Terminal

```bash
cd ~/Desktop/yellotalk-bot
```

### Step 2: Install Dependencies (first time only)

```bash
pip3 install --user websockets requests urllib3
```

Or:
```bash
./setup.sh
```

### Step 3: Run the Bot

```bash
python3 bot.py
```

or

```bash
./run.sh
```

## 📖 What Happens

1. **Bot fetches active rooms** from YelloTalk API
2. **Shows you a list** with room names and participant count
3. **You select a room** by typing a number (1-10)
4. **Bot joins the room** via WebSocket
5. **Live chat feed appears** - you see all messages in real-time!
6. **Press Ctrl+C** to stop

## 🎮 Example

```
$ python3 bot.py

📋 AVAILABLE ROOMS

 1. นกที่ตื่นเช้าง่วงมากเลยจ้ะ
    👥 6 participants

 2. ชะบ๊า🌺
    👥 2 participants

➤ Select room (1-2): 1

[Connecting...]
[Showing live chat...]

💬 User1: สวัสดี
💬 User2: หวัดดี
💬 User3: เป็นยังไงบ้าง
```

## ⚙️ Configuration

If you need to update your token:

```bash
nano config.json
```

Change the `jwt_token` field and save (Ctrl+X, Y, Enter).

## ❓ Help

- **Bot won't connect?** → Check your internet connection
- **No messages?** → Try a room with more people
- **Auth error?** → Update JWT token in config.json

That's it! Enjoy monitoring YelloTalk rooms!
