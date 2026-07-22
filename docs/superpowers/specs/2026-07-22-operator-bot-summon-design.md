# Operator Bot & Summon System — Design

## Goal
Replace random room-joining with an **opt-in summon** system so the bot only enters rooms
that ask for it. No monitoring of uninvited rooms.

## Pieces

### 1. Operator bot (a dedicated, always-on host)
- One configured bot is designated the **operator** (`config.operatorBotId`). It is **excluded
  from the summonable pool** — it never gets dispatched elsewhere.
- The operator **opens and holds a room** (via `POST /v1/rooms`). If that room ends, it
  **reopens a new one** automatically.
- In its room it posts **instructions**:
  - Name your room with `@bot` in the title → a bot auto-joins (if one is available).
  - Or type `@bot` here → guided picker to send a bot to a room you choose.

### 2. Two summon paths
- **Topic summon:** poll the public room list (`/v1/rooms/popular`, already used) every ~15s.
  Any room whose **topic contains `@bot`**, that has **no bot already** and isn't private,
  gets an available bot dispatched. Attribution: "summoned by room name".
- **Chat summon (guided):** a user types `@bot` in the operator room →
  1. check availability (are any non-operator bots free?),
  2. fetch all current rooms + status (skip rooms that already have a bot, skip operator room, skip private),
  3. reply with a **numbered list** of joinable rooms and ask the user to pick,
  4. on pick, dispatch an available bot; attribution: "summoned by <username>".

### 3. Per-user sessions (not per-chat)
- Summon state is keyed by **user uuid** (`sessions: Map<uuid, {step, rooms, ts}>`), so two users
  running the picker at once never collide. Sessions expire after 2 min.

### 4. Availability rules
- A bot is **available** if it is not currently in a room (status not running/starting/waiting).
- The **operator is never in the availability list**.
- If nothing is free, the picker replies "no bots available right now".

### 5. Attribution on join
- When a summoned bot joins a room it posts who summoned it:
  chat → "🤖 ถูกเรียกโดย <user>", topic → "🤖 เข้าตามชื่อห้อง".

## Integration
- New isolated module `operator-bot.js` (factory taking injected deps: axios/https/socketClient,
  api base, `getSummonableBots()`, `dispatchBot()`, `io`, config accessors).
- `bot-server.js` wires it: provides availability from `botInstances`, dispatch via the existing
  `/api/bot/start`, and posts attribution in the join handler. New endpoints:
  `POST /api/operator/start|stop`, `GET /api/operator/status`, `POST /api/operator/select`.
- Portal: a selector to choose the operator bot + start/stop.

## Constraints / notes
- Needs ≥2 bot accounts (1 operator + ≥1 summonable). Now have 5.
- Room creation body: `{category_id:0, is_private:false, limit_speaker, topic}`.
- Rooms stay open only while the owner socket is connected → operator keeps its socket alive and
  reopens on `live_end`/disconnect.
