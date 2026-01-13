# Bot Commands

## Interactive Commands

While the bot is running and monitoring a room, you can type these commands:

### Send Message
```
msg สวัสดีทุกคน
```

### Lock Speaker Slot
```
lock 1      # Locks slot 1 (0-indexed = position 0)
lock 5      # Locks slot 5 (position 4)
```

### Unlock Speaker Slot
```
unlock 1    # Unlocks slot 1
unlock 5    # Unlocks slot 5
```

### Exit Bot
```
quit
```
or press `Ctrl+C`

---

## Example Session

```bash
$ node bot.js

➤ Select room: 1

✅ Successfully joined room!

📺 LIVE CHAT FEED

Commands:
  msg <text>    - Send message
  lock <1-10>   - Lock speaker slot
  unlock <1-10> - Unlock speaker slot
  quit          - Exit bot

[14:10:23] 💬 User1: สวัสดี

> lock 3
[14:10:45] 🔒 Locked speaker slot 3

[14:10:50] 🎤 User2 joined as speaker
[14:10:50] 👋 Greeting new participant
[14:10:50] 🤖 Sending: "สวัสดี User2"

> msg ยินดีต้อนรับทุกคน
[14:11:02] ✅ Message sent: "ยินดีต้อนรับทุกคน"

> unlock 3
[14:11:15] 🔓 Unlocked speaker slot 3

> quit
👋 Disconnecting...
```

---

## Speaker Slot Positions

Typically YelloTalk rooms have 10 speaker slots:

```
Position 1 (index 0) - First slot
Position 2 (index 1) - Second slot
...
Position 10 (index 9) - Tenth slot
```

When you type `lock 1`, it locks the **first** speaker slot.

---

## Notes

- ✅ Lock/unlock only works if you're the **room owner**
- ✅ Commands work in real-time while monitoring
- ✅ All actions are immediate
- ✅ Bot stays connected until you quit
