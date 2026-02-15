# Complete Setup Guide - Obtaining JWT Token

This guide provides detailed, step-by-step instructions for capturing your YelloTalk JWT token using various network monitoring tools.

## Table of Contents

- [Understanding JWT Tokens](#understanding-jwt-tokens)
- [Tool Selection Guide](#tool-selection-guide)
- [Method 1: Proxyman (macOS)](#method-1-proxyman-macos---recommended-for-mac-users)
- [Method 2: Charles Proxy (All Platforms)](#method-2-charles-proxy-all-platforms)
- [Method 3: mitmproxy (All Platforms)](#method-3-mitmproxy-all-platforms---command-line)
- [Method 4: Wireshark (Advanced)](#method-4-wireshark-advanced---not-recommended)
- [Verifying Your Token](#verifying-your-token)
- [Common Issues and Solutions](#common-issues-and-solutions)

---

## Understanding JWT Tokens

### What is a JWT Token?

JWT (JSON Web Token) is a secure way to transmit information between parties. YelloTalk uses JWT tokens to authenticate users.

**JWT Structure:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1dWlkIjoiMTIzNDU2NzgiLCJpYXQiOjE3MDAwMDAwMDB9.signature_here
│                                      │                                      │
│         Header (Base64)              │      Payload (Base64)                │  Signature
```

**Decoded Payload Example:**
```json
{
  "uuid": "12345678-1234-1234-1234-123456789ABC",
  "iat": 1700000000
}
```

### Why Do You Need It?

The bot needs your JWT token to:
- Authenticate API requests to YelloTalk servers
- Join rooms and send messages
- Access user-specific features
- Maintain persistent connection via WebSocket

### Security Considerations

⚠️ **Important**: Your JWT token is like a password. Anyone with your token can:
- Access your YelloTalk account
- Send messages as you
- Join/leave rooms as you
- Access your profile information

**Best Practices:**
- Never share your token publicly
- Don't commit `config.json` to version control
- Regenerate token if compromised (log out and log back in)
- Use separate accounts for bots (don't use your main account)

---

## Tool Selection Guide

### Quick Comparison

| Feature | Proxyman | Charles | mitmproxy | Wireshark |
|---------|----------|---------|-----------|-----------|
| **Platform** | macOS only | All | All | All |
| **Interface** | Modern GUI | Classic GUI | CLI/Web | Complex GUI |
| **Ease of Use** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **SSL Decrypt** | Easy | Easy | Moderate | Difficult |
| **Free Version** | Limited | Trial | Yes | Yes |
| **Best For** | Mac users | Professionals | Developers | Network experts |
| **Learning Curve** | 5 min | 15 min | 30 min | 2+ hours |

### Recommendations by Platform

**macOS Users:**
- 🥇 **First Choice**: Proxyman (easiest, most intuitive)
- 🥈 **Alternative**: Charles Proxy (more features)
- 🥉 **Advanced**: mitmproxy (for automation)

**Windows Users:**
- 🥇 **First Choice**: Charles Proxy (best GUI for Windows)
- 🥈 **Alternative**: mitmproxy (free, command-line)

**Linux Users:**
- 🥇 **First Choice**: mitmproxy (native support)
- 🥈 **Alternative**: Charles Proxy (if you prefer GUI)

---

## Method 1: Proxyman (macOS) - Recommended for Mac Users

### Overview

Proxyman is a modern, native macOS app with the best user experience for HTTP debugging.

**Pros:**
- Beautiful, intuitive interface
- Automatic iOS Simulator configuration
- Easy SSL certificate installation
- Real-time filtering and search
- Free for basic features

**Cons:**
- macOS only
- Some features require paid license

### Step-by-Step Guide

#### 1. Download and Install

1. Visit [proxyman.io](https://proxyman.io)
2. Download the latest version
3. Open the DMG file and drag Proxyman to Applications
4. Launch Proxyman from Applications folder
5. Grant necessary permissions when prompted

#### 2. Install Root Certificate on Mac

1. In Proxyman, click the **Certificate** menu
2. Select **Install Certificate on this Mac**
3. Enter your Mac password when prompted
4. The certificate is now trusted on your Mac

#### 3. Setup for iOS Device

**Option A: iOS Simulator (Easiest)**

1. Click **Certificate** menu
2. Select **Install Certificate on iOS** → **Simulator**
3. Choose your simulator from the list
4. Certificate is automatically installed

**Option B: Physical iOS Device**

1. Ensure your iPhone/iPad is on the same Wi-Fi network as your Mac
2. Click **Certificate** menu
3. Select **Install Certificate on iOS** → **Physical Devices**
4. Proxyman will display instructions with your Mac's IP address

5. On your iOS device:
   - Open **Settings** → **Wi-Fi**
   - Tap the **(i)** icon next to your network
   - Scroll to **HTTP Proxy** → Select **Manual**
   - Enter:
     - **Server**: Your Mac's IP (shown in Proxyman)
     - **Port**: `9090`
   - Tap **Save**

6. On your iOS device, open Safari and visit: `proxy.man/ssl`
7. Tap **Allow** to download the configuration profile
8. Go to **Settings** → **Profile Downloaded** → **Install**
9. Enter your passcode and tap **Install** again
10. Go to **Settings** → **General** → **About** → **Certificate Trust Settings**
11. Enable trust for **Proxyman CA**

#### 4. Enable SSL Proxying for YelloTalk

1. In Proxyman, click the **Certificate** menu
2. Select **SSL Proxying List**
3. Click the **+** button
4. Enter:
   - **Host**: `live.yellotalk.co`
   - **Port**: `443`
5. Click **Save**

Alternatively:
1. Open YelloTalk app briefly to generate some traffic
2. In Proxyman, find any request to `live.yellotalk.co`
3. Right-click on it
4. Select **Enable SSL Proxying**

#### 5. Capture the JWT Token

1. Ensure Proxyman is running and recording (green dot in menu bar)
2. Open YelloTalk app on your device
3. Log in to your account (or just browse if already logged in)
4. In Proxyman, use the **filter bar** at the top to search: `live.yellotalk.co`
5. Look for API requests, especially:
   - `GET /v1/rooms/popular` ⭐ **Best option**
   - `GET /v1/rooms/{room_id}`
   - `POST /v1/rooms/{room_id}/join`
   - `GET /v1/users/me`

6. Click on any request to view details
7. In the right panel, ensure you're on the **Request** tab
8. Scroll down to the **Headers** section
9. Find the **Authorization** header:
   ```
   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1dWlkIjoiWU9VUi1VVUlEIiwiaWF0IjoxNzAwMDAwMDAwfQ.signature
   ```
10. **Right-click** on the header value
11. Select **Copy Value**
12. Paste into a text editor
13. Remove `Bearer ` prefix if present
14. Copy the JWT token (starting with `eyJ`)

#### 6. Extract UUID

**Method 1: From Proxyman Response**
1. In the same request, click the **Response** tab
2. Look at the JSON response body
3. Find the `uuid` field
4. Copy the UUID (format: `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`)

**Method 2: Decode JWT**
1. Visit [jwt.io](https://jwt.io)
2. Paste your JWT token in the **Encoded** section
3. Look at the **Payload** section (right side, pink)
4. Find and copy the `uuid` value

#### 7. Cleanup (Optional)

When done capturing:
1. On your iOS device, go to **Settings** → **Wi-Fi**
2. Tap **(i)** next to your network
3. **HTTP Proxy** → Select **Off**

---

## Method 2: Charles Proxy (All Platforms)

### Overview

Charles is a mature, cross-platform HTTP debugging proxy with extensive features.

**Pros:**
- Works on macOS, Windows, and Linux
- Professional-grade features
- Excellent documentation
- Widely used in industry

**Cons:**
- Paid software (free trial available)
- Slightly older interface
- Requires more setup than Proxyman

### Step-by-Step Guide

#### 1. Download and Install

1. Visit [charlesproxy.com](https://www.charlesproxy.com)
2. Download for your platform (macOS, Windows, or Linux)
3. Install and launch Charles Proxy
4. Grant necessary permissions when prompted

#### 2. Install Root Certificate on Computer

**macOS:**
1. Go to **Help** → **SSL Proxying** → **Install Charles Root Certificate**
2. The certificate opens in Keychain Access
3. Find **Charles Proxy CA** in the list
4. Double-click it
5. Expand **Trust** section
6. Set **When using this certificate** to **Always Trust**
7. Close the window and enter your password

**Windows:**
1. Go to **Help** → **SSL Proxying** → **Install Charles Root Certificate**
2. Click **Yes** to install
3. Certificate is automatically trusted

**Linux:**
1. Go to **Help** → **SSL Proxying** → **Install Charles Root Certificate**
2. Follow distribution-specific instructions to trust the certificate

#### 3. Install Certificate on Mobile Device

1. Go to **Help** → **SSL Proxying** → **Install Charles Root Certificate on a Mobile Device**
2. Charles displays instructions with your computer's IP address
3. Note the IP address and port (default: `8888`)

**On iOS Device:**
1. Open **Settings** → **Wi-Fi**
2. Tap **(i)** next to your network
3. Scroll to **HTTP Proxy** → Select **Manual**
4. Enter:
   - **Server**: Your computer's IP (from Charles)
   - **Port**: `8888`
5. Tap **Save**
6. Open Safari and visit: `chls.pro/ssl`
7. Tap **Allow** to download the profile
8. Go to **Settings** → **Profile Downloaded** → **Install**
9. Enter passcode and install
10. Go to **Settings** → **General** → **About** → **Certificate Trust Settings**
11. Enable trust for **Charles Proxy CA**

**On Android Device:**
1. Open **Settings** → **Wi-Fi**
2. Long-press your network → **Modify Network**
3. Tap **Advanced Options**
4. **Proxy** → Select **Manual**
5. Enter:
   - **Proxy hostname**: Your computer's IP
   - **Proxy port**: `8888`
6. Tap **Save**
7. Open browser and visit: `chls.pro/ssl`
8. Download and install the certificate
9. Go to **Settings** → **Security** → **Install from storage**
10. Find and install the Charles certificate

#### 4. Enable SSL Proxying

1. In Charles, go to **Proxy** → **SSL Proxying Settings**
2. Check **Enable SSL Proxying**
3. Click **Add** under the **Include** section
4. Enter:
   - **Host**: `live.yellotalk.co`
   - **Port**: `443`
5. Click **OK** to save

#### 5. Start Recording

1. Ensure recording is active: **Proxy** → **Start Recording**
2. Or press **Cmd+R** (Mac) / **Ctrl+R** (Windows)
3. The record button should be red

#### 6. Capture the JWT Token

1. Open YelloTalk app on your device
2. Log in or browse the app
3. In Charles, look at the **Structure** view (left panel)
4. Find and expand **live.yellotalk.co**
5. Look for API endpoints:
   - `/v1/rooms/popular` ⭐
   - `/v1/rooms/`
   - `/v1/users/`
6. Click on a request
7. In the right panel, select the **Request** tab
8. Click the **Headers** sub-tab
9. Find the **Authorization** header
10. Right-click and select **Copy Value**
11. Paste into a text editor
12. Remove `Bearer ` prefix
13. Copy the JWT token

#### 7. Extract UUID

Same as Proxyman method:
- Check the **Response** tab in Charles, or
- Decode the JWT at [jwt.io](https://jwt.io)

#### 8. Cleanup

Remove proxy settings from your device when done.

---

## Method 3: mitmproxy (All Platforms) - Command Line

### Overview

mitmproxy is a free, open-source, command-line HTTP proxy with web interface option.

**Pros:**
- Completely free and open-source
- Works on all platforms
- Scriptable and automatable
- Web interface available (`mitmweb`)
- No trial limitations

**Cons:**
- Command-line interface (may be intimidating)
- Steeper learning curve
- Less polished than GUI tools

### Step-by-Step Guide

#### 1. Install mitmproxy

**macOS (using Homebrew):**
```bash
brew install mitmproxy
```

**Linux (using pip):**
```bash
# Install pip if not already installed
sudo apt-get install python3-pip  # Debian/Ubuntu
sudo yum install python3-pip      # CentOS/RHEL

# Install mitmproxy
pip3 install mitmproxy
```

**Windows (using pip):**
```bash
# Install Python from python.org if not installed
pip install mitmproxy
```

**Using pipx (recommended for isolated installation):**
```bash
# Install pipx
python3 -m pip install --user pipx
python3 -m pipx ensurepath

# Install mitmproxy
pipx install mitmproxy
```

#### 2. Start mitmproxy

Choose one of these modes:

**Option A: Interactive Terminal UI (mitmproxy)**
```bash
mitmproxy
```
- Full-featured terminal interface
- Keyboard-driven navigation
- Real-time request inspection

**Option B: Web Interface (mitmweb) - Recommended for Beginners**
```bash
mitmweb
```
- Opens web interface at `http://127.0.0.1:8081`
- GUI in your browser
- Easier to use than terminal

**Option C: Dump Mode (mitmdump)**
```bash
mitmdump -w traffic.log
```
- Logs all traffic to a file
- Can be analyzed later
- No interactive interface

#### 3. Install Certificate on Device

**First, configure proxy on your device:**

**iOS:**
1. Settings → Wi-Fi → Tap (i) → HTTP Proxy → Manual
2. Server: Your computer's IP address
3. Port: `8080`

**Android:**
1. Settings → Wi-Fi → Long-press network → Modify Network
2. Advanced → Proxy → Manual
3. Hostname: Your computer's IP
4. Port: `8080`

**Then, install certificate:**

1. On your mobile device, open a browser
2. Visit: `mitm.it`
3. You'll see the mitmproxy certificate installation page
4. Select your platform:
   - **iOS**: Tap "Get mitmproxy-ca-cert.pem"
   - **Android**: Tap "Get mitmproxy-ca-cert.pem"

**iOS Certificate Installation:**
1. Tap **Allow** to download profile
2. Go to **Settings** → **Profile Downloaded**
3. Tap **Install** (enter passcode if prompted)
4. Tap **Install** again to confirm
5. Go to **Settings** → **General** → **About** → **Certificate Trust Settings**
6. Enable **mitmproxy**

**Android Certificate Installation:**
1. Download the certificate
2. Go to **Settings** → **Security** → **Install from storage**
3. Find and select the mitmproxy certificate
4. Name it "mitmproxy" and tap **OK**

#### 4. Capture the JWT Token

**Using mitmweb (Web Interface):**

1. Start mitmweb:
   ```bash
   mitmweb
   ```
2. Open browser and go to: `http://127.0.0.1:8081`
3. Open YelloTalk app on your device and log in
4. In the web interface, use the **filter box** to search: `yellotalk`
5. Click on a request to `live.yellotalk.co`
6. Look for endpoints like `/v1/rooms/popular`
7. Click on the request to view details
8. In the **Request** tab, find the **Headers** section
9. Look for the **Authorization** header
10. Copy the value (remove `Bearer ` prefix)

**Using mitmproxy (Terminal):**

1. Start mitmproxy:
   ```bash
   mitmproxy
   ```
2. Open YelloTalk app on your device and log in
3. In the terminal, you'll see requests flowing
4. Press `/` to search
5. Type `yellotalk` and press **Enter**
6. Use **arrow keys** to navigate to a request to `live.yellotalk.co`
7. Press **Enter** to view request details
8. Press **Tab** to switch between Request/Response
9. Look for the **Authorization** header
10. Note down the JWT token (you can't copy directly from terminal)
11. Or press **e** to export the flow and view in a text editor

**Keyboard Shortcuts in mitmproxy:**
- `/` - Search/filter
- `Enter` - View request details
- `Tab` - Switch between Request/Response
- `q` - Go back
- `e` - Export flow
- `?` - Help

#### 5. Extract UUID

Same as previous methods:
- Check the response in mitmproxy/mitmweb, or
- Decode JWT at [jwt.io](https://jwt.io)

#### 6. Stop mitmproxy

- In mitmproxy terminal: Press `q` then `y` to quit
- In mitmweb: Press `Ctrl+C` in terminal
- Remove proxy settings from your device

---

## Method 4: Wireshark (Advanced) - Not Recommended

### Why Wireshark is Not Ideal

**Challenges:**
- Cannot easily decrypt HTTPS traffic from mobile apps
- Requires SSL key logging setup (complex)
- May need rooted/jailbroken device
- Steep learning curve
- Overkill for this task

**When to Use Wireshark:**
- You're already familiar with it
- You need deep packet analysis
- You're debugging network issues beyond HTTP

### Alternative Approach

Instead of using Wireshark directly:
1. Use Proxyman, Charles, or mitmproxy to decrypt traffic
2. If needed, export decrypted traffic from those tools
3. Import into Wireshark for advanced analysis

### If You Still Want to Use Wireshark

**Requirements:**
- Rooted Android device or jailbroken iOS device, OR
- Setup SSL key logging on the device, OR
- Use Wireshark in combination with a proxy tool

**Basic Steps:**
1. Install Wireshark from [wireshark.org](https://www.wireshark.org)
2. Setup SSL key logging (beyond scope of this guide)
3. Start packet capture on your network interface
4. Filter for `http.host contains "yellotalk"`
5. Find HTTP requests and look for Authorization headers

**Recommendation:** Use one of the other methods instead.

---

## Verifying Your Token

### Check Token Format

A valid JWT token has three parts separated by dots:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1dWlkIjoiMTIzNDU2NzgiLCJpYXQiOjE3MDAwMDAwMDB9.signature_here
│                                      │                                      │
│         Header (Base64)              │      Payload (Base64)                │  Signature
```

**Validation Checklist:**
- ✅ Starts with `eyJ`
- ✅ Contains exactly two dots (`.`)
- ✅ Three distinct parts (header.payload.signature)
- ✅ No spaces or line breaks
- ✅ Only contains: `A-Z`, `a-z`, `0-9`, `-`, `_`, `.`

### Decode and Verify

1. Go to [jwt.io](https://jwt.io)
2. Paste your token in the **Encoded** section
3. Check the **Payload** section (decoded)
4. Verify it contains:
   - `uuid`: Your user UUID
   - `iat`: Issued at timestamp

**Example Decoded Payload:**
```json
{
  "uuid": "12345678-1234-1234-1234-123456789ABC",
  "iat": 1700000000
}
```

### Test the Token

Create a simple test file `test-token.js`:

```javascript
const axios = require('axios');

const TOKEN = 'your_jwt_token_here';
const API_URL = 'https://live.yellotalk.co';

async function testToken() {
    try {
        const response = await axios.get(`${API_URL}/v1/rooms/popular`, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'User-Agent': 'ios'
            }
        });
        console.log('✅ Token is valid!');
        console.log('Response:', response.data);
    } catch (error) {
        console.log('❌ Token is invalid or expired');
        console.log('Error:', error.message);
    }
}

testToken();
```

Run the test:
```bash
node test-token.js
```

---

## Common Issues and Solutions

### Issue 1: No Requests Showing in Proxy Tool

**Symptoms:**
- Proxy tool is running but shows no traffic
- YelloTalk app seems to work normally
- No requests to `live.yellotalk.co` appear

**Solutions:**

1. **Check Proxy Configuration:**
   - Verify device proxy settings are correct
   - Ensure IP address matches your computer's IP
   - Verify port number is correct (9090 for Proxyman, 8888 for Charles, 8080 for mitmproxy)
   - Both devices must be on the same Wi-Fi network

2. **Verify Network Connection:**
   ```bash
   # On Mac/Linux, find your IP:
   ifconfig | grep "inet "
   
   # On Windows:
   ipconfig
   ```
   - Use the IP from your Wi-Fi interface (usually starts with 192.168.x.x or 10.0.x.x)

3. **Check Firewall:**
   - Temporarily disable firewall on your computer
   - Or add exception for the proxy tool
   - macOS: System Preferences → Security & Privacy → Firewall
   - Windows: Control Panel → Windows Defender Firewall

4. **Restart Everything:**
   - Close proxy tool
   - Remove proxy from device
   - Restart proxy tool
   - Reconfigure proxy on device
   - Restart YelloTalk app

### Issue 2: Requests Are Encrypted/Unreadable

**Symptoms:**
- Requests appear but content shows as encrypted
- Headers are not readable
- Response body shows binary data

**Solutions:**

1. **Enable SSL Proxying:**
   - Proxyman: Certificate → SSL Proxying List → Add `live.yellotalk.co`
   - Charles: Proxy → SSL Proxying Settings → Add `live.yellotalk.co:443`
   - mitmproxy: SSL proxying is enabled by default

2. **Verify Certificate Installation:**
   - Check certificate is installed on device
   - iOS: Settings → General → VPN & Device Management
   - Android: Settings → Security → Trusted Credentials

3. **Enable Certificate Trust (iOS):**
   - Settings → General → About → Certificate Trust Settings
   - Enable the proxy certificate

4. **Restart After Certificate Installation:**
   - Restart your device after installing certificate
   - Restart the YelloTalk app

### Issue 3: Certificate Installation Fails

**Symptoms:**
- Cannot download certificate on device
- Certificate profile won't install
- Trust settings don't show the certificate

**Solutions:**

1. **For iOS:**
   - Ensure you're using Safari browser (not Chrome)
   - Check if device has restrictions: Settings → Screen Time → Content & Privacy Restrictions
   - Try downloading certificate again
   - Restart device and try again

2. **For Android:**
   - Ensure "Install from storage" is allowed
   - Some devices require setting a screen lock first
   - Try using a different browser
   - Check if device is in work profile mode

3. **Alternative Certificate Installation:**
   - Export certificate from proxy tool to a file
   - Email certificate to yourself
   - Open email on device and install from there

### Issue 4: Token Appears Invalid or Expired

**Symptoms:**
- Token format looks correct
- But API requests fail with 401 Unauthorized
- Bot cannot connect

**Solutions:**

1. **Re-capture the Token:**
   - Tokens expire after some time (days/weeks)
   - Log out of YelloTalk app
   - Log back in
   - Capture a fresh token

2. **Verify Token Format:**
   - Should start with `eyJ`
   - Should have exactly two dots
   - No spaces or line breaks
   - No `Bearer ` prefix in config.json

3. **Check for Copy/Paste Errors:**
   - Ensure entire token was copied
   - Check for extra spaces at beginning/end
   - Verify no line breaks in the middle

4. **Test Token:**
   - Use the test script above
   - Or decode at jwt.io to verify structure

### Issue 5: UUID Not Found

**Symptoms:**
- Have JWT token but can't find UUID
- Decoded JWT doesn't show UUID
- Response doesn't contain user info

**Solutions:**

1. **Decode JWT Properly:**
   - Go to [jwt.io](https://jwt.io)
   - Paste entire token in "Encoded" section
   - Look at "Payload" section (right side, pink)
   - UUID should be there

2. **Check Different Endpoints:**
   - Try `/v1/users/me` endpoint
   - Try `/v1/rooms/popular` endpoint
   - Look in response body for user information

3. **UUID Format:**
   - Should be: `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`
   - Usually uppercase letters and numbers
   - Contains hyphens in specific positions

4. **Alternative Method:**
   - Look at any API response in proxy tool
   - Search for "uuid" in the response
   - Your user UUID should appear somewhere

### Issue 6: App Detects Proxy/Certificate

**Symptoms:**
- YelloTalk app refuses to work with proxy
- Shows security warning
- Cannot connect to server

**Solutions:**

1. **Certificate Pinning:**
   - Some apps use certificate pinning
   - This prevents proxy tools from working
   - May require advanced techniques (beyond scope)

2. **Try Different Proxy Tool:**
   - If one tool doesn't work, try another
   - Some tools have better SSL handling

3. **Use Older App Version:**
   - Older versions may not have certificate pinning
   - Download from APK sites (Android) or IPA sites (iOS)
   - ⚠️ Security risk - only if necessary

4. **Alternative Approach:**
   - Use an emulator/simulator
   - Emulators are often easier to intercept
   - iOS Simulator with Proxyman is very easy

---

## Next Steps

Once you have your JWT token and UUID:

1. Copy `config.example.json` to `config.json`
2. Paste your JWT token and UUID
3. Configure other settings as needed
4. Start the bot with `node bot-server.js`
5. Open web portal at `http://localhost:3000/control`

For more information, see the main [README.md](README.md).

---

## Additional Resources

### Official Documentation

- [Proxyman Documentation](https://docs.proxyman.io)
- [Charles Proxy Documentation](https://www.charlesproxy.com/documentation/)
- [mitmproxy Documentation](https://docs.mitmproxy.org)
- [JWT.io](https://jwt.io) - JWT decoder and validator

### Video Tutorials

Search YouTube for:
- "Proxyman iOS tutorial"
- "Charles Proxy mobile setup"
- "mitmproxy tutorial"
- "HTTP proxy certificate installation iOS/Android"

### Community Support

If you're still having issues:
1. Check the [Issues](../../issues) page on GitHub
2. Search for similar problems
3. Create a new issue with:
   - Your operating system
   - Proxy tool you're using
   - Device type (iOS/Android)
   - Error messages or screenshots
   - Steps you've already tried

### Direct Support

For direct assistance, contact:
- **Instagram**: [@pywtart](https://instagram.com/pywtart)

---

## Security and Legal Disclaimer

⚠️ **Important Notices:**

1. **Use Responsibly:**
   - Only capture traffic from your own devices
   - Don't intercept others' traffic without permission
   - Follow local laws regarding network monitoring

2. **Account Security:**
   - Use a separate account for bots (not your main account)
   - Don't share your JWT token with anyone
   - Regenerate token if compromised

3. **Terms of Service:**
   - Using bots may violate YelloTalk's Terms of Service
   - Your account could be banned
   - Use at your own risk

4. **Educational Purpose:**
   - This guide is for educational purposes
   - Demonstrates HTTP debugging techniques
   - Shows how mobile apps communicate with servers

---

**Good luck with your setup!** If you follow this guide carefully, you should be able to capture your JWT token successfully. Remember to be patient and methodical - most issues can be solved by carefully following each step.
