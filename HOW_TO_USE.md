# 🎮 How to Use YelloTalk Bot

## 🚀 Quick Start

```bash
cd ~/Desktop/yellotalk-bot
node bot.js
```

---

## 📝 What Happens Automatically

### When Someone JOINS:
```
[14:30:15] 👋 น้ำเหน่ยย joined
[14:30:15] 🤖 Sending: "สวัสดี น้ำเหน่ยย"
```
✅ Bot automatically greets with their **real name**
✅ Records their join time

### When Someone LEAVES:
```
[14:35:42] 👋 น้ำเหน่ยย left after 5นาที 27วินาที
[14:35:42] 🤖 Sending: "bye~ น้ำเหน่ยย (อยู่ 5นาที 27วินาที)"
```
✅ Bot says goodbye with their name
✅ Shows how long they stayed

---

## 💬 Manual Commands

While bot is running, type:

### Send a Message
```
msg สวัสดีทุกคน
msg เข้ามาคุยกันนะ
```

### Lock Speaker Slot (Owner Only)
```
lock 1      # Locks slot 1
lock 5      # Locks slot 5
lock 10     # Locks slot 10
```

### Unlock Speaker Slot (Owner Only)
```
unlock 1    # Unlocks slot 1
unlock 8    # Unlocks slot 8
```

### Exit
```
quit
```
or press **Ctrl+C**

---

## 📊 Full Example

```
$ node bot.js

➤ Select room: 1

✅ Successfully joined room!

📺 LIVE CHAT FEED

[14:30:15] 👋 น้ำเหน่ยย joined
[14:30:15] 🤖 Sending: "สวัสดี น้ำเหน่ยย"

[14:30:20] 💬 น้ำเหน่ยย: สวัสดีครับ

> msg ยินดีต้อนรับ
[14:30:25] ✅ Message sent: "ยินดีต้อนรับ"

[14:30:45] 👋 cliché🌼 joined
[14:30:45] 🤖 Sending: "สวัสดี cliché🌼"

> lock 5
[14:31:00] 🔒 Locking speaker slot 5...
[14:31:00] ✅ Slot 5 locked successfully!

[14:35:42] 👋 น้ำเหน่ยย left after 5นาที 27วินาที
[14:35:42] 🤖 Sending: "bye~ น้ำเหน่ยย (อยู่ 5นาที 27วินาที)"

> quit
👋 Disconnecting...

📊 Session Summary
Messages received: 12
```

---

## ⚙️ Configuration

Edit `config.json` to update:
- `jwt_token` - Your auth token
- `pin_name` - Your display name
- `user_uuid` - Your device UUID

---

## 🎯 All Features

- ✅ Auto-greet new participants (real names)
- ✅ Auto-goodbye with time tracking
- ✅ Live chat feed
- ✅ Message history
- ✅ Send messages manually
- ✅ Lock/unlock speaker slots (if owner)
- ✅ Interactive command mode
- ✅ Never disconnects

**Everything working!** 🎉
