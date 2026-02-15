# YelloTalk Bot 🤖

Advanced YelloTalk room monitoring bot with web control panel and multi-bot support.

## Features

- 🌐 **Web Control Panel** - Modern Next.js UI to control multiple bots
- 💬 **Real-time Chat** - Monitor and send messages
- 🎤 **Speaker Control** - Lock/unlock/mute/kick speakers (with room hijack)
- 👥 **Participant Management** - View and kick participants
- 🤖 **AI Chat** - Groq-powered conversation with memory
- 📍 **Follow Mode** - Auto-join rooms created by specific users
- 🎨 **Custom Greetings** - Personalized greetings per user
- 🔄 **Multi-Bot Support** - Manage multiple bot accounts simultaneously

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Obtaining JWT Token](#2-obtain-your-jwt-token)
  - [Using Proxyman (macOS)](#option-a-using-proxyman-macos---recommended)
  - [Using Charles Proxy](#option-b-using-charles-proxy-cross-platform)
  - [Using Wireshark](#option-c-using-wireshark-advanced---all-platforms)
  - [Using mitmproxy](#option-d-using-mitmproxy-command-line---cross-platform)
- [Configuration](#3-configure-the-bot)
- [Multi-Bot Setup](#multi-bot-configuration)
- [Greetings Configuration](#greetings-configuration)
- [Web Portal Features](#web-portal-features)
- [Troubleshooting](#troubleshooting)
- [FAQ](#frequently-asked-questions-faq)
- [API Reference](#api-endpoints-reference)
- [Contributing](#contributing)

## Prerequisites

- Node.js 14+ and npm
- YelloTalk account credentials (JWT token and UUID)
- Groq API key (optional, for AI chat features)
- Network monitoring tool (Proxyman, Charles, or mitmproxy)

## Quick Start

**⚡ TL;DR - Get started in 5 minutes:**

1. Install dependencies: `npm install && cd web-portal && npm install && cd ..`
2. Capture your JWT token using Proxyman/Charles (see detailed guide below)
3. Copy config: `cp config.example.json config.json` and add your token
4. Start bot: `node bot-server.js`
5. Start web portal: `cd web-portal && npm run dev`
6. Open `http://localhost:3000/control`

**Detailed Setup Guide:**

### 1. Install Dependencies

```bash
# Install root dependencies
npm install

# Install web portal dependencies
cd web-portal
npm install
cd ..
```

### 2. Obtain Your JWT Token

📖 **For detailed, step-by-step instructions with troubleshooting, see [SETUP_GUIDE.md](SETUP_GUIDE.md)**

You need to extract your JWT token from the YelloTalk app. Use one of these network monitoring tools:

**Quick Tool Comparison:**

| Tool | Platform | UI | Best For | Difficulty |
|------|----------|----|---------|-----------| 
| **Proxyman** | macOS only | GUI ⭐⭐⭐⭐⭐ | Mac users, beginners | Easy |
| **Charles** | All | GUI ⭐⭐⭐⭐ | Cross-platform, professionals | Moderate |
| **mitmproxy** | All | CLI/Web ⭐⭐⭐ | Developers, automation | Advanced |
| **Wireshark** | All | GUI ⭐⭐ | Network experts only | Expert |

**💡 Recommendation**: 
- **Mac users**: Use Proxyman (easiest and most intuitive)
- **Windows/Linux users**: Use Charles Proxy (best GUI for all platforms)
- **Command-line users**: Use mitmproxy with `mitmweb` for web interface

**📋 How It Works:**

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   YelloTalk     │         │  Proxy Tool     │         │  YelloTalk      │
│   Mobile App    │────────▶│  (Intercepts    │────────▶│  Server         │
│   (iOS/Android) │         │   Traffic)      │         │  live.yellotalk │
└─────────────────┘         └─────────────────┘         └─────────────────┘
                                     │
                                     │ Captures
                                     ▼
                            ┌─────────────────┐
                            │  JWT Token      │
                            │  Authorization: │
                            │  Bearer eyJ...  │
                            └─────────────────┘
```

The proxy tool sits between your device and the YelloTalk server, allowing you to see all HTTP/HTTPS requests, including the JWT token sent in the `Authorization` header.

---

#### Option A: Using Proxyman (macOS - Recommended)

**Step 1: Download and Install Proxyman**
- Download from [proxyman.io](https://proxyman.io)
- Install and open Proxyman
- Grant necessary permissions when prompted

**Step 2: Setup SSL Proxying**
- Go to `Certificate` menu → `Install Certificate on this Mac`
- Enter your Mac password when prompted
- For iOS Simulator: `Certificate` menu → `Install Certificate on iOS` → `Simulator`
- For physical iOS device:
  - `Certificate` menu → `Install Certificate on iOS` → `Physical Devices`
  - Follow the on-screen instructions to install the certificate on your device
  - On iOS device: Settings → General → VPN & Device Management → Install Profile

**Step 3: Configure Your Device (iOS/Android)**
- **For iOS Simulator**: Proxyman automatically configures the proxy
- **For Physical Device**:
  - Connect your device to the same Wi-Fi network as your Mac
  - On your device: Settings → Wi-Fi → Tap (i) next to your network
  - Scroll down to HTTP Proxy → Select `Manual`
  - Server: Your Mac's IP address (shown in Proxyman)
  - Port: `9090` (default Proxyman port)

**Step 4: Enable SSL Proxying for YelloTalk**
- In Proxyman, go to `Certificate` menu → `SSL Proxying List`
- Click the `+` button to add a new domain
- Enter:
  - Host: `live.yellotalk.co`
  - Port: `443`
- Click `Save`
- Alternatively: Right-click on any `live.yellotalk.co` request → `Enable SSL Proxying`

**Step 5: Capture the Token**
- Open YelloTalk app on your device/simulator
- Log in to your account (or browse if already logged in)
- In Proxyman, use the filter bar at the top to search for `live.yellotalk.co`
- Look for API requests to endpoints like:
  - `GET /v1/rooms/popular` ⭐ (Best option)
  - `GET /v1/rooms/{room_id}`
  - `GET /v1/users/me`
  - `POST /v1/rooms/{room_id}/join`
- Click on any request to view details
- In the right panel, go to `Request` tab
- Scroll down to the `Headers` section
- Find the `Authorization` header:
  ```
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1dWlkIjoiWU9VUi1VVUlEIiwiaWF0IjoxNzAwMDAwMDAwfQ.signature_here
  ```
- Copy the entire JWT token (everything after `Bearer `, starting with `eyJ`)

**Step 6: Extract UUID**
- **Method 1**: From Response
  - In the same request, click the `Response` tab
  - Look for JSON containing your user information
  - Find the `uuid` field (format: `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`)
  
- **Method 2**: Decode JWT Token
  - Go to [jwt.io](https://jwt.io)
  - Paste your JWT token in the "Encoded" section
  - Look at the "Payload" section (decoded)
  - Find the `uuid` field

**Example JWT Payload:**
```json
{
  "uuid": "12345678-1234-1234-1234-123456789ABC",
  "iat": 1700000000
}
```

#### Option B: Using Charles Proxy (Cross-platform)

**Step 1: Download and Install Charles**
- Download from [charlesproxy.com](https://www.charlesproxy.com)
- Install and open Charles Proxy
- Grant necessary permissions when prompted

**Step 2: Install Charles Root Certificate**
- On your computer:
  - Go to `Help` → `SSL Proxying` → `Install Charles Root Certificate`
  - Follow the system prompts to trust the certificate
  - **macOS**: Open Keychain Access → Find "Charles Proxy CA" → Double-click → Trust → Always Trust
  - **Windows**: Certificate will be installed automatically
  
- For mobile device:
  - Go to `Help` → `SSL Proxying` → `Install Charles Root Certificate on a Mobile Device`
  - Charles will show instructions with your computer's IP address
  - On your mobile device, configure proxy (see Step 3)
  - Open browser and go to `chls.pro/ssl` to download the certificate
  - Install the certificate on your device
  - **iOS**: Settings → General → VPN & Device Management → Install Profile → Enable in Certificate Trust Settings
  - **Android**: Settings → Security → Install from storage

**Step 3: Configure Your Device Proxy**
- Connect your device to the same network as your computer
- **iOS**:
  - Settings → Wi-Fi → Tap (i) next to your network
  - HTTP Proxy → Manual
  - Server: Your computer's IP (shown in Charles)
  - Port: `8888`
  
- **Android**:
  - Settings → Wi-Fi → Long press your network → Modify Network
  - Advanced Options → Proxy → Manual
  - Proxy hostname: Your computer's IP
  - Proxy port: `8888`

**Step 4: Setup SSL Proxying**
- In Charles, go to `Proxy` → `SSL Proxying Settings`
- Check `Enable SSL Proxying`
- Click `Add` under the `Include` section
- Enter:
  - Host: `live.yellotalk.co`
  - Port: `443`
- Click `OK` to save

**Step 5: Capture the Token**
- Ensure recording is active: `Proxy` → `Start Recording` (or press Cmd+R / Ctrl+R)
- Open YelloTalk app on your device
- Log in to your account (or navigate through the app if already logged in)
- In Charles, find `live.yellotalk.co` in the left panel (Structure view)
- Expand the domain and look for API endpoints:
  - `/v1/rooms/popular` ⭐ (Recommended)
  - `/v1/rooms/`
  - `/v1/users/`
- Click on a request
- In the right panel, select the `Request` tab
- Click on `Headers` sub-tab
- Find the `Authorization` header:
  ```
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  ```
- Right-click on the value and select `Copy Value`
- Copy only the token part (after `Bearer `)

**Step 6: Extract UUID**
- Same as Proxyman method above - use the Response tab or decode at [jwt.io](https://jwt.io)

#### Option C: Using Wireshark (Advanced - All Platforms)

1. **Download and Install Wireshark**
   - Download from [wireshark.org](https://www.wireshark.org)
   - Install Wireshark

2. **Start Packet Capture**
   - Open Wireshark
   - Select your network interface (Wi-Fi or Ethernet)
   - Click the blue shark fin icon to start capturing

3. **Filter HTTPS Traffic**
   - In the filter bar, enter: `http.host contains "yellotalk.co"`
   - Or: `ssl.handshake.type == 1`

4. **Decrypt SSL/TLS (Advanced)**
   - **Note**: Wireshark cannot decrypt HTTPS traffic without the private key or SSL key log file
   - For mobile apps, you'll need to:
     - Root/jailbreak your device, OR
     - Use a proxy tool (Proxyman/Charles) instead, OR
     - Set up SSL key logging on your device

5. **Alternative: Capture HTTP Headers via Proxy**
   - Configure Wireshark to capture traffic through a proxy
   - Use Proxyman or Charles to decrypt, then analyze in Wireshark

**Wireshark Limitation**: Due to SSL/TLS encryption, Wireshark alone cannot easily decrypt HTTPS traffic from mobile apps. **Proxyman or Charles are recommended** for this task.

#### Option D: Using mitmproxy (Command-line - Cross-platform)

**Step 1: Install mitmproxy**

```bash
# macOS (using Homebrew)
brew install mitmproxy

# Linux (using pip)
pip install mitmproxy

# Windows (using pip)
pip install mitmproxy

# Or using pipx (recommended for isolated installation)
pipx install mitmproxy
```

**Step 2: Start mitmproxy**

```bash
# Interactive mode (recommended for beginners)
mitmproxy

# Or use mitmweb for a web interface
mitmweb

# Or use mitmdump for logging to file
mitmdump -w traffic.log
```

**Step 3: Install Certificate on Your Device**

- Configure your device's proxy to your computer's IP address, port `8080`
- On your mobile device, open a browser and visit `mitm.it`
- Download and install the certificate for your platform:
  - **iOS**: Download → Install Profile → Settings → General → VPN & Device Management
  - **Android**: Download → Install from storage
- **Important**: On iOS, also enable the certificate in: Settings → General → About → Certificate Trust Settings

**Step 4: Configure Device Proxy**

- **iOS**:
  - Settings → Wi-Fi → Tap (i) → HTTP Proxy → Manual
  - Server: Your computer's IP
  - Port: `8080`

- **Android**:
  - Settings → Wi-Fi → Long press → Modify Network → Proxy → Manual
  - Hostname: Your computer's IP
  - Port: `8080`

**Step 5: Capture the Token**

Using `mitmproxy` (interactive):
```bash
mitmproxy
```

- Open YelloTalk app and log in
- In the mitmproxy terminal, you'll see requests flowing
- Press `/` to search, type `yellotalk` and press Enter
- Navigate with arrow keys to find requests to `live.yellotalk.co`
- Look for endpoints like `/v1/rooms/popular`
- Press `Enter` to view request details
- Press `Tab` to switch between Request/Response
- Look for the `Authorization` header
- The JWT token will be after `Bearer `

Using `mitmweb` (web interface):
```bash
mitmweb
```

- Open `http://127.0.0.1:8081` in your browser
- Open YelloTalk app and log in
- In the web interface, filter by typing `yellotalk` in the search box
- Click on a request to `live.yellotalk.co`
- View the `Request` tab → `Headers` section
- Find and copy the `Authorization` header value

**Step 6: Extract UUID**
- Same as previous methods - decode the JWT at [jwt.io](https://jwt.io)

### 3. Configure the Bot

Copy the example configuration files and edit them with your credentials:

```bash
cp config.example.json config.json
cp greetings.example.json greetings.json
```

Then edit `config.json` with your credentials:

```json
{
  "jwt_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1dWlkIjoiWU9VUi1VVUlELUhFUkUiLCJpYXQiOjE3MDAwMDAwMDB9.signature",
  "user_uuid": "YOUR-UUID-HERE",
  "pin_name": "Your Display Name",
  "avatar_id": 0,
  "websocket_url": "wss://live.yellotalk.co:8443/socket.io/?EIO=4&transport=websocket",
  "api_base_url": "https://live.yellotalk.co",
  "groq_api_keys": ["your_groq_api_key_here"],
  "bots": []
}
```

**Configuration Fields:**
- `jwt_token`: Your JWT authentication token (from step 2)
- `user_uuid`: Your user UUID (can be decoded from JWT at jwt.io)
- `pin_name`: Display name for the bot
- `avatar_id`: Avatar ID (0-99, check YelloTalk for available avatars)
- `groq_api_keys`: Array of Groq API keys for AI chat (get from [console.groq.com](https://console.groq.com))
- `bots`: Array of additional bot configurations (optional, for multi-bot setup)

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

## Multi-Bot Configuration

The bot supports managing multiple bot accounts simultaneously. This is useful for:
- Running multiple bots in different rooms
- Load balancing across multiple accounts
- Having backup bots ready

### Adding Additional Bots

Edit the `bots` array in `config.json`:

```json
{
  "jwt_token": "main_bot_token",
  "user_uuid": "main_bot_uuid",
  "pin_name": "Main Bot",
  "bots": [
    {
      "id": "bot-1",
      "name": "Assistant Bot 1",
      "bot_name": "Assistant 1",
      "jwt_token": "bot1_jwt_token_here",
      "user_uuid": "bot1_uuid_here",
      "avatar_id": 1
    },
    {
      "id": "bot-2",
      "name": "Assistant Bot 2",
      "bot_name": "Assistant 2",
      "jwt_token": "bot2_jwt_token_here",
      "user_uuid": "bot2_uuid_here",
      "avatar_id": 2
    }
  ]
}
```

**Bot Configuration Fields:**
- `id`: Unique identifier for the bot (can be any string)
- `name`: Internal name for the bot
- `bot_name`: Display name shown in YelloTalk
- `jwt_token`: JWT token for this bot account (obtain using the same method as main bot)
- `user_uuid`: UUID for this bot account
- `avatar_id`: Avatar ID (0-99)

### Managing Multiple Bots via Web Portal

The web portal allows you to:
1. View all configured bots
2. Start/stop individual bots
3. Assign bots to different rooms
4. Monitor each bot's status independently

## Greetings Configuration

The bot can automatically greet users when they join a room. Edit `greetings.json` to customize greetings:

### Basic Configuration

```json
{
  "customGreetings": {
    "username1": "Hello! Welcome back!",
    "username2": "Hey there, nice to see you!"
  },
  "defaultGreeting": "Welcome to the room!",
  "keywords": {
    "listUsers": ["list", "users", "who", "who's here"]
  }
}
```

### Advanced Configuration (UUID-based)

You can also use UUIDs for more reliable user identification:

```json
{
  "customGreetings": {
    "username1": "Simple greeting by username",
    "12345678-1234-1234-1234-123456789ABC": {
      "greeting": "Custom greeting for this specific user",
      "name": "Display Name"
    }
  },
  "defaultGreeting": "Welcome everyone!",
  "keywords": {
    "listUsers": ["list", "users", "who"]
  }
}
```

### Configuration Options

**`customGreetings`**: Object mapping usernames or UUIDs to custom greetings
- **Simple format**: `"username": "greeting message"`
- **Advanced format**: `"uuid": { "greeting": "message", "name": "display name" }`

**`defaultGreeting`**: Fallback greeting for users without custom greetings

**`keywords`**: Define trigger words for bot commands
- `listUsers`: Keywords that trigger the bot to list all participants in the room

### Greeting Features

- **Per-user customization**: Different greetings for different users
- **UUID-based**: More reliable than username (usernames can change)
- **Default fallback**: Ensures everyone gets greeted
- **Emoji support**: Use emojis in greetings for more personality
- **Multi-language**: Support any language (Thai, English, etc.)

### Reloading Greetings

You can reload greetings without restarting the bot:
- Via web portal: Click "Reload Greetings" button
- The bot will load the latest `greetings.json` configuration

## Troubleshooting

### JWT Token Issues

**Problem: Token expired or invalid**

Symptoms:
- Bot fails to connect with "401 Unauthorized" error
- API requests return authentication errors

Solutions:
- JWT tokens may expire after a certain period (usually days/weeks)
- Re-capture the token using the steps above
- Verify token format is correct (should start with `eyJ`)
- Check if you copied the entire token without extra spaces
- Ensure you're using the token from the `Authorization` header, not from URL parameters

**Problem: Cannot capture token / No requests showing**

Solutions:
- **SSL Proxying not enabled:**
  - Ensure SSL proxying is enabled for `live.yellotalk.co` domain
  - Check that port `443` is included in SSL proxying settings
  
- **Certificate not trusted:**
  - Verify the proxy certificate is installed on your device
  - **iOS**: Check Settings → General → About → Certificate Trust Settings
  - **Android**: Check Settings → Security → Trusted Credentials
  
- **Wrong proxy settings:**
  - Double-check your device's proxy IP address matches your computer's IP
  - Verify the proxy port (9090 for Proxyman, 8888 for Charles, 8080 for mitmproxy)
  - Ensure both devices are on the same Wi-Fi network
  
- **App cache issues:**
  - Force quit YelloTalk app completely
  - Clear app cache (iOS: Reinstall app, Android: Settings → Apps → YelloTalk → Clear Cache)
  - Log out and log back in to YelloTalk
  
- **Network interface:**
  - Make sure you're capturing traffic from the correct network interface
  - Try disabling VPN if you're using one
  - Check firewall settings aren't blocking the proxy

**Problem: UUID not found**

Solutions:
- **Method 1**: Decode JWT at [jwt.io](https://jwt.io)
  - Paste your JWT token in the "Encoded" section
  - Look at the "Payload" section (right side)
  - Find the `uuid` field
  
- **Method 2**: Check API Response
  - Look at the response body of `/v1/users/me` endpoint
  - Find the `uuid` field in the JSON response
  
- **Method 3**: Check any API response
  - Most API responses include user information
  - Look for fields like `user`, `profile`, or `account` containing `uuid`

- **UUID Format**: `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX` (uppercase with hyphens)

**Problem: "SSL Handshake Failed" or "Certificate Error"**

Solutions:
- Reinstall the proxy certificate on your device
- Ensure certificate is trusted in system settings
- For iOS: Enable certificate in both "Install Profile" AND "Certificate Trust Settings"
- Try using HTTP instead of HTTPS temporarily to test connectivity (not recommended for production)

**Problem: Requests appear but are encrypted/unreadable**

Solutions:
- SSL proxying is not properly configured
- Re-enable SSL proxying specifically for `live.yellotalk.co`
- Restart the proxy tool after enabling SSL proxying
- Restart your device after installing the certificate

### Network Monitoring Tool Comparison

| Tool | Platform | Ease of Use | Best For |
|------|----------|-------------|----------|
| **Proxyman** | macOS | ⭐⭐⭐⭐⭐ Easy | Mac users, iOS development |
| **Charles Proxy** | All | ⭐⭐⭐⭐ Moderate | Cross-platform, professional use |
| **mitmproxy** | All | ⭐⭐⭐ Advanced | Command-line users, automation |
| **Wireshark** | All | ⭐⭐ Expert | Network analysis (not ideal for HTTPS) |

**Recommendation**: Use **Proxyman** (macOS) or **Charles Proxy** (Windows/Linux) for the easiest experience.

## Requirements

- Node.js 14+
- npm
- Network monitoring tool (Proxyman, Charles, or mitmproxy)

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

## Security & Privacy

⚠️ **Important Security Notes:**

1. **Keep Your JWT Token Private**
   - Never share your JWT token publicly
   - Don't commit `config.json` with real tokens to version control
   - Add `config.json` to `.gitignore`

2. **Token Security**
   - JWT tokens grant full access to your YelloTalk account
   - Anyone with your token can impersonate you
   - Regenerate tokens if compromised (log out and log back in)

3. **Network Monitoring**
   - Only use network monitoring tools on your own devices
   - Don't capture traffic from others without permission
   - Follow local laws and regulations regarding network monitoring

4. **Bot Usage**
   - Use bots responsibly and follow YelloTalk's Terms of Service
   - Don't spam or harass other users
   - Respect room owners and participants

## Frequently Asked Questions (FAQ)

### General Questions

**Q: Is this bot safe to use?**
A: The bot uses the official YelloTalk API endpoints. However, using bots may violate YelloTalk's Terms of Service. Use at your own risk.

**Q: Will my account get banned?**
A: There's always a risk when using unofficial tools. To minimize risk:
- Don't spam messages
- Don't abuse speaker controls
- Use reasonable delays between actions
- Don't run too many bots simultaneously

**Q: Can I run multiple bots on the same account?**
A: No, each bot needs its own YelloTalk account with unique JWT token and UUID.

**Q: How long does the JWT token last?**
A: JWT tokens typically last for several days to weeks. You'll need to re-capture the token when it expires.

### Setup Questions

**Q: Do I need a Mac to use this bot?**
A: No! The bot runs on any platform (Mac, Windows, Linux). However, capturing the JWT token is easiest on Mac using Proxyman. Windows/Linux users can use Charles Proxy.

**Q: Can I use this without the web portal?**
A: Yes, you can use `node bot.js` for CLI mode, but the web portal provides a much better experience.

**Q: What is Groq API and do I need it?**
A: Groq API powers the AI chat features. It's optional - the bot works without it, but you won't have AI conversation features. Get a free API key at [console.groq.com](https://console.groq.com).

**Q: Can I use a different AI provider instead of Groq?**
A: The current version uses Groq. You can modify the code to use other providers like OpenAI, Anthropic, or local models.

### Token Capture Questions

**Q: I can't see any requests in my proxy tool. What's wrong?**
A: Common issues:
- SSL proxying not enabled for `live.yellotalk.co`
- Certificate not installed or trusted on device
- Device proxy settings incorrect
- Both devices not on same network
- VPN interfering with proxy

**Q: The requests are encrypted/unreadable. How do I fix this?**
A: Enable SSL proxying for the `live.yellotalk.co` domain in your proxy tool settings.

**Q: Can I capture the token from a web browser instead of mobile app?**
A: YelloTalk is primarily a mobile app. If there's a web version, the same proxy method would work, but it's easier to use the mobile app.

**Q: Do I need to root/jailbreak my device?**
A: No! Proxyman, Charles, and mitmproxy work without root/jailbreak by using proxy certificates.

### Bot Operation Questions

**Q: What is "Auto-Hijack Mode"?**
A: It's a feature that allows the bot to join rooms as the owner, giving full control over speaker slots. This uses the `create_room` exploit and is a beta feature.

**Q: Can the bot speak (use voice)?**
A: No, this bot only handles text chat and room management. It cannot use voice features.

**Q: How do I make the bot join a specific room?**
A: Use the web portal to select a room from the list, or enable "Follow Mode" to auto-join rooms created by a specific user.

**Q: Can I schedule messages or automate actions?**
A: The current version doesn't have built-in scheduling. You can modify the code to add this feature.

**Q: The bot isn't responding to commands. Why?**
A: Check:
- Bot is running and connected
- Keywords are correctly configured in `greetings.json`
- Bot has permission to send messages in the room
- Check console logs for errors

### Technical Questions

**Q: What ports does the bot use?**
A: 
- Bot server: `5353` (WebSocket communication)
- Web portal: `3000` (Next.js dev server)
- YelloTalk: Connects to `wss://live.yellotalk.co:8443`

**Q: Can I deploy this to a server?**
A: Yes! You can deploy to any Node.js hosting platform. Build the web portal with `npm run build` and use a process manager like PM2 for the bot server.

**Q: How do I update the bot?**
A: Pull the latest changes from the repository and run `npm install` in both root and `web-portal` directories.

**Q: Can I contribute to this project?**
A: Yes! See the Contributing section below.

### Troubleshooting Questions

**Q: Bot connects but doesn't receive messages. Why?**
A: 
- Ensure WebSocket connection is established (check console logs)
- Verify you're in the correct room
- Check if the room has message restrictions

**Q: "ECONNREFUSED" error when starting bot. What does this mean?**
A: The bot server isn't running. Start it with `node bot-server.js` before opening the web portal.

**Q: Web portal shows "Failed to fetch" errors. How to fix?**
A: 
- Ensure bot server is running on port 5353
- Check firewall isn't blocking the connection
- Verify `http://localhost:5353` is accessible

**Q: Can I change the bot's display name or avatar?**
A: Yes, modify `pin_name` and `avatar_id` in `config.json`. Changes take effect after restarting the bot.

## API Endpoints Reference

The bot uses these YelloTalk API endpoints:

- `GET /v1/rooms/popular` - Fetch popular rooms
- `GET /v1/rooms/:roomId` - Get room details
- `POST /v1/rooms/:roomId/join` - Join a room
- `POST /v1/rooms/:roomId/leave` - Leave a room
- `POST /v1/rooms/:roomId/messages` - Send a message
- `POST /v1/rooms/:roomId/kick` - Kick a user
- `POST /v1/rooms/:roomId/speakers/:speakerId/lock` - Lock speaker slot
- `POST /v1/rooms/:roomId/speakers/:speakerId/unlock` - Unlock speaker slot
- `POST /v1/rooms/:roomId/speakers/:speakerId/mute` - Mute speaker
- `POST /v1/rooms/:roomId/speakers/:speakerId/kick` - Kick speaker
- `WebSocket: wss://live.yellotalk.co:8443/socket.io/` - Real-time events

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is for educational purposes only. Use at your own risk.

## Disclaimer

This bot is an unofficial third-party tool and is not affiliated with, endorsed by, or connected to YelloTalk. Use of this bot may violate YelloTalk's Terms of Service. The developers are not responsible for any consequences resulting from the use of this software.

## Support & Contact

For questions, issues, or support:

- **Instagram**: [@pywtart](https://instagram.com/pywtart)
- **GitHub Issues**: [Create an issue](../../issues)

---

**Ready to use!** Start with `node bot-server.js` and open the web portal at http://localhost:3000/control
