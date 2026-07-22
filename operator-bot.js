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

const INSTRUCTIONS = [
  '🤖 สวัสดีค่ะ! ห้องนี้คือห้องเรียกบอท',
  '① ตั้งชื่อห้องของคุณให้มี "@bot" แล้วบอทจะเข้าห้องให้อัตโนมัติ (ถ้ามีบอทว่าง)',
  '② หรือพิมพ์ "@bot" ที่นี่ แล้วเลือกห้องที่อยากให้บอทเข้าได้เลยค่ะ',
  '③ พิมพ์ "@status" เพื่อเช็คว่ามีบอทว่างกี่ตัวค่ะ',
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
  let wasAllBusy = false;      // announce once when all bots get busy / once when one frees up
  let reopening = false;
  let reopenAttempts = 0;
  const sessions = new Map();  // userUuid -> { step, rooms, name, ts }
  const recentTopicDispatch = new Map(); // roomId -> ts (cooldown)
  const recentSummons = [];    // [{ bot, roomTopic, roomId, by, type, ts }] newest first
  const recentMessages = [];   // ring buffer of operator-room chat, so the portal feed backfills on open (it was realtime-only → always empty on load)
  function pushFeed(m) { recentMessages.push(m); if (recentMessages.length > 40) recentMessages.shift(); }

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

  // ---------- operator room lifecycle ----------
  // Bots CAN host: a REST-created room is a draft that live_ends in ~1s unless you ACTIVATE it by
  // emitting the socket `create_room` event immediately (socket must already be connected), THEN
  // join_room as host. Order matters: create_room (activate) BEFORE join_room.
  const OPERATOR_TOPIC = '🤖 เรียกบอท — พิมพ์ @bot ที่นี่';

  async function createRoom(topic) {
    const r = await axios.post(`${cfg.apiBase}/v1/rooms`, { category_id: 0, is_private: false, limit_speaker: 1, topic }, authHeaders());
    return r.data.json || r.data;
  }

  // Activate (create_room) THEN join_room as host. Explicit ids so a concurrent live_end can't crash.
  function activateAndJoin(rid, gmeId) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      setTimeout(() => finish(false), 9000);
      // create_room activates a fresh room + claims ownership (own room => fine); MUST come first.
      socket.emit('create_room', { room: rid, uuid: op.user_uuid, limit_speaker: 1 }, (cr) => {
        log(`activate/own room: result=${cr?.result} ${cr?.description || ''}`);
        socket.emit('join_room', {
          room: rid, uuid: op.user_uuid, avatar_id: op.avatar_id || 0,
          gme_id: String(gmeId || ''), campus: 'No Group', pin_name: op.name,
          role: 'host', gme_role: 'host', audio_role: 'host',
        }, (jr) => {
          log(`join operator room: result=${jr?.result} ${jr?.description || ''}`);
          finish(jr?.result === 200);
        });
      });
    });
  }

  function post(text) {
    if (!socket || !socket.connected || !room) return;
    // Matches bot-server's sendMessageForBot: server routes by the socket's joined room.
    socket.emit('new_message', { message: text });
    const m = { from: op.name, text, self: true, ts: Date.now() };
    pushFeed(m); emitEvent('operator-message', m);
  }

  async function openOperatorRoom() {
    // Connect the socket FIRST so create_room can fire immediately after REST-create.
    if (socket) { try { socket.removeAllListeners(); socket.disconnect(); } catch {} socket = null; }
    const s = socketClient(cfg.wsUrl, { auth: { token: op.jwt_token }, transports: ['websocket'], rejectUnauthorized: false, reconnection: false });
    socket = s;
    s.on('new_message', (d) => handleMessage(d).catch((e) => log('handleMessage err:', e.message)));
    s.on('live_end', () => { if (socket !== s) return; log('operator room ended'); room = null; emitStatus(); scheduleReopen(); });
    s.on('disconnect', (reason) => { if (socket !== s) return; if (running && reason !== 'io client disconnect') { room = null; emitStatus(); scheduleReopen(); } });
    await new Promise((res) => { const to = setTimeout(res, 8000); s.on('connect', () => { clearTimeout(to); res(); }); });
    if (!s.connected) { log('⚠️ operator socket failed to connect'); return false; }

    // Get a room: adopt a seeded one if it's open, else create a fresh one.
    let how = 'created';
    if (op.roomId) {
      const rooms = await fetchAllRooms().catch(() => []);
      const found = rooms.find((x) => x.id === op.roomId);
      if (found) { room = { id: found.id, gme_id: found.gme_id, topic: found.topic }; how = 'adopted'; }
      else log(`⚠️ operatorRoomId ${op.roomId} not open; creating a fresh operator room.`);
    }
    if (!room) {
      try { const c = await createRoom(OPERATOR_TOPIC); room = { id: c.id, gme_id: c.gme_id, topic: c.topic || OPERATOR_TOPIC }; }
      catch (e) {
        const msg = e.response?.data?.error?.message || e.message;
        log(`❌ create room failed (${msg}) — this account may lack a gme_user_id. Topic-summon still active.`);
        return false;
      }
    }
    const rid = room.id, gmeId = room.gme_id;
    log(`operator room ${how}: "${room.topic}" (${rid})`);

    const ok = await activateAndJoin(rid, gmeId); // create_room (activate) -> join_room
    if (!ok || socket !== s) { log('⚠️ could not activate/join operator room; topic-summon still active.'); room = null; emitStatus(); return false; }
    reopenAttempts = 0;
    setTimeout(() => post(INSTRUCTIONS), 1500);
    emitStatus();
    return true;
  }

  function scheduleReopen() {
    if (!running || reopening) return;
    if (reopenAttempts >= 4) { log('⚠️ gave up re-opening the operator room; topic-summon still running.'); return; }
    reopening = true; reopenAttempts++;
    setTimeout(async () => { reopening = false; if (running) await openOperatorRoom().catch((e) => log('reopen err:', e.message)); }, cfg.reopenDelayMs * Math.min(reopenAttempts, 4));
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
      !takenRoomIds.has(r.id) &&          // no bot of ours already inside
      !(deps.isRoomKicked && deps.isRoomKicked(r.id))  // not a room we were kicked from
    );
  }

  async function handleMessage(d) {
    if (!room) return;
    const uuid = d.uuid;
    const sender = d.pin_name || 'เพื่อน';
    const text = (d.message || '').trim();
    if (!uuid || uuid.toUpperCase() === (op.user_uuid || '').toUpperCase()) return; // ignore self
    if ((d.pin_name || '').includes(op.name)) return;

    const inMsg = { from: sender, text, self: false, ts: Date.now() };
    pushFeed(inMsg); emitEvent('operator-message', inMsg);
    sweepSessions();
    const session = sessions.get(uuid);

    // @status — report bot availability on demand
    if (text.toLowerCase().includes('@status') || /^สถานะ$/i.test(text)) {
      const statusBots = (deps.getSummonableBots && deps.getSummonableBots()) || [];
      const freeNow = statusBots.filter((b) => b.available);
      const lines = statusBots.map((b) => `${b.available ? '🟢' : '🔴'} ${b.name} — ${b.available ? 'ว่าง' : 'ไม่ว่าง'}`).join('\n') || '(ไม่มีบอท)';
      post(`📊 สถานะบอท (ว่าง ${freeNow.length}/${statusBots.length} ตัว):\n${lines}`);
      return;
    }

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
      // Announce once when EVERY bot becomes busy, and once when one frees up.
      const allBusy = bots.length > 0 && free.length === 0;
      if (allBusy && !wasAllBusy) { wasAllBusy = true; post('🔴 ตอนนี้บอทไม่ว่างทุกตัวแล้วค่ะ เดี๋ยวมีบอทว่างจะแจ้งให้นะคะ 🙏'); }
      else if (!allBusy && wasAllBusy) { wasAllBusy = false; post(`🟢 มีบอทว่างแล้วค่ะ (ว่าง ${free.length} ตัว) พิมพ์ @bot เพื่อเรียกได้เลย`); }
      if (free.length === 0) return;
      const takenRoomIds = new Set(bots.map((b) => b.currentRoomId).filter(Boolean));
      const now = Date.now();
      for (const [rid, ts] of recentTopicDispatch) if (now - ts > cfg.topicCooldownMs) recentTopicDispatch.delete(rid);

      const allRooms = await fetchAllRooms();
      for (const r of allRooms) {
        if ((room && r.id === room.id) || r.is_private) continue;
        if (!(r.topic || '').toLowerCase().includes(marker)) continue;
        if (takenRoomIds.has(r.id)) continue;         // already has a bot
        if (deps.isRoomKicked && deps.isRoomKicked(r.id)) continue; // kicked out — never rejoin
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
      recentMessages: recentMessages.slice(-40),
    };
  }

  // ---------- public API ----------
  async function start() {
    if (running) return getStatus();
    op = (deps.getOperatorConfig && deps.getOperatorConfig()) || null;
    if (!op || !op.jwt_token) { log('❌ no operator bot configured'); return getStatus(); }
    running = true; reopenAttempts = 0;
    log(`starting operator: ${op.name}`);
    // Topic-summon always runs (REST poll -> dispatch).
    if (topicTimer) clearInterval(topicTimer);
    topicTimer = setInterval(() => topicPoll(), cfg.topicPollMs);
    // Open the operator's own hosted room (create fresh, or adopt a seeded operatorRoomId).
    await openOperatorRoom().catch((e) => log('openOperatorRoom err:', e.message));
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
