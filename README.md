# YelloTalk Chat Bot 🤖

Monitor YelloTalk voice rooms and see all chat messages in real-time.

## Features

- ✅ Fetch all active rooms
- ✅ Interactive room selection
- ✅ Live chat feed
- ✅ Message history
- ✅ User join/leave notifications
- ✅ Gift and reaction notifications

## Quick Start

### 1. Install Dependencies

```bash
cd ~/Desktop/yellotalk-bot
pip3 install -r requirements.txt
```

### 2. Configure

Edit `config.json` and update your JWT token if needed:
```json
{
  "jwt_token": "your_token_here",
  "user_uuid": "your_uuid_here",
  "pin_name": "your_display_name"
}
```

### 3. Run the Bot

```bash
python3 bot.py
```

## Usage

When you run the bot:

```
1. It fetches all active rooms
2. Displays them with participant count
3. You select a room by number (1-10)
4. Bot joins and shows live chat feed
5. Press Ctrl+C to stop
```

## Example Session

```
🤖 YelloTalk Chat Bot
================================================================================

🔍 Fetching active rooms...
✅ Found 8 rooms

📋 AVAILABLE ROOMS
================================================================================

 1. นกที่ตื่นเช้าง่วงมากเลยจ้ะ
    👥 6 participants | 👤 Owner: cliché🌼
    🏷️  คุยเล่น | ID: 6965a05c9f268d0013cde203

 2. ชะบ๊า🌺
    👥 2 participants | 👤 Owner: ~~~🌸
    🏷️  ร้องเพลง | ID: 6965ac997137dc000efda3e4

➤ Select room (1-8) or 'q' to quit: 1

================================================================================
🔌 Connecting to: นกที่ตื่นเช้าง่วงมากเลยจ้ะ
================================================================================
✅ Connected! Session: VAu2brt8vX1NcsmiA-Vr
✅ Authenticated!
✅ Joined room!
✅ Requested message history

================================================================================
📺 LIVE CHAT FEED - นกที่ตื่นเช้าง่วงมากเลยจ้ะ
================================================================================
(Press Ctrl+C to stop)

📚 Message History (5 messages):
--------------------------------------------------------------------------------
  cliché🌼: สวัสดีค่ะ
  ~~~🌸: หวัดดี
  test_user: Hello!
--------------------------------------------------------------------------------

[13:45:23] 💬 cliché🌼: มีใครอยู่มั้ย
[13:45:45] 💬 ~~~🌸: อยู่จ้า
[13:46:12] 👤 new_user - Speaker Changed
[13:46:30] 💬 new_user: สวัสดีครับ
[13:47:01] 🎁 cliché🌼 sent a gift!

^C
👋 Disconnected from room

================================================================================
📊 Session Stats
================================================================================
  Messages received: 12
  Room: นกที่ตื่นเช้าง่วงมากเลยจ้ะ
================================================================================
```

## Configuration

### `config.json` Fields

| Field | Description |
|-------|-------------|
| `jwt_token` | Your YelloTalk JWT authentication token |
| `user_uuid` | Your device UUID |
| `pin_name` | Your display name in chat |
| `avatar_id` | Your avatar ID (0-19) |
| `websocket_url` | WebSocket endpoint (default works) |
| `api_base_url` | REST API base URL (default works) |

## How It Works

### Architecture

```
1. Fetch Rooms (REST API)
   ↓
   GET https://live.yellotalk.co/v1/rooms/popular
   ← Returns list of active rooms

2. Connect WebSocket
   ↓
   wss://live.yellotalk.co:8443/socket.io/
   ← Socket.IO v4 protocol

3. Authenticate
   ↓
   Send: 40{"token":"JWT_TOKEN"}
   ← Receive: 40{"sid":"..."}

4. Join Room
   ↓
   Send: 42["join_room",{"room":"ID","uuid":"..."}]

5. Monitor Events
   ↓
   Receive: 42["new_message",{"pin_name":"...","message":"..."}]
   Receive: 42["load_message",[...]]  (history)
```

### WebSocket Events

**Outgoing (Bot → Server):**
- `join_room` - Join a voice room
- `load_message` - Request chat history
- `new_message` - Send a chat message
- `leave_room` - Leave room

**Incoming (Server → Bot):**
- `new_message` - New chat message
- `load_message` - Message history
- `speaker_changed` - User joined/left voice
- `participant_changed` - Room participants update
- `new_gift` - User sent gift
- `new_reaction` - User sent reaction

## Advanced Usage

### Send a Message

Modify `bot.py` and add message sending:

```python
# After joining, send a message:
msg_data = {
    "room": room_id,
    "uuid": self.uuid,
    "avatar_id": self.avatar_id,
    "pin_name": self.pin_name,
    "message": "Hello from bot!"
}
await ws.send(f'42["new_message",{json.dumps(msg_data)}]')
```

### Filter Messages

Add filtering in `handle_event()`:

```python
# Only show messages with keyword
if event_name == 'new_message':
    message = payload.get('message', '')
    if 'keyword' in message.lower():
        print(f"💬 {sender}: {message}")
```

## Troubleshooting

### "❌ Authentication failed"
- Check your JWT token in `config.json`
- Token might have expired
- Get new token from network capture

### "No rooms available"
- Check internet connection
- API might be down
- Try again later

### "No messages received"
- Room might be inactive
- Try a room with more participants
- Messages only show when people are chatting

## Technical Details

**Based on:**
- Decompiled Android APK (v2.9.3)
- Reverse engineered from `LiveCallManager.java`
- WebSocket protocol: Socket.IO v4
- Authentication: JWT Bearer token

**No Tencent SDK needed for chat!**
- Chat uses YelloTalk's own WebSocket server
- Tencent GME is only for voice audio
- Simple JSON messages over Socket.IO

## Credits

Reverse engineered from YelloTalk Android app.
For educational purposes only.
