#!/usr/bin/env node
'use strict';
/**
 * GME Redroid Bot adapter.
 *
 * Drop-in replacement for gme-web-bot/server.js (same HTTP API as the native
 * C++ bot), but instead of Puppeteer it drives the native GME Android SDK
 * running inside a Redroid (Android-in-Docker) container:
 *
 *   bot-server  ──HTTP──▶  this adapter (:PORT)
 *                             ├─ adb push <mp3> into the container
 *                             └─HTTP──▶ Android app (:9099 via adb forward) ──▶ GME native SDK ──▶ room
 *
 * The native Android platform is enabled for the GME app, so this path does not
 * hit the "sdkAppId invalid" wall the web/H5 SDK does.
 *
 * Usage: node server.js --port 9876 --bot-id <id> --callback-url http://localhost:5353/api/music/song-ended
 * Env:   REDROID_SERIAL (default localhost:5555), REDROID_APP_PORT (host port forwarded to the app, default 9877)
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const { execFile } = require('child_process');

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };

const PORT = parseInt(arg('--port', '9876'), 10);
const BOT_ID = arg('--bot-id', 'redroid-1');
const CALLBACK_URL = arg('--callback-url', '');
const SERIAL = process.env.REDROID_SERIAL || 'localhost:5555';
const APP_HOST_PORT = parseInt(process.env.REDROID_APP_PORT || '9877', 10);
const APP_DEVICE_PORT = 9099;
const APP = `http://127.0.0.1:${APP_HOST_PORT}`;
const DEVICE_MP3 = '/data/local/tmp/gmesong.mp3';

function log(m) { console.log(`[${BOT_ID}] ${m}`); }

function adb(argv, timeout = 20000) {
  return new Promise((resolve) => {
    execFile('adb', ['-s', SERIAL].concat(argv), { timeout }, (e, so, se) => resolve({ e, so, se }));
  });
}

// JSON HTTP call to the Android app (through the adb-forwarded port)
function appCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(APP + path, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (r) => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({ raw: b }); } });
    });
    req.on('error', reject);
    req.setTimeout(28000, () => req.destroy(new Error('app request timeout')));
    if (data) req.write(data);
    req.end();
  });
}

// Make sure the container is reachable, the app is running, and the port is forwarded.
async function ensureApp() {
  await new Promise(r => execFile('adb', ['connect', SERIAL], () => r()));
  await adb(['shell', 'am', 'start', '-n', 'com.gmebot.test/.MainActivity']);
  await adb(['forward', `tcp:${APP_HOST_PORT}`, `tcp:${APP_DEVICE_PORT}`]);
  // give the in-app HTTP server a moment on a cold start
  await new Promise(r => setTimeout(r, 800));
}

let state = { currentFile: null, loop: false };
let songPoll = null;

function startSongPoll() {
  if (songPoll) return;
  songPoll = setInterval(async () => {
    try {
      const s = await appCall('GET', '/status');
      if (s && s.songFinished && state.currentFile) {
        const f = state.currentFile; state.currentFile = null;
        log(`song finished: ${f}`);
        if (CALLBACK_URL) notifyCallback(f);
      }
    } catch (e) { /* app briefly unreachable */ }
  }, 500);
}

function notifyCallback(file) {
  try {
    const data = JSON.stringify({ file, botId: BOT_ID });
    const u = url.parse(CALLBACK_URL);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } });
    req.on('error', () => {});
    req.write(data); req.end();
  } catch (e) {}
}

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    let j = {}; try { if (body) j = JSON.parse(body); } catch (e) {}
    res.setHeader('Content-Type', 'application/json');
    try {
      if (u.pathname === '/status') {
        let s = {}; try { s = await appCall('GET', '/status'); } catch (e) {}
        return res.end(JSON.stringify({ botId: BOT_ID, status: s.status || 'idle', room: s.room, user: null, currentFile: s.currentFile, loop: state.loop, volume: s.volume, inRoom: s.inRoom, songFinished: s.songFinished, error: s.error }));
      }
      if (u.pathname === '/join' && req.method === 'POST') {
        const { room, user, uuid } = j;
        if (!room || !user) return res.end(JSON.stringify({ error: 'room and user required' }));
        await ensureApp();
        log(`join room=${room} user=${user}`);
        const r = await appCall('POST', '/join', { room: String(room), user: String(user), uuid: uuid ? String(uuid) : String(user) });
        if (r.inRoom) startSongPoll();
        return res.end(JSON.stringify({ ok: !!r.inRoom, inRoom: !!r.inRoom, status: r.status, room, user, error: r.error }));
      }
      if (u.pathname === '/play' && req.method === 'POST') {
        const host = j.file;
        if (!host || !fs.existsSync(host)) return res.status ? res.end(JSON.stringify({ error: 'file not found: ' + host })) : res.end(JSON.stringify({ error: 'file not found: ' + host }));
        log(`play ${host} (loop=${!!j.loop})`);
        const push = await adb(['push', host, DEVICE_MP3]);
        if (push.e) return res.end(JSON.stringify({ error: 'adb push failed: ' + push.e.message }));
        state.currentFile = host; state.loop = !!j.loop;
        const r = await appCall('POST', '/play', { file: DEVICE_MP3, loop: !!j.loop });
        return res.end(JSON.stringify({ ok: !!r.ok, status: 'playing', file: host }));
      }
      if (['/stop', '/pause', '/resume', '/leave'].includes(u.pathname) && req.method === 'POST') {
        if (u.pathname === '/leave') { state.currentFile = null; }
        const r = await appCall('POST', u.pathname, {});
        return res.end(JSON.stringify(r));
      }
      if (u.pathname === '/volume' && req.method === 'POST') {
        const r = await appCall('POST', '/volume', { vol: parseInt(j.vol, 10) || 100 });
        return res.end(JSON.stringify(r));
      }
      if (u.pathname === '/voice-users') { return res.end(JSON.stringify({ ok: true, events: [] })); }
      res.statusCode = 404; res.end(JSON.stringify({ error: 'unknown endpoint' }));
    } catch (e) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
  });
});

ensureApp()
  .then(() => server.listen(PORT, () => log(`redroid adapter listening on ${PORT}, driving app at ${APP}`)))
  .catch((e) => { log('ensureApp failed: ' + e.message); server.listen(PORT, () => log(`redroid adapter listening on ${PORT} (app not ready yet)`)); });

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
