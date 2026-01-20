# YelloTalk Bot 🤖

Advanced YelloTalk room monitoring bot with web control panel.

## Features

- 🌐 **Web Control Panel** - Modern UI to control the bot
- 💬 **Real-time Chat** - Monitor and send messages
- 🎤 **Speaker Control** - Lock/unlock/mute/kick speakers (with room hijack)
- 👥 **Participant Management** - View and kick participants
- 🤖 **AI Chat** - Groq-powered conversation with memory
- 📍 **Follow Mode** - Auto-join rooms created by specific users
- 🎨 **Custom Greetings** - Personalized greetings per user

## Quick Start

### 1. Install Dependencies

```bash
# Install root dependencies
npm install

# Install web portal dependencies
cd web-portal
npm install
cd ..
```

### 2. Configure

Edit `config.json` with your credentials:

```json
{
  "jwt_token": "your_jwt_token",
  "user_uuid": "your_uuid",
  "pin_name": "your_display_name",
  "avatar_id": 0,
  "websocket_url": "wss://live.yellotalk.co:8443/socket.io/?EIO=4&transport=websocket",
  "api_base_url": "https://live.yellotalk.co",
  "groq_api_keys": ["your_groq_api_key"]
}
```

### 3. Run

**Option A: With Web Portal (Recommended)**

Terminal 1 - Start bot server:
```bash
node bot-server.js
```

Terminal 2 - Start web portal:
```bash
cd web-portal
npm run dev
```

Then open http://localhost:3000/control in your browser.

**Option B: CLI Mode**

```bash
node bot.js
```

## Web Portal Features

### Bot Control
- **Regular Mode**: Select and monitor specific rooms
- **Follow Mode**: Automatically join rooms created by a user
- Start/Stop bot with one click
- Real-time status updates

### Speaker Control (Auto-Hijack Mode)
- Lock/unlock speaker slots
- Mute/unmute speakers
- Kick speakers from slots
- Control all 10 speaker positions

### Chat Management
- View live chat feed
- Send messages to the room
- See participant list
- Kick users from room

### Configuration
- Reload greetings without restart
- Toggle welcome messages
- Toggle auto-hijack mode (room ownership exploit)

## Greetings Configuration

Edit `greetings.json` to customize greetings:

```json
{
  "customGreetings": {
    "username": "Custom greeting message",
    "another_user": "Different greeting"
  },
  "defaultGreeting": "Default message for everyone else",
  "keywords": {
    "listUsers": ["list", "users", "who"]
  }
}
```

## Requirements

- Node.js 14+
- npm

## Project Structure

```
yellotalk-bot/
├── bot.js              # CLI bot (legacy)
├── bot-server.js       # Bot control server (port 5353)
├── config.json         # Bot configuration
├── greetings.json      # Greetings configuration
├── package.json        # Root dependencies
└── web-portal/         # Next.js web control panel
    ├── app/            # Pages and routes
    ├── components/     # React components
    └── package.json    # Portal dependencies
```

## Advanced Features

### Auto-Hijack Mode
When enabled, the bot joins rooms as the owner using the `create_room` exploit, giving full control over speaker slots. This is a beta feature.

### AI Chat Integration
Uses Groq API with conversation memory. The bot can:
- Remember previous conversations per user
- Respond contextually
- List room participants on request

### Follow Mode
The bot monitors a specific user and automatically joins any room they create, with configurable polling interval.

---

**Ready to use!** Start with `node bot-server.js` and open the web portal.
