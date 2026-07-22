# YelloTalk Music Bot 🎵🤖

Bots that join **YelloTalk** voice rooms and play music on request — driven by room chat (`@bot play …`) or a web console. Voice via Tencent **GME**, audio via **yt-dlp**, chat via **groq** AI.

> **🐧 This branch (`ubuntu-version`)** runs on a cheap Linux server using the native GME **Android** SDK inside **Redroid** (Android-in-Docker), since no native Linux GME SDK exists. Bundles Cloudflare **WARP** (beats YouTube's datacenter bot-check), a US **groq relay** (bypasses HK geo-blocking), and up to **5 concurrent bots**.
> **macOS-native version → [`main`](../../tree/main) branch.**

## Features

- 🎵 **Music** — YouTube search & play, per-bot queue, or **paste a YouTube playlist/album link** to enqueue it all
- 🔊 **Volume** — native GME 0–200 scale (100 = original), per bot
- 💬 **AI chat** — groq replies with per-user memory & custom greetings (Thai + English)
- 🎙️ **Voice** — join/leave speaker slots, HIGH-QUALITY music codec
- 🖥️ **Web console** — realtime 3D fleet map (`/`) + classic control panel (`/control`)
- 🤖 **Multi-bot** — up to 5 independent bots in different rooms at once

## Architecture

```
Web console ──► bot-server ──► per-bot adapter ──adb──► Android app ──► GME SDK ──► voice room
 :5252          :5353          gme-redroid-bot          com.gmebot.botN
 Next.js        Node
```

- **Music:** `bot-server` runs **yt-dlp** (through a WARP proxy) → `m4a` → adb-push → GME `StartAccompany`.
- **AI:** `bot-server` calls **groq** through a US relay.
- Each bot drives its **own** app copy (`com.gmebot.bot0…4`) = an independent GME client, so bots play different songs in different rooms simultaneously.

## Quick start (Ubuntu server)

**Prereqs:** Docker (+ `binderfs` for Redroid), Node 18+, adb, yt-dlp, ffmpeg.

1. **Configure** — copy `config.example.json` → `config.json`; fill each bot's `jwt_token` + `user_uuid` and your `groq_api_keys`.
2. **Run:**
   ```bash
   bash start-redroid.sh            # one command: container, WARP, 5 apps, portal, bot-server
   bash start-redroid.sh --rebuild  # after portal/app changes
   ```
3. **Open** `http://<server-ip>:5252` (open ports **5252** + **5353** in the firewall).

> Local / macOS dev: `bash start.sh`.

**Getting a JWT + UUID:** each bot is a real YelloTalk account. Log into the app through any HTTPS proxy (Proxyman / Charles / mitmproxy) and grab the `Authorization: Bearer …` token and your `uuid`. See `SETUP_GUIDE.md` for the step-by-step.

## Using the bot (in room chat)

@mention a bot by name, then:

| Say | Does |
|---|---|
| `@bot play <song>` | search YouTube & play now |
| `@bot <youtube playlist link>` | enqueue the whole playlist / album |
| `@bot add <song>` | add to the queue |
| `@bot skip` · `next` | next song |
| `@bot รายการเพลง` · `queue?` | show the queue |
| `@bot volume 120` | set volume (0–200, 100 = original) |
| `@bot louder` · `quieter` | nudge ±40 |
| `@bot pause` · `resume` · `stop` | playback control |
| `@bot ขึ้นหลุม` · `ลงหลุม` | join / leave a speaker slot |
| `@bot call me <name>` | set your custom greeting |

Understands Thai + English. **Spotify links** are recognised but **off by default** (see Configuration).

## Configuration

- **`config.json`** (gitignored — holds your secrets): `groq_api_keys[]` and a `bots[]` array of `{ id, name, jwt_token, user_uuid, avatar_id }`.
- **`greetings.json`**: per-user greetings (also settable in-chat via *call me X*).
- **Env toggles:** `INSTANCES` (bot count, default 5) · `MUSIC_FORMAT` (`m4a`\|`mp3`) · `MAX_SONG_SECONDS` (3600) · `MAX_CACHE_MB` (1500) · `MAX_PLAYLIST_ITEMS` (50).
- **Spotify** (optional): add `spotify_client_id` / `spotify_client_secret` (a free Spotify app, Client-Credentials) to `config.json` — links then resolve via Spotify metadata → YouTube. Absent = disabled.

## How the tricky parts work

- **Redroid** — GME's SDK is Android-only, so bots run inside `redroid/redroid` (Android-in-Docker). adb is bound to **127.0.0.1** only (public adb → worm malware).
- **YouTube bot-check** — datacenter IPs get "confirm you're not a bot", so yt-dlp egresses through a local Cloudflare **WARP** SOCKS proxy, leaving the box's default route (the GME/China path) untouched.
- **groq geo-block** — groq 403s Hong-Kong IPs, so requests route through a tiny **US Vercel relay** (`groq-relay/`, via `GROQ_BASE_URL`).
- **Audio** — grabs AAC (`m4a`) directly, no re-encode (~5s); the room runs GME's HIGH-QUALITY music codec.

## Project layout

```
bot-server.js      control server (:5353) — bots, chat, AI, music, REST/socket API
web-portal/        Next.js console (:5252) — 3D fleet map (/) + control panel (/control)
gme-redroid-bot/   per-bot adapter: adb push + drives the Android app
gme-music-bot/     native GME music bot (macOS .mm / Linux .cpp)
gme-*-sdk/         GME SDKs (mac / Unity / Linux headers)
groq-relay/        US Vercel relay for groq
operator-bot.js    opt-in @bot summon system
start-redroid.sh   one-command Ubuntu launcher    ·    start.sh   local / macOS
```

More detail: `SETUP_GUIDE.md` · `QUICK_REFERENCE.md`.

## Security & disclaimer

adb is localhost-only; `config.json` / `greetings.json` (tokens, keys) are gitignored — never commit them. Bots act on real YelloTalk accounts: use accounts you own and don't disturb rooms you're not welcome in. Personal/educational project, unaffiliated with YelloTalk or Tencent GME. Use at your own risk.
