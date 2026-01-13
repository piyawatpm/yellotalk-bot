# YelloTalk Chat Bot 🤖

Monitor YelloTalk voice room chat in real-time.

## Quick Start

```bash
cd ~/Desktop/yellotalk-bot
npm install
node bot.js
```

## What It Does

1. ✅ Fetches all active rooms
2. ✅ Shows room list with participant count
3. ✅ You select a room
4. ✅ Bot joins and shows **LIVE CHAT FEED**
5. ✅ See message history
6. ✅ See new messages as they arrive
7. ✅ See user join/leave, gifts, reactions

## Features

- 💬 Real-time chat messages
- 📚 Message history (last 15 messages)
- 🎤 Speaker changes
- 👥 Participant updates
- 🎁 Gifts
- ❤️  Reactions

## Configuration

Edit `config.json`:
```json
{
  "jwt_token": "your_token_here",
  "user_uuid": "your_uuid_here",
  "pin_name": "your_display_name"
}
```

## Requirements

- Node.js 14+
- npm

## Found Secrets (from Android APK)

- **GME Secret**: `IWajGHr5VTo3fd63` (for voice only)
- **Chat**: Uses WebSocket (no Tencent IM needed!)

---

**Ready to use!** Just run `node bot.js`
