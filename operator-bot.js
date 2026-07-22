'use strict';
/**
 * operator-bot.js — Operator / Summon system (isolated module)
 *
 * One dedicated "operator" bot hosts a persistent room that explains how to use the bots,
 * and dispatches summonable bots to rooms on demand. Two summon paths:
 *   - topic summon: any public room whose TOPIC contains the marker (default "@bot") gets a bot
 *   - chat summon: a user types "@bot" in the operator room -> guided, per-user room picker
 *
 * The module is self-contained (its own socket + REST). bot-server.js injects:
 *   deps.getOperatorConfig()  -> { jwt_token, user_uuid, name, avatar_id, roomId? }
 *   deps.getSummonableBots()  -> [{ id, name, available, currentRoomId }]  (operator excluded)
 *   deps.dispatchBot(botId, roomId, summonInfo) -> Promise   (joins bot to room; records attribution)
 *   deps.io (optional socket.io server for portal events), deps.log
 */

const DEFAULTS = {
  marker: '@bot',
  apiBase: 'https://live.yellotalk.co',
  wsUrl: 'https://live.yellotalk.co:8443',
  topicPollMs: 15000,
  sessionTtlMs: 120000,
  topicCooldownMs: 90000, // don't re-dispatch the same topic-room within this window
  reopenDelayMs: 4000,
};

const OPERATOR_TOPIC = '🤖 เรียกบอท — พิมพ์ @bot ที่นี่';
const INSTRUCTIONS = [
  '🤖 สวัสดีค่ะ! ห้องนี้คือห้องเรียกบอท',
  '① ตั้งชื่อห้องของคุณให้มี "@bot" แล้วบอทจะเข้าห้องให้อัตโนมัติ (ถ้ามีบอทว่าง)',
  '② หรือพิมพ์ "@bot" ที่นี่ แล้วเลือกห้องที่อยากให้บอทเข้าได้เลยค่ะ',
].join('\n');

module.exports = function createOperator(rawDeps) {
  const deps = rawDeps || {};
  const cfg = Object.assign({}, DEFAULTS, deps.config || {});
  const io = deps.io || null;
  const socketClient = deps.socketClient;
  const axios = deps.axios;
  const https = deps.https;
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });
  const log = deps.log || ((...a) => console.log('[operator]', ...a));

  const marker = (cfg.marker || '@bot').toLowerCase();

  let running = false;
  let op = null;               // { jwt_token, user_uuid, name, avatar_id, roomId? }
  let socket = null;
  let room = null;             // { id, gme_id, topic } current operator room
  let topicTimer = null;
  let reopening = false;
  const sessions = new Map();  // userUuid -> { step, rooms, name, ts }
  const recentTopicDispatch = new Map(); // roomId -> ts (cooldown)
  const recentSummons = [];    // [{ bot, roomTopic, roomId, by, type, ts }] newest first

  function emitEvent(name, payload) { if (io) io.emit(name, payload); }

  const authHeaders = () => ({ headers: { Authorization: `Bearer ${op.jwt_token}`, 'User-Agent': 'ios' }, httpsAgent, timeout: 12000 });

  // ---------- REST helpers ----------
  async function fetchAllRooms() {
    const PAGE = 50; let all = [], offset = 0;
    while (true) {
      const r = await axios.get(`${cfg.apiBase}/v1/rooms/popular?limit=${PAGE}&offset=${offset}`, authHeaders());
      const rooms = r.data.json || [];
      all = all.concat(rooms);
      if (rooms.length < PAGE) break;
      offset += PAGE;
    }
    return all;
  }

  async function tryCreateRoom(topic) {
    // Native create (works only if the account has a provisioned gme_user_id).
    const body = { category_id: 0, is_private: false, limit_speaker: 1, topic };
    const r = await axios.post(`${cfg.apiBase}/v1/rooms`, body, authHeaders());
    return r.data.json || r.data;
  }

  // ---------- operator room lifecycle ----------
  async function establishRoom() {
    // Preferred: a seeded room id in config (owner-created), which the operator adopts + owns.
    if (op.roomId) {
      const rooms = await fetchAllRooms().catch(() => []);
      const found = rooms.find((x) => x.id === op.roomId);
      if (found) { room = { id: found.id, gme_id: found.gme_id, topic: found.topic }; return 'adopted'; }
      log(`⚠️ configured operatorRoomId ${op.roomId} not found among open rooms; will try to create.`);
    }
    // Fallback: try native creation.
    try {
      const created = await tryCreateRoom(OPERATOR_TOPIC);
      if (created && created.id) { room = { id: created.id, gme_id: created.gme_id, topic: created.topic || OPERATOR_TOPIC }; return 'created'; }
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.message;
      log(`❌ native room creation failed (${msg}).`);
      log(`   -> This account has no gme_user_id (can't host). Seed one instead:`);
      log(`   -> create a room in the app, then set "operatorRoomId":"<id>" in config.json.`);
    }
    return null;
  }

  function joinAndOwn() {
    return new Promise((resolve) => {
      const joinData = {
        room: room.id, uuid: op.user_uuid, avatar_id: op.avatar_id || 0,
        gme_id: String(room.gme_id || ''), campus: 'No Group', pin_name: op.name,
        role: 'host', gme_role: 'host', audio_role: 'host',
      };
      socket.emit('join_room', joinData, (jr) => {
        log(`join operator room: result=${jr?.result} ${jr?.description || ''}`);
        // Claim ownership so the room stays alive on our socket (own room => fine).
        socket.emit('create_room', { room: room.id, uuid: op.user_uuid, limit_speaker: 1 }, (cr) => {
          log(`claim ownership: result=${cr?.result} ${cr?.description || ''}`);
          resolve(jr?.result === 200);
        });
      });
    });
  }

  function post(text) {
    if (!socket || !socket.connected || !room) return;
    // Matches bot-server's sendMessageForBot: server routes by the socket's joined room.
    socket.emit('new_message', { message: text });
    emitEvent('operator-message', { from: op.name, text, self: true, ts: Date.now() });
  }

  async function openOperatorRoom() {
    const how = await establishRoom();
    if (!how) { emitStatus(); return false; }
    log(`operator room ${how}: "${room.topic}" (${room.id})`);

    if (socket) { try { socket.removeAllListeners(); socket.disconnect(); } catch {} }
    socket = socketClient(cfg.wsUrl, { auth: { token: op.jwt_token }, transports: ['websocket'], rejectUnauthorized: false, reconnection: false });

    socket.on('connect', async () => {
      await joinAndOwn();
      setTimeout(() => post(INSTRUCTIONS), 1500);
      emitStatus();
    });
    socket.on('new_message', (d) => handleMessage(d).catch((e) => log('handleMessage err:', e.message)));
    socket.on('live_end', () => { log('operator room ended'); scheduleReopen(); });
    socket.on('disconnect', (reason) => { if (running && reason !== 'io client disconnect') scheduleReopen(); });
    return true;
  }

  function scheduleReopen() {
    if (!running || reopening) return;
    reopening = true;
    room = null; emitStatus();
    setTimeout(async () => { reopening = false; if (running) await openOperatorRoom(); }, cfg.reopenDelayMs);
  }

  // ---------- summon logic ----------
  function sweepSessions() {
    const now = Date.now();
    for (const [uuid, s] of sessions) if (now - s.ts > cfg.sessionTtlMs) sessions.delete(uuid);
  }

  function joinableRooms(allRooms, takenRoomIds) {
    return allRooms.filter((r) =>
      r.id !== room?.id &&               // not the operator room
      !r.is_private &&                    // not private
      !takenRoomIds.has(r.id)             // no bot of ours already inside
    );
  }

  async function handleMessage(d) {
    if (!room) return;
    const uuid = d.uuid;
    const sender = d.pin_name || 'เพื่อน';
    const text = (d.message || '').trim();
    if (!uuid || uuid.toUpperCase() === (op.user_uuid || '').toUpperCase()) return; // ignore self
    if ((d.pin_name || '').includes(op.name)) return;

    emitEvent('operator-message', { from: sender, text, self: false, ts: Date.now() });
    sweepSessions();
    const session = sessions.get(uuid);

    // Cancel
    if (/^(ยกเลิก|cancel|เลิก)$/i.test(text)) {
      if (session) { sessions.delete(uuid); post(`ยกเลิกแล้วค่ะ คุณ${sender} 👌`); }
      return;
    }

    // Awaiting a room number from this user
    if (session && session.step === 'awaiting_choice') {
      const n = parseInt(text.replace(/[^0-9]/g, ''), 10);
      if (!n || n < 1 || n > session.rooms.length) { post(`คุณ${sender} พิมพ์เลข 1-${session.rooms.length} นะคะ (หรือ "ยกเลิก")`); session.ts = Date.now(); return; }
      const target = session.rooms[n - 1];
      sessions.delete(uuid);
      await doSummon(target, { type: 'chat', by: sender });
      return;
    }

    // New summon request (marker anywhere in the message)
    if (text.toLowerCase().includes(marker)) {
      const bots = (deps.getSummonableBots && deps.getSummonableBots()) || [];
      const free = bots.filter((b) => b.available);
      if (free.length === 0) { post(`ขอโทษค่ะ คุณ${sender} ตอนนี้บอทไม่ว่างเลย รอสักครู่นะคะ 🙏`); return; }

      const takenRoomIds = new Set(bots.map((b) => b.currentRoomId).filter(Boolean));
      let allRooms = [];
      try { allRooms = await fetchAllRooms(); } catch { post('ขอโทษค่ะ ดึงรายชื่อห้องไม่ได้ ลองใหม่นะคะ'); return; }
      const options = joinableRooms(allRooms, takenRoomIds).slice(0, 9);
      if (options.length === 0) { post(`คุณ${sender} ตอนนี้ไม่มีห้องว่างให้บอทเข้าเลยค่ะ (ทุกห้องมีบอทแล้ว/ปิดอยู่)`); return; }

      sessions.set(uuid, { step: 'awaiting_choice', rooms: options, name: sender, ts: Date.now() });
      const list = options.map((r, i) => `${i + 1}. ${r.topic} (${r.participants_count || 0} คน)`).join('\n');
      post(`🤖 คุณ${sender} เลือกห้องที่อยากให้บอทเข้า พิมพ์เลขนะคะ (บอทว่าง ${free.length} ตัว):\n${list}\n(พิมพ์ "ยกเลิก" เพื่อยกเลิก)`);
    }
  }

  async function doSummon(targetRoom, summonInfo) {
    const bots = (deps.getSummonableBots && deps.getSummonableBots()) || [];
    const bot = bots.find((b) => b.available);
    if (!bot) { post(`ขอโทษค่ะ บอทเพิ่งไม่ว่างพอดี ลองใหม่นะคะ 🙏`); return; }
    try {
      await deps.dispatchBot(bot.id, targetRoom.id, summonInfo);
      recentSummons.unshift({ bot: bot.name, roomTopic: targetRoom.topic, roomId: targetRoom.id, by: summonInfo.by || null, type: summonInfo.type, ts: Date.now() });
      if (recentSummons.length > 15) recentSummons.length = 15;
      emitEvent('operator-summon', recentSummons[0]);
      if (summonInfo.type === 'chat') post(`✅ กำลังส่ง "${bot.name}" เข้าห้อง "${targetRoom.topic}" ให้คุณ${summonInfo.by} ค่ะ 🎵`);
      log(`dispatched ${bot.name} -> "${targetRoom.topic}" (${summonInfo.type}${summonInfo.by ? ' by ' + summonInfo.by : ''})`);
      emitStatus();
    } catch (e) {
      post(`❌ ส่งบอทเข้าห้องไม่สำเร็จค่ะ (${e.message})`);
      log('dispatch err:', e.message);
    }
  }

  // ---------- topic summon poller ----------
  async function topicPoll() {
    if (!running) return; // works even if the hosted operator room couldn't be opened
    try {
      const bots = (deps.getSummonableBots && deps.getSummonableBots()) || [];
      const free = bots.filter((b) => b.available);
      if (free.length === 0) return;
      const takenRoomIds = new Set(bots.map((b) => b.currentRoomId).filter(Boolean));
      const now = Date.now();
      for (const [rid, ts] of recentTopicDispatch) if (now - ts > cfg.topicCooldownMs) recentTopicDispatch.delete(rid);

      const allRooms = await fetchAllRooms();
      for (const r of allRooms) {
        if ((room && r.id === room.id) || r.is_private) continue;
        if (!(r.topic || '').toLowerCase().includes(marker)) continue;
        if (takenRoomIds.has(r.id)) continue;         // already has a bot
        if (recentTopicDispatch.has(r.id)) continue;  // cooldown
        recentTopicDispatch.set(r.id, now);
        await doSummon(r, { type: 'topic' });
        break; // one per tick, so availability re-checks next round
      }
    } catch (e) { log('topicPoll err:', e.message); }
  }

  // ---------- portal status ----------
  function emitStatus() {
    if (io) io.emit('operator-status', getStatus());
  }
  function getStatus() {
    return {
      running,
      operatorBot: op ? { name: op.name, uuid: op.user_uuid } : null,
      room: room ? { id: room.id, topic: room.topic } : null,
      activeSessions: sessions.size,
      marker,
      recentSummons: recentSummons.slice(0, 15),
    };
  }

  // ---------- public API ----------
  async function start() {
    if (running) return getStatus();
    op = (deps.getOperatorConfig && deps.getOperatorConfig()) || null;
    if (!op || !op.jwt_token) { log('❌ no operator bot configured'); return getStatus(); }
    running = true;
    log(`starting operator: ${op.name}`);
    await openOperatorRoom();
    if (topicTimer) clearInterval(topicTimer);
    topicTimer = setInterval(() => topicPoll(), cfg.topicPollMs);
    emitStatus();
    return getStatus();
  }

  function stop() {
    running = false;
    if (topicTimer) { clearInterval(topicTimer); topicTimer = null; }
    if (socket) { try { if (socket.connected && room) socket.emit('leave_room', { room: room.id, uuid: op.user_uuid }); } catch {} try { socket.removeAllListeners(); socket.disconnect(); } catch {} socket = null; }
    room = null; sessions.clear();
    log('stopped');
    emitStatus();
    return getStatus();
  }

  return { start, stop, getStatus };
};
