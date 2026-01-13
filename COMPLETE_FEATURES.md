# 🤖 YelloTalk Bot - Complete Features

## ✅ What the Bot Does

### 1. **Auto-Greeting on Join**
When someone joins the room:
```
[14:30:15] 👋 น้ำเหน่ยย joined
[14:30:15] 🤖 Sending: "สวัสดี น้ำเหน่ยย"
[14:30:16] ✅ Message sent: "สวัสดี น้ำเหน่ยย"
```
- ✅ Uses their **real name**
- ✅ Records join time automatically

### 2. **Auto-Goodbye on Leave**
When someone leaves the room:
```
[14:35:42] 👋 น้ำเหน่ยย left after 5นาที 27วินาที
[14:35:42] 🤖 Sending: "bye~ น้ำเหน่ยย (อยู่ 5นาที 27วินาที)"
[14:35:43] ✅ Message sent: "bye~ น้ำเหน่ยย (อยู่ 5นาที 27วินาที)"
```
- ✅ Shows how long they were in the room
- ✅ Format: minutes and seconds in Thai

### 3. **Live Chat Monitoring**
```
[14:32:10] 💬 cliché🌼: สบายดีมั้ย
[14:32:15] 💬 ~~~🌸: สบายดีค่ะ
[14:32:20] 🎁 cliché🌼 sent a gift!
```
- ✅ See all messages in real-time
- ✅ Message history on join
- ✅ Gift notifications
- ✅ Reaction notifications

### 4. **Manual Commands**
```
msg สวัสดีทุกคน          # Send message
lock 5                    # Lock speaker slot 5 (owner only)
unlock 5                  # Unlock slot 5 (owner only)
quit                      # Exit bot
```

---

## 🚀 How to Run

```bash
cd ~/Desktop/yellotalk-bot
node bot.js
```

1. Select a room from the list
2. Bot joins automatically
3. **Auto-greets** anyone who joins
4. **Auto-says goodbye** when they leave (with time spent)
5. Type commands anytime
6. Press Ctrl+C or type `quit` to stop

---

## 📊 Example Full Session

```
================================================================================
🤖 YelloTalk Chat Bot
================================================================================

➤ Select room: 1

✅ Successfully joined room!

================================================================================
📺 LIVE CHAT FEED & AUTO-GREETING
================================================================================

Commands:
  msg <text>    - Send message
  lock <1-10>   - Lock speaker slot
  unlock <1-10> - Unlock speaker slot
  quit          - Exit bot

[14:30:00] 📚 Message History (3 total):
--------------------------------------------------------------------------------
  User1: สวัสดีครับ
  User2: หิวข้าว
  User3: ไปกินข้าวกันมั้ย
--------------------------------------------------------------------------------

[14:30:15] 👥 Participants updated (6 total)
[14:30:15] 👋 น้ำเหน่ยย joined
[14:30:15] 🤖 Sending: "สวัสดี น้ำเหน่ยย"
[14:30:16] ✅ Message sent: "สวัสดี น้ำเหน่ยย"

[14:30:25] 💬 น้ำเหน่ยย: ขอบคุณครับ

> msg ยินดีต้อนรับ!
[14:30:40] ✅ Message sent: "ยินดีต้อนรับ!"

[14:35:42] 👥 Participants updated (5 total)
[14:35:42] 👋 น้ำเหน่ยย left after 5นาที 27วินาที
[14:35:42] 🤖 Sending: "bye~ น้ำเหน่ยย (อยู่ 5นาที 27วินาที)"
[14:35:43] ✅ Message sent: "bye~ น้ำเหน่ยย (อยู่ 5นาที 27วินาที)"

> quit
👋 Disconnecting...

================================================================================
📊 Session Summary
================================================================================
Messages received: 8
================================================================================
```

---

## 🎯 Features Summary

| Feature | Status | Description |
|---------|--------|-------------|
| Fetch rooms | ✅ | Shows all active rooms |
| Join room | ✅ | Auto-join selected room |
| Read chat | ✅ | Live message feed |
| Message history | ✅ | Last 15 messages |
| **Auto-greet join** | ✅ | "สวัสดี [name]" |
| **Auto-goodbye leave** | ✅ | "bye~ [name] (อยู่ X time)" |
| **Track join time** | ✅ | Records when users join |
| **Calculate duration** | ✅ | Shows time spent in room |
| Send message | ✅ | `msg <text>` |
| Lock slot | ✅ | `lock <1-10>` (owner only) |
| Unlock slot | ✅ | `unlock <1-10>` (owner only) |
| Keep alive | ✅ | Never disconnects |

---

## 🔧 Technical Details

**Time Tracking:**
- Join time recorded when `participant_changed` fires with new UUID
- Leave time calculated when participant no longer in list
- Duration = leave time - join time
- Formatted in Thai: "5นาที 27วินาที"

**Based on:**
- YelloTalk Android APK v2.9.3 (decompiled)
- Socket.IO v4 protocol
- WebSocket events from LiveCallManager.java

---

**All features working and tested!** ✅
