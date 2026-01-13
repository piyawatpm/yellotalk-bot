# 🤖 YelloTalk Bot - Exact Behavior

## ✅ What Happens (Step by Step)

### 1️⃣ Bot Joins Room

```
[16:30:00] 🔌 Connecting to: Room Name
[16:30:00] ✅ Connected!
[16:30:00] 📥 Joining room...
[16:30:01] ✅ Successfully joined room!
[16:30:01] 📜 Loading message history...

[16:30:02] 📚 Message History (5 total):
  User1: สวัสดี
  User2: หวัดดี
  ...

[16:30:03] 👥 Participants updated (7 total)
[16:30:03] 📋 Initial state saved - NOT greeting existing 7 participants
```

✅ **Does NOT greet anyone already in room**
✅ **Records join time for all existing participants**

---

### 2️⃣ Someone NEW Joins

```
[16:35:15] 👥 Participants updated (8 total)
[16:35:15] 👋 NewPerson joined
[16:35:15] 🤖 Sending: "สวัสดี NewPerson"
[16:35:16] ✅ Message sent: "สวัสดี NewPerson"
```

✅ **Only greets NEW participant**
✅ **Records their join time**
✅ **No duplicate greets**

---

### 3️⃣ Someone Leaves

```
[16:40:30] 👥 Participants updated (7 total)
[16:40:30] 👋 NewPerson left after 5นาที 15วินาที
[16:40:30] 🤖 Sending: "bye~ NewPerson (อยู่ 5นาที 15วินาที)"
[16:40:31] ✅ Message sent: "bye~ NewPerson (อยู่ 5นาที 15วินาที)"
```

✅ **Detects who left**
✅ **Calculates time** (leave time - join time)
✅ **Says goodbye with duration**

---

### 4️⃣ Someone Asks "ใครบ้าง"

```
[16:42:00] 💬 User1: ใครบ้าง
[16:42:00] 🔍 Detected keyword: List users request
[16:42:00] 🤖 Auto-responding with user list (6 users)
[16:42:01] ✅ Message sent: "คนในห้องตอนนี้ (6 คน):
1. User1
2. User2
3. User3
4. User4
5. User5
6. User6"
```

✅ **Detects keyword**
✅ **Lists all current users (excluding bot)**
✅ **Correct count**

---

## 🔧 Logic Summary

| Event | Action |
|-------|--------|
| **First `participant_changed`** | Save all → Don't greet → Set initialized |
| **New participant in list** | Record time → Greet → Update list |
| **Participant missing from list** | Calculate duration → Goodbye → Clean up |
| **Message contains keyword** | Detect → Build response → Send |

---

## ✅ Fixed Issues

1. ❌ ~~Greeted all participants on join~~ → ✅ Fixed: Skips initial greeting
2. ❌ ~~Duplicate greets~~ → ✅ Fixed: Checks participantJoinTimes
3. ❌ ~~Count showing -1~~ → ✅ Fixed: Uses filtered list length

---

## 🚀 Ready to Use

```bash
cd ~/Desktop/yellotalk-bot
node bot.js
```

**Behavior is now EXACTLY as requested:**
- Only greets NEW people
- Only says bye to people who leave
- Tracks time correctly
- Responds to keywords

Perfect! ✅
