# Quick Reference Card

## 🚀 Quick Start Commands

```bash
# Install dependencies
npm install && cd web-portal && npm install && cd ..

# Copy config files
cp config.example.json config.json
cp greetings.example.json greetings.json

# Edit config.json with your JWT token and UUID

# Start bot server (Terminal 1)
node bot-server.js

# Start web portal (Terminal 2)
cd web-portal && npm run dev

# Open browser
open http://localhost:3000/control
```

## 🔑 Getting JWT Token

### macOS Users
1. Download [Proxyman](https://proxyman.io)
2. Install certificate: `Certificate` → `Install Certificate on this Mac`
3. Enable SSL: `Certificate` → `SSL Proxying List` → Add `live.yellotalk.co`
4. Configure iOS device proxy → Your Mac IP, port `9090`
5. Open YelloTalk → Find request in Proxyman → Copy `Authorization` header

### Windows/Linux Users
1. Download [Charles Proxy](https://charlesproxy.com)
2. Install certificate: `Help` → `SSL Proxying` → `Install Charles Root Certificate`
3. Enable SSL: `Proxy` → `SSL Proxying Settings` → Add `live.yellotalk.co:443`
4. Configure device proxy → Your PC IP, port `8888`
5. Open YelloTalk → Find request in Charles → Copy `Authorization` header

### Command-Line Users
```bash
# Install mitmproxy
brew install mitmproxy  # macOS
pip install mitmproxy   # Windows/Linux

# Start web interface
mitmweb

# Configure device proxy → Your PC IP, port 8080
# Visit mitm.it on device to install certificate
# Open YelloTalk → View requests at http://127.0.0.1:8081
```

## 📋 Configuration Template

### config.json
```json
{
  "jwt_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_uuid": "12345678-1234-1234-1234-123456789ABC",
  "pin_name": "Bot Name",
  "avatar_id": 0,
  "websocket_url": "wss://live.yellotalk.co:8443/socket.io/?EIO=4&transport=websocket",
  "api_base_url": "https://live.yellotalk.co",
  "groq_api_keys": ["gsk_..."]
}
```

### greetings.json
```json
{
  "customGreetings": {
    "username": "Hello!",
    "UUID-HERE": {
      "greeting": "Welcome!",
      "name": "Display Name"
    }
  },
  "defaultGreeting": "Hi everyone!",
  "keywords": {
    "listUsers": ["list", "users", "who"]
  }
}
```

## 🔍 Finding Specific Information

### Get UUID from JWT Token
1. Go to [jwt.io](https://jwt.io)
2. Paste JWT token in "Encoded" section
3. Look at "Payload" section → Find `uuid` field

### Test Your Token
```javascript
// test-token.js
const axios = require('axios');
const TOKEN = 'your_token_here';

axios.get('https://live.yellotalk.co/v1/rooms/popular', {
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'User-Agent': 'ios' }
}).then(res => console.log('✅ Valid!'))
  .catch(err => console.log('❌ Invalid:', err.message));
```

## 🌐 Web Portal Features

| Feature | Location | Description |
|---------|----------|-------------|
| **Bot Control** | Main page | Start/stop bot, select room |
| **Follow Mode** | Main page | Auto-join rooms by user |
| **Speaker Control** | Main page | Lock/unlock/mute/kick speakers |
| **Chat** | Main page | View messages, send messages |
| **Participants** | Main page | View users, kick users |
| **Greetings** | `/greetings` | Edit custom greetings |
| **Keywords** | `/keywords` | Edit bot command keywords |

## 🐛 Common Issues

### Bot won't start
```bash
# Check if port 5353 is in use
lsof -i :5353  # macOS/Linux
netstat -ano | findstr :5353  # Windows

# Kill process if needed
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows
```

### Web portal shows "Failed to fetch"
- Ensure bot server is running: `node bot-server.js`
- Check if `http://localhost:5353` is accessible
- Check firewall settings

### Token expired
- Log out of YelloTalk app
- Log back in
- Capture new token using proxy tool

### No requests in proxy tool
- Verify device proxy settings (IP and port)
- Ensure both devices on same Wi-Fi
- Check certificate is installed and trusted
- Enable SSL proxying for `live.yellotalk.co`

## 📡 API Endpoints

```
GET  /v1/rooms/popular           - List popular rooms
GET  /v1/rooms/:id               - Get room details
POST /v1/rooms/:id/join          - Join room
POST /v1/rooms/:id/leave         - Leave room
POST /v1/rooms/:id/messages      - Send message
POST /v1/rooms/:id/kick          - Kick user
POST /v1/rooms/:id/speakers/:id/lock   - Lock speaker
POST /v1/rooms/:id/speakers/:id/unlock - Unlock speaker
POST /v1/rooms/:id/speakers/:id/mute   - Mute speaker
POST /v1/rooms/:id/speakers/:id/kick   - Kick speaker

WebSocket: wss://live.yellotalk.co:8443/socket.io/
```

## 🔐 Security Checklist

- [ ] `config.json` is in `.gitignore`
- [ ] Not using main YelloTalk account for bot
- [ ] JWT token not shared publicly
- [ ] Using separate account for each bot
- [ ] Bot configured with reasonable rate limits
- [ ] Not spamming or harassing users

## 📚 Additional Resources

- **Main README**: [README.md](README.md)
- **Detailed Setup**: [SETUP_GUIDE.md](SETUP_GUIDE.md)
- **JWT Decoder**: [jwt.io](https://jwt.io)
- **Proxyman**: [proxyman.io](https://proxyman.io)
- **Charles**: [charlesproxy.com](https://charlesproxy.com)
- **mitmproxy**: [mitmproxy.org](https://mitmproxy.org)

## 💡 Pro Tips

1. **Use iOS Simulator** with Proxyman for easiest token capture
2. **Keep backup tokens** from multiple accounts
3. **Monitor console logs** for debugging
4. **Use Follow Mode** to auto-join specific users' rooms
5. **Customize greetings** by UUID for reliability
6. **Test with CLI mode** first before using web portal
7. **Use Groq API** for AI features (free tier available)
8. **Check token expiry** regularly and re-capture when needed

## 🆘 Getting Help

1. Check [SETUP_GUIDE.md](SETUP_GUIDE.md) for detailed instructions
2. Review [Troubleshooting](#-common-issues) section above
3. Search [GitHub Issues](../../issues)
4. Create new issue with:
   - OS and device info
   - Error messages
   - Steps already tried
   - Screenshots if relevant

### 📞 Contact

For any problems or questions:
- **Instagram**: [@pywtart](https://instagram.com/pywtart)

---

**Last Updated**: 2026-02-16
