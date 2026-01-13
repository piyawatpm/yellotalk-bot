# ✅ YelloTalk Bot - Complete Feature List

## 🎉 What Works

### ✅ **Reading Messages**
- Shows message history (last 15 messages)
- Monitors live chat feed
- See all new messages in real-time

### ✅ **Sending Messages**
- `sendMessage(text)` function works
- Successfully tested and confirmed

### ✅ **Auto-Greeting New Participants**
When someone new joins the room:
1. Bot detects them via `participant_changed` event
2. Automatically sends: **"สวัสดี [their name]"**
3. Also greets new speakers

## 🤖 How to Use

### Run the Bot
```bash
cd ~/Desktop/yellotalk-bot
node bot.js
```

### What Happens
1. Shows list of active rooms
2. You select a room number (1-15)
3. Bot joins and starts monitoring
4. **Automatically greets new people**
5. Shows all chat messages live
6. Press Ctrl+C to stop

## 📝 Example Session

```
➤ Select room: 1

✅ Successfully joined room!
📚 Message History (9 total):
  User1: สวัสดีครับ
  User2: หวัดดี

📺 LIVE CHAT FEED
Listening...

[1:55:45] 👥 Participants updated (6 total)
[1:55:45] 👋 New participant: น้ำเหน่ยย
[1:55:45] 🤖 Auto-sending: "สวัสดี น้ำเหน่ยย"
[1:55:46] ✅ Message sent: "สวัสดี น้ำเหน่ยย"

[1:56:12] 💬 User3: ขอบคุณครับ
```

## 🔧 Customization

### Change Greeting Message

Edit line 201 in `bot.js`:
```javascript
const greeting = `สวัสดี ${name}`;  // ← Change this
```

Examples:
```javascript
const greeting = `ยินดีต้อนรับ ${name}!`;
const greeting = `Hello ${name}! Welcome!`;
const greeting = `สวัสดีครับ ${name} 😊`;
```

### Send Custom Message

Add to `bot.js` after joining:
```javascript
// Send a message after 5 seconds
setTimeout(() => {
    sendMessage('Hello everyone!');
}, 5000);
```

### Disable Auto-Greeting

Comment out lines 176-211 in `bot.js`

## 📊 Events Bot Listens To

| Event | Action |
|-------|--------|
| `new_message` | Display chat message |
| `load_message` | Show message history |
| `participant_changed` | **Greet new users** |
| `speaker_changed` | **Greet new speakers** |
| `new_gift` | Show gift notification |
| `new_reaction` | Show reaction |
| `room_info` | Room update |

## 🎯 Technical Details

**Based on:**
- Decompiled YelloTalk Android APK v2.9.3
- Socket.IO v4 protocol
- WebSocket connection to `live.yellotalk.co:8443`

**No Tencent IM needed!**
- Chat uses YelloTalk's own WebSocket
- Simple JSON messages
- Full Socket.IO support

**GME Secret found:** `"IWajGHr5VTo3fd63"` (voice only, not used for chat)

---

## ✅ Confirmed Working

✓ Connect to WebSocket
✓ Join rooms
✓ Receive message history
✓ Receive live messages
✓ **Send messages** ✓
✓ Auto-greet new participants ✓
✓ Keep connection alive
✓ Handle all room events

**Everything works!**
