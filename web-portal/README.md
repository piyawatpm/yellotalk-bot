# YelloTalk Bot Web Portal

Web interface to manage bot greetings and keywords.

## Features

- ✅ Manage custom greetings for specific users
- ✅ Set default greeting for everyone else
- ✅ Manage keyword auto-responses
- ✅ Live preview of bot behavior
- ✅ Auto-updates bot.js when you save

## Quick Start

```bash
cd ~/Desktop/yellotalk-bot/web-portal
npm run dev
```

Open: http://localhost:3001

## Pages

- **Dashboard** (`/`) - Overview and quick stats
- **Greetings** (`/greetings`) - Manage custom greetings
- **Keywords** (`/keywords`) - Manage keyword responses

## How It Works

1. Edit greetings/keywords in the web UI
2. Click "Save" or "Add"
3. Portal updates `greetings.json`
4. Portal auto-updates `bot.js` code
5. Restart bot to apply changes

## Tech Stack

- Next.js 16 (canary)
- React 19
- TypeScript
- Tailwind CSS
- API Routes for data persistence

Built with ❤️ for YelloTalk bot management
