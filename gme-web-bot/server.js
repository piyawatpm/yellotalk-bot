#!/usr/bin/env node
/**
 * GME Web Bot Server
 *
 * HTTP server that controls a headless Chromium via Puppeteer,
 * running the GME H5 SDK to join voice rooms and play music.
 *
 * Same HTTP API as the C++ gme-music-bot binary so bot-server.js
 * can use it as a drop-in replacement.
 *
 * Usage:
 *   node server.js --port 9876 --bot-id test-1 --callback-url http://localhost:5353/api/music/song-ended
 */

'use strict';

const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { generateAuthBuffer, GME_SDK_APP_ID } = require('./auth');

// ---------- CLI args ----------

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const PORT = parseInt(getArg('--port', '9876'), 10);
const BOT_ID = getArg('--bot-id', 'web-bot-1');
const CALLBACK_URL = getArg('--callback-url', '');

// ---------- State ----------

let browser = null;
let page = null;
let state = {
  status: 'idle',      // idle, joining, joined, playing, paused, leaving
  room: null,
  user: null,
  uuid: null,
  currentFile: null,
  loop: false,
  volume: 100,
  error: null,
};

let songPollInterval = null;

// ---------- Puppeteer setup ----------

async function launchBrowser() {
  console.log(`[${BOT_ID}] Launching headless Chromium...`);

  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-web-security',
      '--allow-file-access-from-files',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  page = await browser.newPage();

  // Log browser console to stdout
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[GME') || text.includes('Error') || text.includes('error')) {
      console.log(`[${BOT_ID}:chrome] ${text}`);
    }
  });

  page.on('pageerror', err => {
    console.error(`[${BOT_ID}:chrome] PAGE ERROR: ${err.message}`);
  });

  // Load the GME page
  const pagePath = path.join(__dirname, 'gme-page.html');
  // Serve via express static so SDK relative path works
  console.log(`[${BOT_ID}] Loading GME page...`);
  await page.goto(`http://localhost:${PORT}/gme-page.html`, {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  // Check SDK loaded
  const sdkLoaded = await page.evaluate(() => window.__sdkLoaded);
  if (sdkLoaded) {
    console.log(`[${BOT_ID}] GME H5 SDK loaded successfully`);
  } else {
    console.warn(`[${BOT_ID}] WARNING: GME H5 SDK failed to load — check sdk/WebRTCService.min.js`);
  }

  console.log(`[${BOT_ID}] Browser ready`);
}

// ---------- Song-ended polling ----------

function startSongPoll() {
  if (songPollInterval) return;
  songPollInterval = setInterval(async () => {
    try {
      const result = await page.evaluate(() => window.getPlaybackState());
      if (result.songFinished && state.status === 'playing') {
        console.log(`[${BOT_ID}] Song finished: ${state.currentFile}`);
        const finishedFile = state.currentFile;
        state.status = 'joined';
        state.currentFile = null;

        // Notify callback
        if (CALLBACK_URL && finishedFile) {
          notifyCallback(finishedFile);
        }
      }
    } catch (e) {
      // Page might be navigating
    }
  }, 200);
}

function stopSongPoll() {
  if (songPollInterval) {
    clearInterval(songPollInterval);
    songPollInterval = null;
  }
}

function notifyCallback(file) {
  const body = JSON.stringify({ file, botId: BOT_ID });
  const url = new URL(CALLBACK_URL);

  const req = http.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, (res) => {
    console.log(`[${BOT_ID}] Callback response: ${res.statusCode}`);
  });

  req.on('error', (e) => {
    console.error(`[${BOT_ID}] Callback error: ${e.message}`);
  });

  req.write(body);
  req.end();
}

// ---------- Express HTTP API ----------

const app = express();
app.use(express.json({ limit: '50mb' }));

// Serve static files (gme-page.html, sdk/)
app.use(express.static(__dirname));

// GET /status
app.get('/status', (req, res) => {
  res.json({
    botId: BOT_ID,
    status: state.status,
    room: state.room,
    user: state.user,
    currentFile: state.currentFile,
    loop: state.loop,
    volume: state.volume,
    error: state.error,
  });
});

// POST /join { room, user, uuid }
app.post('/join', async (req, res) => {
  try {
    const { room, user, uuid } = req.body;
    if (!room || !user) {
      return res.status(400).json({ error: 'room and user required' });
    }

    console.log(`[${BOT_ID}] Joining room ${room} as user ${user}`);
    state.status = 'joining';
    state.room = room;
    state.user = user;
    state.uuid = uuid || '';
    state.error = null;

    // Generate auth buffer
    const authBuffer = generateAuthBuffer(user, room);
    console.log(`[${BOT_ID}] Auth buffer generated (${authBuffer.length} chars base64)`);

    // Init GME SDK
    await page.evaluate(async (appId, openId) => {
      await window.gmeInit(appId, openId);
    }, GME_SDK_APP_ID, user);

    // Enter room
    await page.evaluate(async (roomId, auth) => {
      await window.gmeEnterRoom(roomId, auth);
    }, room, authBuffer);

    state.status = 'joined';
    startSongPoll();

    console.log(`[${BOT_ID}] Joined room ${room}`);
    res.json({ ok: true, status: 'joined', room, user });
  } catch (e) {
    console.error(`[${BOT_ID}] Join error: ${e.message}`);
    state.status = 'error';
    state.error = e.message;
    res.status(500).json({ error: e.message });
  }
});

// POST /play { file, loop }
app.post('/play', async (req, res) => {
  try {
    const { file, loop } = req.body;
    if (!file) {
      return res.status(400).json({ error: 'file required' });
    }

    if (state.status !== 'joined' && state.status !== 'playing' && state.status !== 'paused') {
      return res.status(400).json({ error: `Cannot play in state: ${state.status}` });
    }

    console.log(`[${BOT_ID}] Playing: ${file} (loop: ${!!loop})`);

    // Read file from filesystem
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `File not found: ${filePath}` });
    }

    const fileData = fs.readFileSync(filePath);
    const base64Data = fileData.toString('base64');

    // Send to page for decoding and playback
    const result = await page.evaluate(async (data, loopFlag) => {
      return await window.playAudio(data, loopFlag);
    }, base64Data, !!loop);

    state.status = 'playing';
    state.currentFile = file;
    state.loop = !!loop;

    console.log(`[${BOT_ID}] Playback started (duration: ${result.duration?.toFixed(1)}s)`);
    res.json({ ok: true, status: 'playing', file, duration: result.duration });
  } catch (e) {
    console.error(`[${BOT_ID}] Play error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// POST /stop
app.post('/stop', async (req, res) => {
  try {
    await page.evaluate(() => window.stopAudio());
    state.status = state.room ? 'joined' : 'idle';
    state.currentFile = null;
    state.loop = false;
    console.log(`[${BOT_ID}] Playback stopped`);
    res.json({ ok: true, status: state.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /pause
app.post('/pause', async (req, res) => {
  try {
    const result = await page.evaluate(() => window.pauseAudio());
    if (result.ok) {
      state.status = 'paused';
      console.log(`[${BOT_ID}] Playback paused`);
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /resume
app.post('/resume', async (req, res) => {
  try {
    const result = await page.evaluate(() => window.resumeAudio());
    if (result.ok) {
      state.status = 'playing';
      console.log(`[${BOT_ID}] Playback resumed`);
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /volume { vol }
app.post('/volume', async (req, res) => {
  try {
    const vol = parseInt(req.body.vol, 10) || 100;
    const result = await page.evaluate((v) => window.setVolume(v), vol);
    state.volume = vol;
    console.log(`[${BOT_ID}] Volume set to ${vol}`);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /leave
app.post('/leave', async (req, res) => {
  try {
    console.log(`[${BOT_ID}] Leaving room...`);
    stopSongPoll();

    // Stop audio first
    await page.evaluate(() => window.stopAudio());

    // Exit GME room
    await page.evaluate(async () => await window.gmeExitRoom());

    state.status = 'idle';
    state.room = null;
    state.user = null;
    state.uuid = null;
    state.currentFile = null;
    state.loop = false;
    state.error = null;

    console.log(`[${BOT_ID}] Left room`);
    res.json({ ok: true, status: 'idle' });
  } catch (e) {
    console.error(`[${BOT_ID}] Leave error: ${e.message}`);
    // Reset state anyway
    state.status = 'idle';
    state.room = null;
    res.json({ ok: true, status: 'idle', warn: e.message });
  }
});

// GET /voice-users
app.get('/voice-users', async (req, res) => {
  try {
    const events = await page.evaluate(() => window.__gmeEvents);
    // Extract member events to get user list
    const memberEvents = events.filter(e => e.type === 'member');
    res.json({ ok: true, events: memberEvents });
  } catch (e) {
    res.json({ ok: true, events: [] });
  }
});

// ---------- Startup ----------

const httpServer = app.listen(PORT, async () => {
  console.log(`[${BOT_ID}] HTTP server listening on port ${PORT}`);

  try {
    await launchBrowser();
    console.log(`[${BOT_ID}] Ready — waiting for commands`);
  } catch (e) {
    console.error(`[${BOT_ID}] Failed to launch browser: ${e.message}`);
    process.exit(1);
  }
});

// ---------- Graceful shutdown ----------

async function shutdown() {
  console.log(`[${BOT_ID}] Shutting down...`);
  stopSongPoll();

  try {
    if (page && state.room) {
      await page.evaluate(async () => {
        window.stopAudio();
        await window.gmeExitRoom();
      }).catch(() => {});
    }
  } catch (e) {}

  try {
    if (browser) await browser.close();
  } catch (e) {}

  httpServer.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
