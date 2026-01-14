# 🎉 YelloTalk Bot - Complete System

## 🚀 Quick Start (One Command!)

```bash
cd ~/Desktop/yellotalk-bot
./start-all.sh
```

Then open: **http://localhost:5252**

---

## 📦 What's Included

### 1. **YelloTalk Bot** (`bot.js`)
Full-featured bot that:
- ✅ Auto-greets new participants (custom greetings!)
- ✅ Auto-goodbye with time tracking
- ✅ Follow user mode (continuous)
- ✅ Keyword detection & auto-responses
- ✅ Mute/unmute speakers
- ✅ Send messages

**Custom Greetings:**
- botyoi → สวัสดีพี่ชาย
- rose, baby, น้ำเหน่ยย, muda, etc. → สวัสดีคนสวย
- Everyone else → สวัสดีสุดหล่อ

### 2. **Bot Control Server** (`bot-server.js`)
Backend API that:
- ✅ Controls bot (start/stop)
- ✅ Provides bot status
- ✅ Fetches rooms from YelloTalk
- ✅ Real-time WebSocket updates
- ✅ Port: 3002

### 3. **Web Portal** (`web-portal/`)
Beautiful web interface with:
- ✅ **Control Page** - Start/stop bot, select rooms, live chat
- ✅ **Greetings Page** - Manage custom greetings
- ✅ **Keywords Page** - Manage auto-responses
- ✅ **Dashboard** - Overview & stats
- ✅ Built with Next.js 16 + shadcn/ui
- ✅ Port: 5252

---

## 🎮 Two Ways to Run

### Option A: One Script (Easiest!)
```bash
./start-all.sh
```
Starts both servers, then open http://localhost:5252

### Option B: Separate Terminals (More Control)

**Terminal 1:**
```bash
node bot-server.js
```

**Terminal 2:**
```bash
cd web-portal
npm run dev
```

Then open: http://localhost:5252

---

## 🌐 Web Portal Features

### Control Page (`/control`)

**Bot Control Panel:**
- Start/Stop button
- Mode selection (Regular vs Follow User)
- Room dropdown (shows all active rooms)
- User dropdown (shows all room owners)
- Real-time status indicators

**Live Chat Feed:**
- See all messages in real-time
- User avatars & timestamps
- Send messages from browser
- Auto-scroll to bottom

**Participant List:**
- Who's currently in room
- Live updates when people join/leave
- Online indicators

**Status Bar:**
- Bot status (Running/Stopped/Error)
- Current room name
- Message count
- Participant count
- Uptime

### Greetings Page (`/greetings`)
- Add custom greetings by username
- Edit default greeting
- Preview how greetings work
- Remove greetings
- **Auto-updates bot code!**

### Keywords Page (`/keywords`)
- Add auto-response keywords
- Example: "ใครบ้าง" → Bot lists all users
- Remove keywords
- See response preview

### Dashboard (`/`)
- System overview
- Quick stats
- Navigation to all features

---

## 🎨 UI Design (shadcn/ui)

**Components used:**
- Cards, Badges, Buttons
- Tabs, Selects, Inputs
- ScrollArea, Separator
- Skeleton loaders
- Toast notifications
- Responsive grid layouts

**Features:**
- Modern, clean design
- Smooth animations
- Mobile-friendly
- Professional look
- Easy to use

---

## 🔧 Architecture

```
┌──────────────────────────────────────────────┐
│          Browser (http://localhost:5252)      │
│  Next.js 16 Web Portal with shadcn/ui        │
│                                              │
│  Pages:                                      │
│  - / (Dashboard)                            │
│  - /control (Bot Control) ← Main interface  │
│  - /greetings (Manage greetings)            │
│  - /keywords (Manage keywords)              │
└──────────────┬───────────────────────────────┘
               │
               │ HTTP + WebSocket
               ▼
┌──────────────────────────────────────────────┐
│    Bot Control Server (localhost:3002)       │
│    bot-server.js (Express + Socket.IO)       │
│                                              │
│    REST API:                                 │
│    - GET  /api/bot/status                   │
│    - GET  /api/bot/rooms                    │
│    - POST /api/bot/start                    │
│    - POST /api/bot/stop                     │
│                                              │
│    WebSocket Events:                         │
│    - bot-state (status updates)             │
│    - new-message (chat messages)            │
│    - participant-update (room changes)      │
└──────────────┬───────────────────────────────┘
               │
               │ Controls
               ▼
┌──────────────────────────────────────────────┐
│           YelloTalk Bot (bot.js)             │
│    Socket.IO client to YelloTalk            │
│    Monitors rooms, greets people, etc.       │
└──────────────┬───────────────────────────────┘
               │
               │ WebSocket
               ▼
┌──────────────────────────────────────────────┐
│         YelloTalk Servers                    │
│    wss://live.yellotalk.co:8443             │
└──────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
yellotalk-bot/
├── bot.js                    # Main bot (standalone mode)
├── bot-server.js             # Bot control server (NEW!)
├── start-all.sh              # Launch everything (NEW!)
├── config.json               # Bot configuration
├── greetings.json            # Greetings data
├── package.json
├── START.md                  # This file
└── web-portal/               # Web portal (NEW!)
    ├── app/
    │   ├── layout.tsx        # Navigation
    │   ├── page.tsx          # Dashboard
    │   ├── control/
    │   │   └── page.tsx      # Bot control interface
    │   ├── greetings/
    │   │   └── page.tsx      # Greeting management
    │   ├── keywords/
    │   │   └── page.tsx      # Keyword management
    │   └── api/
    │       └── greetings/
    │           └── route.ts  # API endpoints
    ├── components/
    │   └── ui/               # shadcn components
    ├── lib/
    │   └── utils.ts          # Utilities
    ├── package.json
    └── tailwind.config.ts
```

---

## 🎯 Usage Examples

### Example 1: Monitor a Specific Room
1. Open http://localhost:5252/control
2. Click "Regular" mode
3. Select room from dropdown
4. Click "Start Bot"
5. Watch live chat feed!

### Example 2: Follow a User
1. Open http://localhost:5252/control
2. Click "Follow User" mode
3. Select user from dropdown
4. Click "Start Bot"
5. Bot auto-joins whenever they create a room!

### Example 3: Customize Greetings
1. Open http://localhost:5252/greetings
2. Add username: "มาดอนน่า"
3. Add greeting: "สวัสดีคนสวย"
4. Click "Add Greeting"
5. Bot now greets มาดอนน่า specially!

### Example 4: Send Message from Browser
1. Bot is running
2. Go to Control page
3. Type message in input box
4. Click "Send"
5. Message appears in YelloTalk room!

---

## ✅ Complete Feature List

**Bot Features:**
- Auto-greet with custom messages
- Auto-goodbye with time
- Follow user across rooms
- Keyword auto-responses
- Mute/unmute speakers
- Real-time chat monitoring

**Web Portal Features:**
- Start/stop bot from browser
- Select room or follow user
- Live chat feed
- Send messages
- View participants
- Manage greetings
- Manage keywords
- Real-time status
- Beautiful UI with shadcn

**Tech Stack:**
- Node.js + Socket.IO (bot)
- Express + Socket.IO (control server)
- Next.js 16 (web portal)
- shadcn/ui + Tailwind CSS
- TypeScript
- Real-time WebSocket communication

---

## 🎊 Ready to Use!

**Just run:**
```bash
./start-all.sh
```

**Then visit:**
```
http://localhost:5252
```

**Everything is complete and working!** 🚀
