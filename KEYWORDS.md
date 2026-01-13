# 🔍 Keyword Detection System

## Current Keywords

### List Users
**Triggers:** `ใครบ้าง`, `คนในห้อง`, `มีใครบ้าง`, `list`, `users`, `who`

**Response:**
```
คนในห้องตอนนี้ (5 คน):
1. cliché🌼
2. ~~~🌸
3. น้ำเหน่ยย
4. กอดหมอน.
5. รถไฟ 🚂
```

**Example:**
```
[16:40:15] 💬 User1: ใครบ้าง
[16:40:15] 🔍 Detected keyword: List users request
[16:40:15] 🤖 Auto-responding with user list
[16:40:16] ✅ Message sent: "คนในห้องตอนนี้ (5 คน):\n1. cliché🌼\n..."
```

---

## 🔧 How to Add More Keywords

### Step 1: Add Keyword to Config

Edit `bot.js` around line 31:

```javascript
const KEYWORDS = {
    LIST_USERS: ['ใครบ้าง', 'คนในห้อง', 'มีใครบ้าง', 'list', 'users', 'who'],

    // Add new keyword groups:
    HELP: ['help', 'ช่วยด้วย', 'คำสั่ง'],
    JOKE: ['เล่าเรื่องตลก', 'ตลก', 'joke'],
    TIME: ['กี่โมง', 'เวลา', 'time'],
};
```

### Step 2: Add Detection Logic

In the `new_message` handler (around line 276):

```javascript
socket.on('new_message', (data) => {
    const message = data.message || '';
    const senderUuid = data.uuid;

    if (senderUuid !== UUID) {
        const messageLower = message.toLowerCase();

        // List users
        if (KEYWORDS.LIST_USERS.some(kw => messageLower.includes(kw))) {
            // ... existing code ...
        }

        // Help command (NEW)
        else if (KEYWORDS.HELP.some(kw => messageLower.includes(kw))) {
            const helpText = `คำสั่งที่ใช้ได้:\n` +
                           `- "ใครบ้าง" = แสดงรายชื่อคนในห้อง\n` +
                           `- "เวลา" = บอกเวลาปัจจุบัน`;
            sendMessage(helpText);
        }

        // Tell time (NEW)
        else if (KEYWORDS.TIME.some(kw => messageLower.includes(kw))) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('th-TH');
            sendMessage(`ตอนนี้เวลา ${timeStr} น.`);
        }
    }
});
```

---

## 📝 Example Keywords to Add

### Useful Commands

```javascript
KEYWORDS = {
    // Current
    LIST_USERS: ['ใครบ้าง', 'คนในห้อง', 'list'],

    // Ideas for future:
    HELP: ['help', 'ช่วย', 'คำสั่ง'],
    TIME: ['เวลา', 'กี่โมง', 'time'],
    COUNT: ['นับ', 'count', 'กี่คน'],
    OWNER: ['เจ้าของ', 'owner', 'ห้องใคร'],
    RULES: ['กฎ', 'rules', 'ข้อตกลง'],
    TOPIC: ['หัวข้อ', 'topic', 'เรื่อง'],
}
```

### Fun Responses

```javascript
KEYWORDS = {
    GREETING: ['สวัสดี', 'hello', 'hi'],
    THANKS: ['ขอบคุณ', 'thanks', 'thank you'],
    JOKE: ['ตลก', 'joke', 'เล่าเรื่อง'],
    COMPLIMENT: ['สวย', 'หล่อ', 'เก่ง'],
}
```

---

## 🎯 Current Implementation

**File:** `bot.js` line 276-298

**How it works:**
1. Bot receives every message
2. Checks if sender is NOT the bot
3. Converts message to lowercase
4. Checks if any keyword is in the message
5. If match → Build response and send

**Features:**
- ✅ Case insensitive
- ✅ Partial match (keyword anywhere in message)
- ✅ Multiple keywords per feature
- ✅ Ignores bot's own messages
- ✅ Easy to expand

---

## 🚀 Test It

**Run bot:**
```bash
cd ~/Desktop/yellotalk-bot
node bot.js
```

**In another account, send:**
```
ใครบ้าง
```

**Bot responds:**
```
คนในห้องตอนนี้ (5 คน):
1. User1
2. User2
3. User3
4. User4
5. User5
```

---

## 📊 Future Keyword Ideas

| Keyword | Response | Use Case |
|---------|----------|----------|
| `ใครบ้าง` | List all users | ✅ Implemented |
| `เวลา` | Current time | Easy to add |
| `นับ` | Count participants | Easy to add |
| `เจ้าของ` | Show room owner | Easy to add |
| `กฎ` | Room rules | Custom text |
| `help` | Show commands | Custom text |

**Ready to add more whenever you want!**
