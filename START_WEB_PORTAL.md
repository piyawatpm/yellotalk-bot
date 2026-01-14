# 🌐 YelloTalk Bot Web Portal

## 🚀 Quick Start

```bash
cd ~/Desktop/yellotalk-bot/web-portal
npm run dev
```

Then open: **http://localhost:3001**

## ✨ Features

### 1. Custom Greetings (`/greetings`)
- Add users who get special greetings
- Example: "baby" → "สวัสดีคนสวย baby"
- Set default greeting for everyone else

### 2. Keyword Management (`/keywords`)
- Define auto-response keywords
- Example: "ใครบ้าง" → Bot lists all users

### 3. Live Updates
- Changes save to `greetings.json`
- Auto-updates bot code
- Just restart bot to apply!

## 📋 Current Settings

**Custom Greetings:**
- botyoi → สวัสดีพี่ชาย
- rose, baby, น้ำเหน่ยย, etc. → สวัสดีคนสวย
- Everyone else → สวัสดีสุดหล่อ

**Keywords:**
- ใครบ้าง, มีใครบ้าง, list, who → Lists all participants

## 🔄 Workflow

1. Open web portal: `npm run dev`
2. Edit greetings/keywords in browser
3. Click "Save" or "Add"
4. Restart bot: `node bot.js`
5. Changes applied! ✅

## 🛠️ Tech Stack

- Next.js 16 (latest canary)
- React 19
- TypeScript
- Tailwind CSS

---

**Portal is ready to use!** 🎉
