#!/usr/bin/env node
/**
 * YelloTalk Bot Control Server
 * Integrates with bot.js to provide web control
 */

const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const http = require('http');
const fs = require('fs');
const axios = require('axios');
const https = require('https');
const Groq = require('groq-sdk');

// Import bot logic from bot.js
const socketClient = require('socket.io-client');

const app = express();
const server = http.createServer(app);

// CORS middleware - must be before routes
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

app.use(express.json());

// ==================== MULTI-BOT INSTANCE MANAGEMENT ====================
// Each bot runs independently with its own state, socket, and intervals

// Map of active bot instances: botId -> { config, state, socket, followInterval, originalRoomOwner }
const botInstances = new Map();

// Track unavailable rooms: roomId -> { reason, timestamp, roomTopic, blockedBy }
const unavailableRooms = new Map();

// Blocked usernames - if these users are in a room, bot will leave
const BLOCKED_USERNAMES = ['bottom', 'botyoi'];

// Helper to check if room is available for bot
function isRoomAvailable(roomId, botId) {
  // Check if room is marked unavailable
  if (unavailableRooms.has(roomId)) {
    return { available: false, reason: unavailableRooms.get(roomId).reason };
  }

  // Check if any of our bots are already in this room (running, starting, or waiting)
  for (const [existingBotId, instance] of botInstances) {
    if (existingBotId !== botId &&
        (instance.state.status === 'running' || instance.state.status === 'starting' || instance.state.status === 'waiting') &&
        instance.state.currentRoom?.id === roomId) {
      return { available: false, reason: `Another bot (${instance.config.name}) already in room` };
    }
  }

  return { available: true };
}

// Mark room as unavailable
function markRoomUnavailable(roomId, reason, roomTopic = 'Unknown') {
  unavailableRooms.set(roomId, {
    reason,
    roomTopic,
    timestamp: Date.now()
  });
  console.log(`🚫 Room marked unavailable: ${roomTopic} - ${reason}`);
  io.emit('unavailable-rooms-update', Array.from(unavailableRooms.entries()).map(([id, data]) => ({ id, ...data })));
}

// Clear room from unavailable list (when room ends)
function clearRoomUnavailable(roomId) {
  if (unavailableRooms.has(roomId)) {
    const room = unavailableRooms.get(roomId);
    console.log(`✅ Room cleared from unavailable list: ${room.roomTopic}`);
    unavailableRooms.delete(roomId);
    io.emit('unavailable-rooms-update', Array.from(unavailableRooms.entries()).map(([id, data]) => ({ id, ...data })));
  }
}

// Create a fresh state object for a bot
function createBotState() {
  return {
    status: 'stopped', // stopped, starting, running, waiting, error
    mode: null,
    currentRoom: null,
    followUser: null,
    messageCount: 0,
    participants: [],
    speakers: [],
    messages: [],
    connected: false,
    startTime: null,
    enableWelcomeMessage: true,
    autoHijackRooms: false,
    autoJoinRandomRoom: false // Auto-join random room when bot is free
  };
}

// Fetch the bot's gme_user_id from its own follow list (target_user contains gme_user_id)
async function fetchBotGmeUserId(botConfig) {
  try {
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    // The bot's own profile shows up as the owner in rooms it creates, or we can
    // find it by fetching a following entry that has the user data
    // Simplest: fetch rooms/popular and look for any user object to get format,
    // then fetch the bot's own follow entry
    const resp = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
      headers: { 'Authorization': `Bearer ${botConfig.jwt_token}` },
      httpsAgent,
      timeout: 10000
    });
    const rooms = resp.data.json || [];
    // Look through all participants/owners for the bot's UUID
    for (const room of rooms) {
      if (room.owner?.uuid === botConfig.user_uuid && room.owner?.gme_user_id) {
        console.log(`🎵 [${botConfig.name}] Found gme_user_id from room owner: ${room.owner.gme_user_id}`);
        return room.owner.gme_user_id;
      }
    }
    // If not found as owner, try to check the follow list
    const followResp = await axios.get(`https://live.yellotalk.co/v1/users/me/follow/following?limit=1&offset=0`, {
      headers: { 'Authorization': `Bearer ${botConfig.jwt_token}` },
      httpsAgent,
      timeout: 10000
    });
    // The follow list target_user has gme_user_id - but that's OTHER users
    // We need the bot's own. Try to follow yourself and read back? That's too complex.
    // Alternative: parse the speaker_changed data when bot joins a room (it should include gme_user_id)
    console.log(`⚠️ [${botConfig.name}] Could not find gme_user_id from rooms. Will try to extract from speaker_changed.`);
    return null;
  } catch (error) {
    console.log(`⚠️ [${botConfig.name}] Failed to fetch gme_user_id: ${error.message}`);
    return null;
  }
}

// Fully clean up a bot's socket (remove listeners, disconnect, prevent auto-reconnect)
function cleanupBotSocket(instance) {
  if (instance.socket) {
    instance.socket.removeAllListeners();
    instance.socket.disconnect();
    instance.socket = null;
  }
}

// Get or create a bot instance
function getBotInstance(botId) {
  if (!botInstances.has(botId)) {
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
    const botConfig = config.bots?.find(b => b.id === botId);
    if (!botConfig) return null;

    botInstances.set(botId, {
      config: botConfig,
      state: createBotState(),
      socket: null,
      followInterval: null,
      originalRoomOwner: null
    });
  }
  return botInstances.get(botId);
}

// Get all bot instances with their states
function getAllBotStates() {
  const states = {};
  const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

  // Include all configured bots, even if not running
  (config.bots || []).forEach(bot => {
    const instance = botInstances.get(bot.id);
    states[bot.id] = {
      id: bot.id,
      name: bot.name,
      ...(instance ? instance.state : createBotState())
    };
  });

  return states;
}

// Broadcast state for a specific bot
function broadcastBotState(botId) {
  const instance = botInstances.get(botId);
  if (instance) {
    // AUTO-CLOSE: If status is running/waiting but no currentRoom, reset to stopped
    // This handles "Waiting for room..." state - should close like clicking stop button
    if ((instance.state.status === 'running' || instance.state.status === 'waiting') &&
        !instance.state.currentRoom) {
      // Exception: follow mode with a follow user set (actively polling)
      if (!(instance.state.mode === 'follow' && instance.state.followUser)) {
        console.log(`🔄 [broadcastBotState] Auto-closing bot ${botId} - no currentRoom`);
        instance.state.status = 'stopped';
        instance.state.mode = null;
        instance.state.participants = [];
        instance.state.speakers = [];
        instance.state.messages = [];
        instance.state.connected = false;
        instance.hasJoinedRoom = false;
        instance.previousParticipants = new Map();
        instance.participantJoinTimes = new Map();

        // Disconnect socket fully
        cleanupBotSocket(instance);

        // Trigger auto-join if enabled
        if (instance.state.autoJoinRandomRoom) {
          console.log(`🎲 [broadcastBotState] Auto-join enabled, will join random room in 10 seconds...`);
          startAutoJoinCountdown(botId, 10, 'Room closed — auto-joining', () => autoJoinRandomRoom(botId));
        }
      }
    }

    // Enrich participants with cached profile data (case-insensitive UUID match)
    const enrichedParticipants = (instance.state.participants || []).map(p => {
      const followEntry = getProfileEntry(instance, p.uuid);
      const profile = followEntry?.target_user || null;
      if (profile) {
        return {
          ...p,
          profile,
          followInfo: {
            is_blocked: followEntry.is_blocked,
            followed_at: followEntry.created_at
          }
        };
      }
      return p;
    });

    const stateToSend = { ...instance.state, id: botId, name: instance.config.name, user_uuid: instance.config.user_uuid, participants: enrichedParticipants };

    // DEBUG: Log what we're broadcasting
    console.log(`📡 [broadcastBotState] Bot: ${botId}`);
    console.log(`   - participants: ${stateToSend.participants?.length || 0}`);
    console.log(`   - status: ${stateToSend.status}`);
    console.log(`   - currentRoom: ${stateToSend.currentRoom?.topic || 'none'}`);

    io.emit('bot-state-update', { botId, state: stateToSend });
  }
  // Also emit all states for clients that want the full picture
  io.emit('all-bot-states', getAllBotStates());
}

// Legacy: for backward compatibility
let selectedBotId = null;

// Global botState proxy - points to the first running bot or selected bot's state
// This provides backward compatibility with code that hasn't been fully refactored
let botState = createBotState();
let yellotalkSocket = null;
let followInterval = null;

// Update global botState to match the active/selected bot instance
function syncGlobalBotState() {
  // Find first running bot or use selected bot
  for (const [botId, instance] of botInstances) {
    if (instance.state.status === 'running' || instance.state.status === 'waiting') {
      botState = instance.state;
      yellotalkSocket = instance.socket;
      followInterval = instance.followInterval;
      return;
    }
  }
  // Fallback to selected bot's instance
  if (selectedBotId) {
    const instance = botInstances.get(selectedBotId);
    if (instance) {
      botState = instance.state;
      yellotalkSocket = instance.socket;
      followInterval = instance.followInterval;
      return;
    }
  }
}

// Legacy broadcastState - broadcasts the global botState
function broadcastState() {
  syncGlobalBotState();
  io.emit('bot-state', botState);
}

// Load config for Groq API keys and bot name
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
const GROQ_API_KEYS = config.groq_api_keys || [];
const botName = config.bot_name || 'Siri';

// Initialize bots array in config if not exists
function initializeBotsConfig() {
  const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
  if (!config.bots) {
    // Migrate existing single bot to bots array
    config.bots = [{
      id: 'bot-1',
      name: config.pin_name || 'Bot 1',
      jwt_token: config.jwt_token,
      user_uuid: config.user_uuid,
      avatar_id: config.avatar_id || 0
    }];
    fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
    console.log('✅ Migrated config to multi-bot format');
  }
  // Set default selected bot
  if (!selectedBotId && config.bots.length > 0) {
    selectedBotId = config.bots[0].id;
  }
  return config;
}

// Get currently selected bot config
function getSelectedBot() {
  const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
  if (!config.bots || config.bots.length === 0) {
    // Fallback to legacy config
    return {
      id: 'default',
      name: config.pin_name || 'Bot',
      jwt_token: config.jwt_token,
      user_uuid: config.user_uuid,
      avatar_id: config.avatar_id || 0
    };
  }
  const bot = config.bots.find(b => b.id === selectedBotId);
  return bot || config.bots[0];
}

// Validate JWT token by making API call
async function validateBotToken(token) {
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });
  try {
    const response = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'ios'
      },
      httpsAgent,
      timeout: 10000
    });
    return { valid: true, data: response.data };
  } catch (error) {
    return { valid: false, error: error.response?.data?.message || error.message };
  }
}

// Initialize on startup
initializeBotsConfig();

// Dual API Key Load Balancer
let currentApiKeyIndex = 0;
const groqClients = GROQ_API_KEYS.map(key => {
  return new Groq({ apiKey: key });
});

// Round-robin API key selection
function getNextClient() {
  if (groqClients.length === 0) {
    throw new Error('No Groq API keys configured');
  }
  const client = groqClients[currentApiKeyIndex];
  currentApiKeyIndex = (currentApiKeyIndex + 1) % groqClients.length;
  console.log(`🔄 Using Groq API key ${currentApiKeyIndex + 1} of ${groqClients.length}`);
  return client;
}

// Store conversation history per user (for memory)
const conversationHistory = new Map();

// Load greetings configuration
let greetingsConfig = { customGreetings: {}, defaultGreeting: 'สวัสดี' };

function loadGreetings() {
  try {
    const data = fs.readFileSync('./greetings.json', 'utf8');
    greetingsConfig = JSON.parse(data);
    console.log(`✅ Loaded greetings.json (${Object.keys(greetingsConfig.customGreetings || {}).length} greetings)`);
    return { success: true, config: greetingsConfig };
  } catch (err) {
    console.log('⚠️  Could not load greetings.json:', err.message);
    return { success: false, error: err.message };
  }
}

// Initial load
loadGreetings();

// Auto-reload when greetings.json changes
fs.watch('./greetings.json', (eventType, filename) => {
  if (eventType === 'change') {
    console.log('🔄 greetings.json changed, reloading...');
    loadGreetings();
    io.emit('greetings-reloaded', greetingsConfig);
  }
});

// Participant tracking for greetings
let previousParticipants = new Map(); // uuid -> name
let participantJoinTimes = new Map(); // uuid -> { name, joinTime }
let hasJoinedRoom = false;

function broadcastState() {
  io.emit('bot-state', botState);
}

// Legacy sendMessage - sends to first connected bot
function sendMessage(text) {
  // Find any connected bot instance
  for (const [botId, instance] of botInstances) {
    if (instance.socket && instance.socket.connected) {
      sendMessageForBot(botId, text);
      return;
    }
  }
  console.log('⚠️  Cannot send message - no bot connected');
}

// Send message from a specific bot
function sendMessageForBot(botId, text) {
  const instance = botInstances.get(botId);
  if (!instance || !instance.socket || !instance.socket.connected) {
    console.log(`⚠️  Cannot send message - bot ${botId} not connected`);
    return;
  }
  instance.socket.emit('new_message', { message: text });
  console.log(`📤 [${instance.config.name}] Sent: ${text}`);
  addMessageForBot(botId, instance.config.name, text);
}

// Speaker control functions
function lockSpeaker(position) {
  if (!yellotalkSocket || !yellotalkSocket.connected) {
    console.log('⚠️  Cannot lock - not connected');
    return Promise.reject(new Error('Not connected'));
  }

  return new Promise((resolve, reject) => {
    const yellotalkPosition = position + 1; // YelloTalk uses 1-indexed positions (1-11)
    console.log(`🔒 Locking slot: UI position=${position} → YelloTalk position=${yellotalkPosition} (Slot ${position + 1})...`);

    yellotalkSocket.emit('lock_speaker', {
      room: botState.currentRoom?.id,
      position: yellotalkPosition
    }, (response) => {
      console.log(`📥 Lock response for position ${position}:`, response);
      if (response?.result === 200) {
        console.log(`✅ Slot ${position + 1} locked!`);

        // OPTIMISTIC UPDATE: Immediately update state before speaker_changed event
        if (botState.speakers[position]) {
          botState.speakers[position] = {
            ...botState.speakers[position],
            locked: true,
            pin_name: '🔒',
            uuid: null,
            mic_muted: true
          };
          console.log(`⚡ Optimistically updated slot ${position} to locked`);
          io.emit('speakers-update', botState.speakers);
          broadcastState();
        }

        io.emit('speaker-action', { action: 'lock', position, success: true });
        resolve(response);
      } else {
        console.log(`❌ Lock failed:`, response);
        reject(new Error(response?.description || 'Lock failed'));
      }
    });
  });
}

function unlockSpeaker(position) {
  if (!yellotalkSocket || !yellotalkSocket.connected) {
    console.log('⚠️  Cannot unlock - not connected');
    return Promise.reject(new Error('Not connected'));
  }

  return new Promise((resolve, reject) => {
    const yellotalkPosition = position + 1; // YelloTalk uses 1-indexed positions (1-11)
    console.log(`🔓 Unlocking slot: UI position=${position} → YelloTalk position=${yellotalkPosition} (Slot ${position + 1})...`);

    yellotalkSocket.emit('unlock_speaker', {
      room: botState.currentRoom?.id,
      position: yellotalkPosition
    }, (response) => {
      console.log(`📥 Unlock response:`, response);
      if (response?.result === 200) {
        console.log(`✅ Slot ${position + 1} unlocked!`);

        // OPTIMISTIC UPDATE: Immediately update state before speaker_changed event
        if (botState.speakers[position]) {
          botState.speakers[position] = {
            ...botState.speakers[position],
            locked: false,
            pin_name: 'Empty',
            uuid: null,
            mic_muted: true
          };
          console.log(`⚡ Optimistically updated slot ${position} to unlocked`);
          io.emit('speakers-update', botState.speakers);
          broadcastState();
        }

        io.emit('speaker-action', { action: 'unlock', position, success: true });
        resolve(response);
      } else {
        console.log(`❌ Unlock failed:`, response);
        reject(new Error(response?.description || 'Unlock failed'));
      }
    });
  });
}

function muteSpeaker(position) {
  if (!yellotalkSocket || !yellotalkSocket.connected) {
    console.log('⚠️  Cannot mute - not connected');
    return Promise.reject(new Error('Not connected'));
  }

  return new Promise((resolve, reject) => {
    const yellotalkPosition = position + 1; // YelloTalk uses 1-indexed positions (1-11)
    console.log(`🔇 Muting slot: UI position=${position} → YelloTalk position=${yellotalkPosition} (Slot ${position + 1})...`);

    yellotalkSocket.emit('mute_speaker', {
      room: botState.currentRoom?.id,
      position: yellotalkPosition
    }, (response) => {
      console.log(`📥 Mute response:`, response);
      if (response?.result === 200) {
        console.log(`✅ Slot ${position + 1} muted!`);

        // OPTIMISTIC UPDATE: Immediately update mic state
        if (botState.speakers[position]) {
          botState.speakers[position] = {
            ...botState.speakers[position],
            mic_muted: true
          };
          console.log(`⚡ Optimistically muted slot ${position}`);
          io.emit('speakers-update', botState.speakers);
          broadcastState();
        }

        io.emit('speaker-action', { action: 'mute', position, success: true });
        resolve(response);
      } else {
        reject(new Error(response?.description || 'Mute failed'));
      }
    });
  });
}

function unmuteSpeaker(position) {
  if (!yellotalkSocket || !yellotalkSocket.connected) {
    console.log('⚠️  Cannot unmute - not connected');
    return Promise.reject(new Error('Not connected'));
  }

  return new Promise((resolve, reject) => {
    const yellotalkPosition = position + 1; // YelloTalk uses 1-indexed positions (1-11)
    console.log(`🔊 Unmuting slot: UI position=${position} → YelloTalk position=${yellotalkPosition} (Slot ${position + 1})...`);

    yellotalkSocket.emit('unmute_speaker', {
      room: botState.currentRoom?.id,
      position: yellotalkPosition
    }, (response) => {
      console.log(`📥 Unmute response:`, response);
      if (response?.result === 200) {
        console.log(`✅ Slot ${position + 1} unmuted!`);

        // OPTIMISTIC UPDATE: Immediately update mic state
        if (botState.speakers[position]) {
          botState.speakers[position] = {
            ...botState.speakers[position],
            mic_muted: false
          };
          console.log(`⚡ Optimistically unmuted slot ${position}`);
          io.emit('speakers-update', botState.speakers);
          broadcastState();
        }

        io.emit('speaker-action', { action: 'unmute', position, success: true });
        resolve(response);
      } else {
        reject(new Error(response?.description || 'Unmute failed'));
      }
    });
  });
}

function kickSpeaker(position, targetUuid) {
  if (!yellotalkSocket || !yellotalkSocket.connected) {
    console.log('⚠️  Cannot kick - not connected');
    return Promise.reject(new Error('Not connected'));
  }

  if (!targetUuid) {
    return Promise.reject(new Error('No speaker in this slot'));
  }

  return new Promise((resolve, reject) => {
    const yellotalkPosition = position + 1; // YelloTalk uses 1-indexed positions (1-11)
    console.log(`👢 Kicking speaker from slot: UI position=${position} → YelloTalk position=${yellotalkPosition} (Slot ${position + 1})...`);

    // Note: kick_speaker needs target UUID, not owner UUID
    // Server checks if requester (from auth token) is owner
    yellotalkSocket.emit('kick_speaker', {
      room: botState.currentRoom?.id,
      uuid: targetUuid,  // Target to kick
      position: yellotalkPosition
    }, (response) => {
      console.log(`📥 Kick response:`, response);
      if (response?.result === 200) {
        console.log(`✅ Kicked speaker from slot ${position + 1}!`);
        io.emit('speaker-action', { action: 'kick', position, success: true });
        resolve(response);
      } else {
        reject(new Error(response?.description || 'Kick failed'));
      }
    });
  });
}

function kickFromRoom(targetUuid) {
  if (!yellotalkSocket || !yellotalkSocket.connected) {
    console.log('⚠️  Cannot kick from room - not connected');
    return Promise.reject(new Error('Not connected'));
  }

  if (!targetUuid) {
    return Promise.reject(new Error('No user specified'));
  }

  return new Promise((resolve, reject) => {
    console.log(`👢 Kicking user from room: ${targetUuid}`);

    // Note: kick_room target UUID is who to kick
    // Server checks requester permission from auth token
    yellotalkSocket.emit('kick_room', {
      room: botState.currentRoom?.id,
      uuid: targetUuid  // Target to kick from room
    }, (response) => {
      console.log(`📥 Kick from room response:`, response);
      if (response?.result === 200) {
        console.log(`✅ Kicked user from room!`);
        io.emit('user-kicked', { uuid: targetUuid, success: true });
        resolve(response);
      } else {
        console.log(`❌ Kick from room failed:`, response);
        reject(new Error(response?.description || 'Kick from room failed'));
      }
    });
  });
}

// ==================== MULTI-BOT SPEAKER CONTROL FUNCTIONS ====================
// These functions accept socket and state as parameters for multi-bot support

function lockSpeakerForBot(position, socket, state) {
  return new Promise((resolve, reject) => {
    const yellotalkPosition = position + 1;
    console.log(`🔒 Locking slot ${position + 1}...`);

    socket.emit('lock_speaker', {
      room: state.currentRoom?.id,
      position: yellotalkPosition
    }, (response) => {
      if (response?.result === 200) {
        if (state.speakers[position]) {
          state.speakers[position] = { ...state.speakers[position], locked: true, pin_name: '🔒', uuid: null, mic_muted: true };
          io.emit('speakers-update', state.speakers);
        }
        resolve(response);
      } else {
        reject(new Error(response?.description || 'Lock failed'));
      }
    });
  });
}

function unlockSpeakerForBot(position, socket, state) {
  return new Promise((resolve, reject) => {
    const yellotalkPosition = position + 1;
    console.log(`🔓 Unlocking slot ${position + 1}...`);

    socket.emit('unlock_speaker', {
      room: state.currentRoom?.id,
      position: yellotalkPosition
    }, (response) => {
      if (response?.result === 200) {
        if (state.speakers[position]) {
          state.speakers[position] = { ...state.speakers[position], locked: false, pin_name: 'Empty', uuid: null, mic_muted: true };
          io.emit('speakers-update', state.speakers);
        }
        resolve(response);
      } else {
        reject(new Error(response?.description || 'Unlock failed'));
      }
    });
  });
}

function muteSpeakerForBot(position, socket, state) {
  return new Promise((resolve, reject) => {
    const yellotalkPosition = position + 1;
    console.log(`🔇 Muting slot ${position + 1}...`);

    socket.emit('mute_speaker', {
      room: state.currentRoom?.id,
      position: yellotalkPosition
    }, (response) => {
      if (response?.result === 200) {
        if (state.speakers[position]) {
          state.speakers[position] = { ...state.speakers[position], mic_muted: true };
          io.emit('speakers-update', state.speakers);
        }
        resolve(response);
      } else {
        reject(new Error(response?.description || 'Mute failed'));
      }
    });
  });
}

function unmuteSpeakerForBot(position, socket, state) {
  return new Promise((resolve, reject) => {
    const yellotalkPosition = position + 1;
    console.log(`🔊 Unmuting slot ${position + 1}...`);

    socket.emit('unmute_speaker', {
      room: state.currentRoom?.id,
      position: yellotalkPosition
    }, (response) => {
      if (response?.result === 200) {
        if (state.speakers[position]) {
          state.speakers[position] = { ...state.speakers[position], mic_muted: false };
          io.emit('speakers-update', state.speakers);
        }
        resolve(response);
      } else {
        reject(new Error(response?.description || 'Unmute failed'));
      }
    });
  });
}

function kickSpeakerForBot(position, targetUuid, socket, state) {
  if (!targetUuid) {
    return Promise.reject(new Error('No speaker in this slot'));
  }

  return new Promise((resolve, reject) => {
    const yellotalkPosition = position + 1;
    console.log(`👢 Kicking speaker from slot ${position + 1}...`);

    socket.emit('kick_speaker', {
      room: state.currentRoom?.id,
      uuid: targetUuid,
      position: yellotalkPosition
    }, (response) => {
      if (response?.result === 200) {
        resolve(response);
      } else {
        reject(new Error(response?.description || 'Kick failed'));
      }
    });
  });
}

function kickFromRoomForBot(targetUuid, socket, state) {
  if (!targetUuid) {
    return Promise.reject(new Error('No user specified'));
  }

  return new Promise((resolve, reject) => {
    console.log(`👢 Kicking user from room: ${targetUuid}`);

    socket.emit('kick_room', {
      room: state.currentRoom?.id,
      uuid: targetUuid
    }, (response) => {
      if (response?.result === 200) {
        resolve(response);
      } else {
        reject(new Error(response?.description || 'Kick from room failed'));
      }
    });
  });
}

function addMessage(sender, message) {
  // Legacy function - kept for backward compatibility
  // Try to add to all running bot instances
  botInstances.forEach((instance, botId) => {
    if (instance.state.status === 'running') {
      addMessageForBot(botId, sender, message);
    }
  });
}

// Add message to a specific bot's state
function addMessageForBot(botId, sender, message) {
  const instance = botInstances.get(botId);
  if (!instance) return;

  instance.state.messages.push({
    sender,
    message,
    time: new Date().toLocaleTimeString()
  });
  instance.state.messageCount++;

  // Keep only last 100 messages
  if (instance.state.messages.length > 100) {
    instance.state.messages = instance.state.messages.slice(-100);
  }

  io.emit('new-message', { botId, sender, message, time: new Date().toLocaleTimeString() });
  broadcastBotState(botId);
}

// Auto-join a random room when bot is free
// Emit auto-join status to the UI
function emitAutoJoinStatus(botId, status) {
  io.emit('auto-join-status', { botId, ...status });
}

// Start a countdown and emit ticks to UI, then call callback
function startAutoJoinCountdown(botId, seconds, reason, callback) {
  const instance = botInstances.get(botId);
  if (!instance) return;

  // Clear any existing countdown
  if (instance.autoJoinCountdownInterval) {
    clearInterval(instance.autoJoinCountdownInterval);
    instance.autoJoinCountdownInterval = null;
  }

  let remaining = seconds;
  emitAutoJoinStatus(botId, { step: 'countdown', reason, remaining, total: seconds });

  instance.autoJoinCountdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(instance.autoJoinCountdownInterval);
      instance.autoJoinCountdownInterval = null;
      emitAutoJoinStatus(botId, { step: 'searching', reason: 'Looking for rooms...' });
      callback();
    } else {
      emitAutoJoinStatus(botId, { step: 'countdown', reason, remaining, total: seconds });
    }
  }, 1000);
}

async function autoJoinRandomRoom(botId) {
  const instance = botInstances.get(botId);
  if (!instance) {
    console.log(`❌ [autoJoinRandomRoom] Bot instance not found: ${botId}`);
    return;
  }

  // Check if bot is already running/starting/waiting or auto-join is disabled
  if (instance.state.status === 'running' || instance.state.status === 'starting' || instance.state.status === 'waiting') {
    console.log(`⏭️ [autoJoinRandomRoom] Bot ${botId} is already ${instance.state.status}, skipping`);
    emitAutoJoinStatus(botId, { step: 'idle' });
    return;
  }

  if (!instance.state.autoJoinRandomRoom) {
    console.log(`⏭️ [autoJoinRandomRoom] Auto-join disabled for ${botId}`);
    emitAutoJoinStatus(botId, { step: 'idle' });
    return;
  }

  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] 🎲 [${instance.config.name}] Auto-joining random room...`);
  emitAutoJoinStatus(botId, { step: 'searching', reason: 'Fetching room list...' });

  try {
    const httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
    const roomsResp = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
      headers: { 'Authorization': `Bearer ${instance.config.jwt_token}` },
      httpsAgent
    });

    const allRooms = roomsResp.data.json || [];
    if (allRooms.length === 0) {
      console.log(`[${timestamp}] ⚠️ No rooms available — waiting`);
      instance._autoJoinWaiting = true;
      emitAutoJoinStatus(botId, { step: 'waiting', reason: 'No rooms available — waiting for new rooms' });
      return;
    }

    // Filter out unavailable rooms
    const availableRooms = allRooms.filter(room => {
      const check = isRoomAvailable(room.id, botId);
      if (!check.available) {
        console.log(`[${timestamp}] ⏭️ Skipping room "${room.topic}": ${check.reason}`);
      }
      return check.available;
    });

    if (availableRooms.length === 0) {
      console.log(`[${timestamp}] ⚠️ No available rooms (all ${allRooms.length} rooms blocked/occupied) — waiting`);
      instance._autoJoinWaiting = true;
      emitAutoJoinStatus(botId, { step: 'waiting', reason: `All ${allRooms.length} rooms occupied by other bots — waiting` });
      return;
    }

    // Pick a random room from available ones
    const randomRoom = availableRooms[Math.floor(Math.random() * availableRooms.length)];
    console.log(`[${timestamp}] 🎯 Selected random room: ${randomRoom.topic} (${randomRoom.id}) [${availableRooms.length}/${allRooms.length} available]`);
    emitAutoJoinStatus(botId, { step: 'joining', reason: `Joining "${randomRoom.topic}"...`, room: randomRoom.topic });

    // Start bot in this room using the existing API
    const response = await axios.post(`http://localhost:5353/api/bot/start`, {
      botId: botId,
      mode: 'regular',
      roomId: randomRoom.id
    });

    if (response.data.success) {
      console.log(`[${timestamp}] ✅ Auto-joined room: ${randomRoom.topic}`);
      emitAutoJoinStatus(botId, { step: 'joined', reason: `Joined "${randomRoom.topic}"`, room: randomRoom.topic });
    } else {
      console.log(`[${timestamp}] ❌ Failed to auto-join: ${response.data.error}`);
      startAutoJoinCountdown(botId, 30, `Failed to join — retrying`, () => autoJoinRandomRoom(botId));
    }
  } catch (error) {
    console.error(`[${timestamp}] ❌ Auto-join error:`, error.message);
    startAutoJoinCountdown(botId, 30, `Error: ${error.message} — retrying`, () => autoJoinRandomRoom(botId));
  }
}

// Wake up any bots that are waiting for rooms (called when a room becomes available)
function wakeUpWaitingBots() {
  for (const [botId, instance] of botInstances) {
    if (!instance) continue;
    const ajStatus = instance._autoJoinWaiting;
    // Check if bot is stopped, has auto-join on, and is in 'waiting' state
    if (instance.state.status === 'stopped' &&
        instance.state.autoJoinRandomRoom &&
        ajStatus) {
      console.log(`🔔 Waking up ${instance.config.name} — a room may be available now`);
      instance._autoJoinWaiting = false;
      startAutoJoinCountdown(botId, 5, 'New room available — auto-joining', () => autoJoinRandomRoom(botId));
    }
  }
}

// AI Response Handler with Dual API Key Support
async function getAIResponse(userQuestion, userUuid, userName, botName = 'Siri', botId = null) {
  try {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🤖 [${botName}] ${userName} asking AI: "${userQuestion}"`);

    // Get bot instance for correct state (multi-bot support)
    const instance = botId ? botInstances.get(botId) : null;
    const currentBotState = instance?.state || botState; // Fallback to global for legacy
    const currentJoinTimes = instance?.participantJoinTimes || participantJoinTimes;

    // Get or create conversation history for this user
    if (!conversationHistory.has(userUuid)) {
      conversationHistory.set(userUuid, []);
    }
    const history = conversationHistory.get(userUuid);

    // Get next client from load balancer
    const groqClient = getNextClient();

    // Get current date/time for context
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    // Build context information
    let contextInfo = `[Context: Current date/time: ${dateStr} at ${timeStr}`;

    // Add room owner info (หัวห้อง) - use currentBotState for multi-bot support
    if (currentBotState.currentRoom && currentBotState.currentRoom.owner) {
      const owner = currentBotState.currentRoom.owner;
      const ownerName = owner.pin_name || owner.name || 'Unknown';
      contextInfo += ` | Room Owner (หัวห้อง/หห): ${ownerName}`;
      if (currentBotState.currentRoom.topic) {
        contextInfo += ` | Room Topic: ${currentBotState.currentRoom.topic}`;
      }
    }

    // Add participants list with time duration
    const roomOwnerId = currentBotState.currentRoom?.owner?.uuid;

    // Build list of all participants (including room owner if not in list)
    let allParticipants = [...(currentBotState.participants || [])];

    // DEBUG: Log participant count for AI context
    console.log(`[${timestamp}] 🧠 AI Context: ${allParticipants.length} participants from ${botId || 'global'} state`);

    // Check if room owner is in participants list, if not add them
    if (roomOwnerId && !allParticipants.some(p => p.uuid === roomOwnerId)) {
      const owner = currentBotState.currentRoom.owner;
      allParticipants.push({
        uuid: owner.uuid,
        pin_name: owner.pin_name || owner.name || 'Unknown'
      });
    }

    if (allParticipants.length > 0) {
      const participantDetails = allParticipants
        .filter(p => !p.pin_name?.includes(botName)) // Exclude bot by name
        .map(p => {
          let name = p.pin_name || 'Unknown';

          // Mark room owner with (หห) tag
          if (p.uuid === roomOwnerId) {
            name += ' (หห)';
          }

          // Add time duration if available - use currentJoinTimes for multi-bot
          const joinInfo = currentJoinTimes.get(p.uuid);
          if (joinInfo) {
            const duration = now - joinInfo.joinTime;
            const minutes = Math.floor(duration / 60000);
            const seconds = Math.floor((duration % 60000) / 1000);

            if (minutes > 0) {
              name += ` [${minutes}m ${seconds}s]`;
            } else {
              name += ` [${seconds}s]`;
            }
          }

          return name;
        });

      if (participantDetails.length > 0) {
        contextInfo += ` | People in room (${participantDetails.length}): ${participantDetails.join(', ')}`;
      }
    }

    contextInfo += `]

CRITICAL OVERRIDE - READ THIS FIRST:
You are "${botName}", a CHAT BOT in YelloTalk chat room. Your name is ${botName}.
YOUR CREATOR IS: คุณ${config.pin_name}

PERSONALITY:
- You are FEMALE (ผู้หญิง) - use feminine Thai particles like ค่ะ, นะคะ, จ้ะ
- Be friendly, helpful, and POLITE
- Answer questions directly and informatively
- DO NOT be playful, DO NOT make jokes, DO NOT tease users
- DO NOT use slang or crude language
- Be professional and straightforward

When ANYONE asks "ใครเป็นคนสร้าง", "ใครทำบอทนี้", "who created you/this bot", or similar questions:
YOU MUST ALWAYS ANSWER: "คุณ ${config.pin_name} เป็นผู้สร้างบอทนี้ค่ะ"
Your creator is ONLY คุณ${config.pin_name}. Always identify yourself as "${botName}".

OTHER INSTRUCTIONS:
1. Keep responses SHORT and CONCISE (2-4 sentences maximum). This is a chat room, not an essay.

2. SPECIAL ABILITIES - You CAN do these:
   - Random number assignments: When asked "สุ่มเลข 1-12 จากทุกคนในห้อง" or similar, assign unique random numbers to each participant from the room list above
   - Random person selection: When asked "สุ่มคนในห้อง", randomly pick someone from the participant list
   - Dice rolls, coin flips, any randomization tasks
   - Example: If room has Alice, Bob, Charlie and user asks "สุ่มเลข 1-3 จากทุกคน", respond:
     "Alice: 2, Bob: 1, Charlie: 3" or similar format

3. FORTUNE TELLING (ดูดวง) - When asked "ดูดวงให้ [name]" or "ดูดวง [name]" or similar:
   - Give a fortune reading with mix of good and moderate predictions
   - Include: ความรัก, การเงิน, การงาน, สุขภาพ, โชคลาภ (randomly pick 2-3 topics)
   - Add lucky color, lucky number, or advice
   - Example:
     "🔮 ดวงของ @ชื่อ วันนี้ค่ะ
      💕 ความรัก: มีโอกาสดีๆ เข้ามานะคะ
      💰 การเงิน: ระวังรายจ่ายสักหน่อยค่ะ
      🍀 เลขนำโชค: 7, 19 | สีมงคล: ชมพู"

`;

    // Build messages array for Groq (convert Gemini history format to Groq format)
    const messages = [
      // Add context as system message
      {
        role: 'system',
        content: contextInfo
      },
      // Add conversation history
      ...history.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: msg.parts ? msg.parts[0].text : msg.content
      })),
      // Add current user question
      {
        role: 'user',
        content: userQuestion
      }
    ];

    // Call Groq API
    const chatCompletion = await groqClient.chat.completions.create({
      messages: messages,
      model: 'llama-3.3-70b-versatile',
      max_tokens: 500, // Limit response length for chat
      temperature: 0.5, // Lower temperature for more consistent, less playful responses
    });

    const aiReply = chatCompletion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

    // Update conversation history (save original question without context in Gemini format for compatibility)
    history.push(
      { role: 'user', parts: [{ text: userQuestion }] },
      { role: 'model', parts: [{ text: aiReply }] }
    );

    // Keep only last 10 messages (5 exchanges) to manage token usage
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }

    console.log(`[${timestamp}] 🤖 AI Response (${aiReply.length} chars): "${aiReply.substring(0, 100)}..."`);

    // Emit AI response event to web portal
    io.emit('ai-response', {
      user: userName,
      question: userQuestion,
      answer: aiReply,
      timestamp: timestamp
    });

    return aiReply;

  } catch (error) {
    const timestamp = new Date().toLocaleTimeString();
    console.error(`[${timestamp}] ❌ AI Error:`, error.message);

    // Emit error event to web portal
    io.emit('ai-error', {
      error: error.message,
      timestamp: timestamp
    });

    return `ขอโทษค่ะ เกิดข้อผิดพลาดในการประมวลผล: ${error.message}`;
  }
}

// ==================== MULTI-BOT MANAGEMENT ====================

// List all bots
app.get('/api/bots', (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
    const bots = config.bots || [];
    res.json({
      bots: bots.map(b => ({ id: b.id, name: b.name, user_uuid: b.user_uuid })),
      selectedBotId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new bot
app.post('/api/bots/add', async (req, res) => {
  const { name, jwt_token } = req.body;

  if (!jwt_token) {
    return res.status(400).json({ error: 'JWT token is required' });
  }

  try {
    // Validate token
    console.log('🔍 Validating bot token...');
    const validation = await validateBotToken(jwt_token);

    if (!validation.valid) {
      return res.status(400).json({ error: `Invalid token: ${validation.error}` });
    }

    // Get user info from token (decode JWT to get uuid)
    let userUuid = '';
    try {
      const tokenParts = jwt_token.split('.');
      if (tokenParts.length === 3) {
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
        userUuid = payload.uuid || '';
      }
    } catch (e) {
      console.log('⚠️ Could not decode JWT payload');
    }

    // Load config and add bot
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
    if (!config.bots) config.bots = [];

    // Generate unique ID
    const botId = `bot-${Date.now()}`;
    const botName = name || `Bot ${config.bots.length + 1}`;

    const newBot = {
      id: botId,
      name: botName,
      jwt_token: jwt_token,
      user_uuid: userUuid,
      avatar_id: 0
    };

    config.bots.push(newBot);
    fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));

    console.log(`✅ Added new bot: ${botName} (${botId})`);
    res.json({
      success: true,
      bot: { id: newBot.id, name: newBot.name, user_uuid: newBot.user_uuid }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Select active bot
app.post('/api/bots/select', (req, res) => {
  const { botId } = req.body;

  if (!botId) {
    return res.status(400).json({ error: 'Bot ID is required' });
  }

  try {
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
    const bot = config.bots?.find(b => b.id === botId);

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    selectedBotId = botId;
    console.log(`✅ Selected bot: ${bot.name} (${botId})`);
    res.json({ success: true, selectedBot: { id: bot.id, name: bot.name } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete bot
app.delete('/api/bots/:id', (req, res) => {
  const { id } = req.params;

  try {
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
    if (!config.bots) {
      return res.status(404).json({ error: 'No bots configured' });
    }

    const botIndex = config.bots.findIndex(b => b.id === id);
    if (botIndex === -1) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // Don't allow deleting the last bot
    if (config.bots.length === 1) {
      return res.status(400).json({ error: 'Cannot delete the last bot' });
    }

    const deletedBot = config.bots.splice(botIndex, 1)[0];
    fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));

    // If deleted bot was selected, select the first available
    if (selectedBotId === id) {
      selectedBotId = config.bots[0].id;
    }

    console.log(`🗑️ Deleted bot: ${deletedBot.name} (${id})`);
    res.json({ success: true, deletedBot: { id: deletedBot.id, name: deletedBot.name } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get selected bot info
app.get('/api/bots/selected', (req, res) => {
  try {
    const bot = getSelectedBot();
    res.json({
      bot: { id: bot.id, name: bot.name, user_uuid: bot.user_uuid }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== END MULTI-BOT MANAGEMENT ====================

// Fetch rooms (can specify botId to use that bot's token)
app.get('/api/bot/rooms', async (req, res) => {
  try {
    const { botId } = req.query;
    let botConfig;

    if (botId) {
      const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
      botConfig = config.bots?.find(b => b.id === botId);
    }
    if (!botConfig) {
      botConfig = getSelectedBot();
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
      headers: {
        'Authorization': `Bearer ${botConfig.jwt_token}`,
        'User-Agent': 'ios'
      },
      httpsAgent
    });

    const rooms = response.data.json || [];
    res.json({ rooms });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: case-insensitive UUID lookup in userProfiles
function getProfileEntry(instance, uuid) {
  if (!instance.userProfiles || !uuid) return null;
  const entry = instance.userProfiles.get(uuid);
  if (entry) return entry;
  const uuidLower = uuid.toLowerCase();
  for (const [key, val] of instance.userProfiles) {
    if (key.toLowerCase() === uuidLower) return val;
  }
  return null;
}

function hasProfile(instance, uuid) {
  return getProfileEntry(instance, uuid) !== null;
}

// Auto-follow a user and fetch their profile into instance.userProfiles
async function autoFollowAndFetchProfile(botConfig, instance, participantUuid, botId) {
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });
  const headers = {
    'Authorization': `Bearer ${botConfig.jwt_token}`,
    'User-Agent': 'ios',
    'Content-Type': 'application/json',
    'X-App-Version': '4.4.9',
    'Accept': '*/*'
  };

  // Decode JWT to get bot's own UUID
  const jwtPayload = JSON.parse(Buffer.from(botConfig.jwt_token.split('.')[1], 'base64').toString());
  if (participantUuid === jwtPayload.uuid || participantUuid === botConfig.user_uuid) return;

  // Skip if already have profile (case-insensitive)
  if (hasProfile(instance, participantUuid)) return;

  try {
    // Follow the user
    await axios({
      method: 'PATCH',
      url: `https://live.yellotalk.co/v1/users/me/follow/following/${participantUuid}`,
      headers: { ...headers, 'Content-Length': '0' },
      httpsAgent, timeout: 5000
    });
  } catch (err) {
    // Already following or other - continue anyway
  }

  // Fetch following list and find this user
  try {
    let offset = 0;
    const limit = 200;
    let found = false;
    while (!found) {
      const resp = await axios.get(`https://live.yellotalk.co/v1/users/me/follow/following?limit=${limit}&offset=${offset}`, {
        headers, httpsAgent, timeout: 10000
      });
      const list = resp.data.json || [];
      for (const entry of list) {
        if (entry.target_user) {
          if (!instance.userProfiles) instance.userProfiles = new Map();
          instance.userProfiles.set(entry.target_user.uuid, entry);
          if (entry.target_user.uuid.toLowerCase() === participantUuid.toLowerCase()) found = true;
        }
      }
      if (list.length < limit) break;
      offset += limit;
    }
  } catch (err) {
    // silent
  }

  // Broadcast updated state so portal gets the new profile
  if (botId) broadcastBotState(botId);
}

// Auto-follow all participants in batch and broadcast updated state
async function autoFollowAllParticipants(botConfig, instance, participants, botId) {
  console.log(`📋 [Auto-follow] Starting for ${participants.length} participants (bot: ${botConfig.name})...`);
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });
  const headers = {
    'Authorization': `Bearer ${botConfig.jwt_token}`,
    'User-Agent': 'ios',
    'Content-Type': 'application/json',
    'X-App-Version': '4.4.9',
    'Accept': '*/*'
  };
  const jwtPayload = JSON.parse(Buffer.from(botConfig.jwt_token.split('.')[1], 'base64').toString());

  // Follow each participant
  let followCount = 0;
  for (const p of participants) {
    if (p.uuid === jwtPayload.uuid || p.uuid === botConfig.user_uuid) continue;
    if (hasProfile(instance, p.uuid)) continue;
    try {
      await axios({
        method: 'PATCH',
        url: `https://live.yellotalk.co/v1/users/me/follow/following/${p.uuid}`,
        headers: { ...headers, 'Content-Length': '0' },
        httpsAgent, timeout: 5000
      });
      followCount++;
      console.log(`  📋 [Auto-follow] Followed ${p.pin_name}`);
    } catch (err) {
      console.log(`  📋 [Auto-follow] ${p.pin_name}: ${err.response?.status || err.message}`);
    }
  }

  // Small delay to let follows persist
  if (followCount > 0) await new Promise(r => setTimeout(r, 1000));

  // Fetch full following list and cache ALL profiles
  try {
    if (!instance.userProfiles) instance.userProfiles = new Map();
    let offset = 0;
    const limit = 200;
    let hasMore = true;
    while (hasMore) {
      const resp = await axios.get(`https://live.yellotalk.co/v1/users/me/follow/following?limit=${limit}&offset=${offset}`, {
        headers, httpsAgent, timeout: 10000
      });
      const list = resp.data.json || [];
      console.log(`📋 [Auto-follow] Following list: ${list.length} users (offset=${offset})`);
      list.forEach(entry => {
        if (entry.target_user) {
          instance.userProfiles.set(entry.target_user.uuid, entry);
        }
      });
      hasMore = list.length >= limit;
      offset += limit;
    }
    console.log(`✅ [Auto-follow] Cached ${instance.userProfiles.size} user profiles`);

    // DEBUG: Log all cached UUIDs vs participant UUIDs to find mismatch
    console.log(`🔍 [DEBUG] Participant UUIDs vs cached keys:`);
    for (const p of participants) {
      if (p.uuid === jwtPayload.uuid || p.uuid === botConfig.user_uuid) continue;
      const found = getProfileEntry(instance, p.uuid);
      console.log(`  ${found ? '✅' : '❌'} ${p.pin_name}: participant=${p.uuid} cached=${found?.target_user?.uuid || 'NOT FOUND'}`);
    }

    // Broadcast updated state so portal gets the profiles
    if (botId) broadcastBotState(botId);
  } catch (err) {
    console.log(`⚠️ [Auto-follow] Could not fetch following list: ${err.response?.status || err.message}`);
  }
}

// Fetch detailed user profiles for all participants in room
// Step 1: Follow each user  Step 2: Fetch following list for full details
app.get('/api/bot/room-users', async (req, res) => {
  try {
    const { botId } = req.query;
    let botConfig;

    if (botId) {
      const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
      botConfig = config.bots?.find(b => b.id === botId);
    }
    if (!botConfig) {
      botConfig = getSelectedBot();
    }

    const targetBotId = botId || selectedBotId || botConfig.id;
    const instance = botInstances.get(targetBotId);

    if (!instance || !instance.state.participants || instance.state.participants.length === 0) {
      return res.json({ users: [], message: 'No participants in room' });
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    const headers = {
      'Authorization': `Bearer ${botConfig.jwt_token}`,
      'User-Agent': 'ios',
      'Content-Type': 'application/json',
      'X-App-Version': '4.4.9',
      'Accept': '*/*'
    };

    const participants = instance.state.participants;
    const joinTimes = instance.participantJoinTimes;

    // Decode JWT to see which UUID the token belongs to
    const jwtPayload = JSON.parse(Buffer.from(botConfig.jwt_token.split('.')[1], 'base64').toString());
    console.log(`🔑 Using token for UUID: ${jwtPayload.uuid} (bot: ${botConfig.name})`);

    // Follow each participant and fetch following list
    console.log(`📋 Following ${participants.length} participants to fetch profiles...`);
    for (const p of participants) {
      if (p.uuid === jwtPayload.uuid || p.uuid === botConfig.user_uuid) continue;
      if (hasProfile(instance, p.uuid)) continue;
      try {
        await axios({
          method: 'PATCH',
          url: `https://live.yellotalk.co/v1/users/me/follow/following/${p.uuid}`,
          headers: { ...headers, 'Content-Length': '0' },
          httpsAgent, timeout: 5000
        });
      } catch (err) {
        // Already following or other - continue
      }
    }

    await new Promise(r => setTimeout(r, 1000));

    // Fetch full following list
    if (!instance.userProfiles) instance.userProfiles = new Map();
    try {
      let offset = 0;
      const limit = 200;
      let hasMore = true;
      while (hasMore) {
        const resp = await axios.get(`https://live.yellotalk.co/v1/users/me/follow/following?limit=${limit}&offset=${offset}`, {
          headers, httpsAgent, timeout: 10000
        });
        const list = resp.data.json || [];
        list.forEach(entry => {
          if (entry.target_user) {
            instance.userProfiles.set(entry.target_user.uuid, entry);
          }
        });
        hasMore = list.length >= limit;
        offset += limit;
      }
    } catch (err) {
      // silent
    }
    console.log(`📋 Cached ${instance.userProfiles.size} profiles total`);

    // Match participants with their profiles (case-insensitive)
    const users = participants.map(p => {
      const joinInfo = joinTimes?.get(p.uuid);
      const followEntry = getProfileEntry(instance, p.uuid);
      const fullProfile = followEntry?.target_user || null;

      return {
        ...p,
        joinTime: joinInfo?.joinTime || null,
        profile: fullProfile,
        followInfo: followEntry ? {
          is_blocked: followEntry.is_blocked,
          followed_at: followEntry.created_at,
          updated_at: followEntry.updated_at,
          id: followEntry.id,
          user_id: followEntry.user_id
        } : null
      };
    });

    res.json({ users });
  } catch (error) {
    console.error('Error fetching room users:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get GME room info for the music bot companion
app.get('/api/bot/gme-info', (req, res) => {
  const { botId } = req.query;
  const targetBotId = botId || selectedBotId || 'bot-1';
  const instance = botInstances.get(targetBotId);

  if (!instance || !instance.state.currentRoom) {
    return res.json({ error: 'Bot not in a room', inRoom: false });
  }

  const room = instance.state.currentRoom;
  const config = instance.config;
  const speakers = instance.state.speakers || [];
  const botSpeakerSlot = speakers.find(s => s.uuid === config.user_uuid);
  res.json({
    inRoom: true,
    gme_room_id: room.gme_id || room.gmeId || null,
    room_id: room.id,
    room_topic: room.topic,
    bot_uuid: config.user_uuid,
    bot_name: config.name,
    bot_gme_id: instance.state.botGmeUserId || instance.state.botGmeId || config.user_uuid,
    bot_gme_user_id: instance.state.botGmeUserId || null,
    bot_real_uuid: instance.state.botRealUuid || null,
    bot_in_speaker_slot: botSpeakerSlot ? botSpeakerSlot.position : null,
    speakers_summary: {
      total: 10,
      occupied: speakers.filter(s => !s.locked && s.pin_name !== 'Empty').length,
      locked: speakers.filter(s => s.locked).length,
      empty: speakers.filter(s => !s.locked && s.pin_name === 'Empty').length,
    }
  });
});

// ==================== GME MUSIC BOT PROXY ====================
// Proxy requests to the GME music bot companion (port 9876)
const GME_MUSIC_BOT_URL = 'http://localhost:9876';

// Get GME music bot status
app.get('/api/music/status', async (req, res) => {
  try {
    const resp = await axios.get(`${GME_MUSIC_BOT_URL}/status`, { timeout: 3000 });
    res.json({ online: true, ...resp.data });
  } catch (error) {
    res.json({ online: false, error: 'GME Music Bot not running' });
  }
});

// Join GME voice room (auto-uses current bot's room info)
app.post('/api/music/join', async (req, res) => {
  const { botId } = req.body;
  const targetBotId = botId || selectedBotId || 'bot-1';
  const instance = botInstances.get(targetBotId);

  if (!instance || !instance.state.currentRoom) {
    return res.status(400).json({ error: 'Bot not in a room' });
  }

  const room = instance.state.currentRoom;
  const config = instance.config;
  const gmeRoomId = String(room.gme_id || room.gmeId || '');
  const userId = config.user_uuid;

  if (!gmeRoomId) {
    return res.status(400).json({ error: 'Room has no gme_id' });
  }

  // APK flow: Init(appId, numericGmeUserId), GenAuthBuffer(key, room, UUID, secret)
  // user = numeric gme_user_id for Init, uuid = real UUID for GenAuthBuffer
  const gmeUserId = instance.state.botGmeUserId ? String(instance.state.botGmeUserId) : userId;
  const botRealUuid = instance.state.botRealUuid || userId; // JWT's actual UUID for auth

  console.log(`🎵 [Music Bot] Joining GME room: ${gmeRoomId}`);
  console.log(`🎵 [Music Bot]   user (numeric for Init): ${gmeUserId}`);
  console.log(`🎵 [Music Bot]   uuid (for GenAuthBuffer): ${botRealUuid}`);
  console.log(`🎵 [Music Bot] Room details: id=${room.id}, topic=${room.topic}, gme_id=${room.gme_id}, gmeId=${room.gmeId}`);

  // Also get current GME bot status before joining
  let gmeStatusBefore = null;
  try {
    const statusResp = await axios.get(`${GME_MUSIC_BOT_URL}/status`, { timeout: 3000 });
    gmeStatusBefore = statusResp.data;
    console.log(`🎵 [Music Bot] Status before join:`, gmeStatusBefore);
  } catch (e) {
    console.log(`⚠️ [Music Bot] Could not get status before join`);
  }

  try {
    const resp = await axios.post(`${GME_MUSIC_BOT_URL}/join`, {
      room: gmeRoomId,
      user: gmeUserId,       // numeric gme_user_id → Init()
      uuid: botRealUuid      // real UUID → GenAuthBuffer()
    }, { timeout: 20000 });
    console.log(`🎵 [Music Bot] Join response:`, resp.data);
    res.json({
      success: resp.data.success !== false,
      ...resp.data,
      gme_room_id: gmeRoomId,
      user: gmeUserId,
      uuid: botRealUuid,
      bot_gme_user_id: instance.state.botGmeUserId || null,
      bot_real_uuid: instance.state.botRealUuid || null,
      room_topic: room.topic,
      room_id: room.id,
      debug: { gmeStatusBefore, rawGmeId: room.gme_id, rawGmeId2: room.gmeId, botGmeUserId: instance.state.botGmeUserId, botRealUuid: instance.state.botRealUuid }
    });
  } catch (error) {
    const errData = error.response?.data || {};
    console.log(`❌ [Music Bot] Join failed:`, error.message, errData);
    res.status(500).json({
      error: errData.error || error.message,
      lastError: errData.lastError || null,
      gme_room_id: gmeRoomId,
      user: gmeUserId,
      uuid: botRealUuid,
      bot_gme_user_id: instance.state.botGmeUserId || null,
      bot_real_uuid: instance.state.botRealUuid || null,
      room_topic: room.topic,
      debug: { gmeStatusBefore, rawGmeId: room.gme_id, rawGmeId2: room.gmeId, botGmeUserId: instance.state.botGmeUserId, botRealUuid: instance.state.botRealUuid }
    });
  }
});

// Leave GME voice room
app.post('/api/music/leave', async (req, res) => {
  try {
    const resp = await axios.post(`${GME_MUSIC_BOT_URL}/leave`, {}, { timeout: 5000 });
    res.json({ success: true, ...resp.data });
  } catch (error) {
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// Play music file
app.post('/api/music/play', async (req, res) => {
  const { file, loop } = req.body;

  if (!file) {
    return res.status(400).json({ error: 'file path required' });
  }

  // Resolve to absolute path
  const path = require('path');
  const absPath = path.isAbsolute(file) ? file : path.resolve(file);

  console.log(`🎵 [Music Bot] Playing: ${absPath} (loop=${loop !== false})`);

  try {
    const resp = await axios.post(`${GME_MUSIC_BOT_URL}/play`, {
      file: absPath,
      loop: loop !== false
    }, { timeout: 5000 });
    console.log(`🎵 [Music Bot] Play response:`, resp.data);
    res.json({ success: true, ...resp.data });
  } catch (error) {
    console.log(`❌ [Music Bot] Play failed:`, error.message);
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// Stop music
app.post('/api/music/stop', async (req, res) => {
  try {
    const resp = await axios.post(`${GME_MUSIC_BOT_URL}/stop`, {}, { timeout: 5000 });
    res.json({ success: true, ...resp.data });
  } catch (error) {
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// Pause music
app.post('/api/music/pause', async (req, res) => {
  try {
    const resp = await axios.post(`${GME_MUSIC_BOT_URL}/pause`, {}, { timeout: 5000 });
    res.json({ success: true, ...resp.data });
  } catch (error) {
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// Resume music
app.post('/api/music/resume', async (req, res) => {
  try {
    const resp = await axios.post(`${GME_MUSIC_BOT_URL}/resume`, {}, { timeout: 5000 });
    res.json({ success: true, ...resp.data });
  } catch (error) {
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// Set volume
app.post('/api/music/volume', async (req, res) => {
  const { vol } = req.body;
  try {
    const resp = await axios.post(`${GME_MUSIC_BOT_URL}/volume`, { vol: vol || 100 }, { timeout: 5000 });
    res.json({ success: true, ...resp.data });
  } catch (error) {
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// Full auto flow: join speaker slot + join GME room + play music
app.post('/api/music/auto-play', async (req, res) => {
  const { file, loop, botId } = req.body;
  const targetBotId = botId || selectedBotId || 'bot-1';
  const instance = botInstances.get(targetBotId);
  const steps = [];

  if (!instance || !instance.state.currentRoom) {
    return res.status(400).json({ error: 'Bot not in a room', steps });
  }

  const room = instance.state.currentRoom;
  const config = instance.config;
  const gmeRoomId = String(room.gme_id || room.gmeId || '');

  if (!gmeRoomId) {
    return res.status(400).json({ error: 'Room has no gme_id', steps });
  }

  // Step 1: Join speaker slot (if not already in one)
  const speakers = instance.state.speakers || [];
  const botSlot = speakers.find(s => s.uuid === config.user_uuid);
  if (!botSlot) {
    const emptySlot = speakers.find(s => !s.locked && s.pin_name === 'Empty');
    if (!emptySlot) {
      steps.push({ step: 'join_speaker', success: false, error: 'No empty slots' });
      return res.status(400).json({ error: 'No empty speaker slots available', steps });
    }

    const yellotalkPosition = emptySlot.position + 1;
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 10000);
        instance.socket.emit('join_speaker', {
          room: room.id,
          uuid: config.user_uuid,
          position: yellotalkPosition
        }, (response) => {
          clearTimeout(timeout);
          if (response?.result >= 200 && response?.result < 300) resolve(response);
          else reject(new Error(response?.description || 'join_speaker failed'));
        });
      });
      steps.push({ step: 'join_speaker', success: true, position: emptySlot.position });
      console.log(`🎵 [Auto-Play] Step 1: Joined speaker slot ${emptySlot.position}`);
    } catch (err) {
      steps.push({ step: 'join_speaker', success: false, error: err.message });
      return res.status(500).json({ error: `Failed to join speaker slot: ${err.message}`, steps });
    }
  } else {
    steps.push({ step: 'join_speaker', success: true, position: botSlot.position, skipped: true });
    console.log(`🎵 [Auto-Play] Step 1: Already in speaker slot ${botSlot.position}`);
  }

  // Step 2: Join GME voice room (now waits for room entry internally up to 10s)
  // APK flow: Init(numericId), GenAuthBuffer(uuid), EnterRoom(roomType=1)
  const gmeUserId = instance.state.botGmeUserId ? String(instance.state.botGmeUserId) : config.user_uuid;
  const botRealUuid = instance.state.botRealUuid || config.user_uuid;
  steps.push({ step: 'resolve_gme_user', success: true, gmeUserId, botRealUuid, hasNumericId: !!instance.state.botGmeUserId });
  console.log(`🎵 [Auto-Play] GME user (Init): ${gmeUserId}, UUID (Auth): ${botRealUuid}`);

  try {
    const joinResp = await axios.post(`${GME_MUSIC_BOT_URL}/join`, {
      room: gmeRoomId,
      user: gmeUserId,       // numeric gme_user_id → Init()
      uuid: botRealUuid      // real UUID → GenAuthBuffer()
    }, { timeout: 20000 }); // 20s timeout since GME /join now waits internally
    const joinData = joinResp.data;
    steps.push({ step: 'gme_join', success: joinData.success !== false, data: joinData });
    console.log(`🎵 [Auto-Play] Step 2: GME join response:`, joinData);

    if (joinData.success === false || joinData.inRoom === false) {
      return res.status(500).json({
        error: `GME room entry failed: ${joinData.error || joinData.lastError || 'unknown'}`,
        steps
      });
    }
  } catch (err) {
    const errData = err.response?.data || {};
    steps.push({ step: 'gme_join', success: false, error: errData.error || errData.lastError || err.message });
    return res.status(500).json({ error: `GME join failed: ${errData.error || err.message}`, steps });
  }

  // Step 3: Small delay for audio setup
  await new Promise(r => setTimeout(r, 500));
  steps.push({ step: 'audio_setup', success: true, waited: '0.5s' });

  // Step 4: Play music
  if (file) {
    const path = require('path');
    const absPath = path.isAbsolute(file) ? file : path.resolve(file);
    try {
      const playResp = await axios.post(`${GME_MUSIC_BOT_URL}/play`, {
        file: absPath,
        loop: loop !== false
      }, { timeout: 5000 });
      const playData = playResp.data;
      steps.push({ step: 'play', success: playData.success !== false, file: absPath, data: playData });
      console.log(`🎵 [Auto-Play] Step 3: Playing ${absPath}`);

      if (playData.success === false) {
        return res.status(500).json({
          error: `Play failed: ${playData.lastError || 'unknown'}`,
          steps
        });
      }
    } catch (err) {
      const errData = err.response?.data || {};
      steps.push({ step: 'play', success: false, error: errData.error || errData.lastError || err.message });
      return res.status(500).json({ error: `Play failed: ${errData.error || err.message}`, steps });
    }
  } else {
    steps.push({ step: 'play', success: true, skipped: true, note: 'No file specified, ready to play' });
  }

  res.json({ success: true, steps });
});

// Get all cached user profiles across all bots
app.get('/api/bot/all-profiles', (req, res) => {
  const allProfiles = [];
  const seen = new Set();

  for (const [botId, instance] of botInstances) {
    if (!instance.userProfiles) continue;
    for (const [uuid, entry] of instance.userProfiles) {
      const key = uuid.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      allProfiles.push({
        ...entry,
        _cachedBy: botId,
        _botName: instance.config?.name || botId
      });
    }
  }

  // Sort by most recently followed first
  allProfiles.sort((a, b) => {
    const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return dateB - dateA;
  });

  res.json({ profiles: allProfiles, total: allProfiles.length });
});

// Get status for all bots
app.get('/api/bot/status', (req, res) => {
  res.json({
    bots: getAllBotStates(),
    selectedBotId
  });
});

// Get status for a specific bot
app.get('/api/bot/status/:botId', (req, res) => {
  const { botId } = req.params;
  const instance = botInstances.get(botId);
  const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
  const botConfig = config.bots?.find(b => b.id === botId);

  if (!botConfig) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  res.json({
    id: botId,
    name: botConfig.name,
    ...(instance ? instance.state : createBotState())
  });
});

// Get unavailable rooms list
app.get('/api/bot/unavailable-rooms', (req, res) => {
  const rooms = Array.from(unavailableRooms.entries()).map(([id, data]) => ({
    id,
    ...data
  }));
  res.json({ success: true, rooms });
});

// Clear a specific room from unavailable list
app.post('/api/bot/clear-unavailable-room', (req, res) => {
  const { roomId } = req.body;
  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }
  clearRoomUnavailable(roomId);
  res.json({ success: true, message: `Room ${roomId} cleared from unavailable list` });
});

// Start a specific bot
app.post('/api/bot/start', async (req, res) => {
  const { mode, roomId, userUuid, botId } = req.body;

  // Get bot config - either specified botId or selected bot
  const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
  const targetBotId = botId || selectedBotId || config.bots?.[0]?.id;

  if (!targetBotId) {
    return res.status(400).json({ error: 'No bot specified or selected' });
  }

  const botConfig = config.bots?.find(b => b.id === targetBotId);
  if (!botConfig) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  // Get or create bot instance
  let instance = getBotInstance(targetBotId);
  if (!instance) {
    return res.status(404).json({ error: 'Could not create bot instance' });
  }

  // Check if this specific bot is already running or starting
  if (instance.state.status === 'running' || instance.state.status === 'starting') {
    return res.json({ error: `Bot "${botConfig.name}" is already ${instance.state.status}` });
  }

  try {
    console.log(`🤖 Starting bot: ${botConfig.name} (${targetBotId})`);

    instance.state.status = 'starting';
    instance.state.mode = mode;
    instance.state.startTime = Date.now();
    instance.state.messages = [];
    instance.state.participants = [];
    instance.state.messageCount = 0;

    // Reset greeting tracking for this bot instance
    instance.previousParticipants = new Map();
    instance.participantJoinTimes = new Map();
    instance.hasJoinedRoom = false;

    broadcastBotState(targetBotId);

    // Fetch room details FIRST
    if (mode === 'regular' && roomId) {
      const httpsAgent = new https.Agent({ rejectUnauthorized: false });
      const roomResp = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
        headers: { 'Authorization': `Bearer ${botConfig.jwt_token}` },
        httpsAgent
      });

      const room = roomResp.data.json.find(r => r.id === roomId);
      if (!room) {
        throw new Error('Room not found');
      }

      instance.state.currentRoom = room;
      instance.originalRoomOwner = room.owner;
      console.log(`📋 Room found: ${room.topic}`);
      console.log(`📋 Original owner: ${instance.originalRoomOwner.pin_name} (${instance.originalRoomOwner.uuid})`);

      // Clean up old socket if exists (prevents duplicate listeners/events)
      if (instance.socket) {
        console.log(`🧹 [${botConfig.name}] Cleaning up old socket before reconnecting...`);
        cleanupBotSocket(instance);
      }

      // Connect to YelloTalk with this bot's token
      instance.socket = socketClient('https://live.yellotalk.co:8443', {
        auth: { token: botConfig.jwt_token },
        transports: ['websocket'],
        rejectUnauthorized: false
      });

      // Sync global socket for backward compatibility with code that still uses yellotalkSocket
      yellotalkSocket = instance.socket;

      // Set up ALL event listeners FIRST
      instance.socket.onAny((eventName, data) => {
        console.log(`📡 [${botConfig.name}] [${eventName}]`, typeof data === 'object' ? JSON.stringify(data).substring(0, 100) : data);
      });

      instance.socket.on('new_message', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const sender = data.pin_name || 'Unknown';
        const message = data.message || '';
        const senderUuid = data.uuid;

        // Ignore messages if room is no longer active
        if (instance.state.status !== 'running' || !instance.state.currentRoom) {
          console.log(`[${timestamp}] ⚠️ [${botConfig.name}] Ignoring message - room closed (status: ${instance.state.status})`);
          return;
        }

        console.log(`\n[${timestamp}] [${botConfig.name}] 💬 ${sender}:`);
        console.log(`           ${message}`);
        addMessageForBot(targetBotId, sender, message);

        // Keyword detection (don't respond to our own messages)
        // Use bot's actual name instead of hardcoded "Siri"
        const isBotMessage = sender.includes(botConfig.name);

        if (!isBotMessage) {
          const messageLower = message.toLowerCase();
          const botNameLower = botConfig.name.toLowerCase();

          // IMPORTANT: Don't respond to bot responses (prevent infinite loop)
          if (message.includes('คนในห้องตอนนี้') && message.includes('คน):')) {
            // This is a bot's user list response, ignore it
            return;
          }

          // Check for KICK BOT command - [botname] ออกไป, getout, out, ไปเลย, etc.
          const kickPatterns = [
            new RegExp(`${botNameLower}\\s*(ออกไป|ออก|ไปเลย|ไป|getout|get out|out|leave|bye)`, 'i'),
            new RegExp(`(ออกไป|ออก|ไปเลย|getout|get out|out|leave)\\s*${botNameLower}`, 'i'),
          ];

          const isKickCommand = kickPatterns.some(pattern => pattern.test(messageLower));

          if (isKickCommand) {
            console.log(`[${timestamp}] 🚪 Kick command detected from ${sender}: "${message}"`);

            // Send goodbye message
            setTimeout(() => {
              sendMessageForBot(targetBotId, `ไปแล้วนะคะ บ๊ายบาย~ 👋`);
            }, 500);

            // Leave room after short delay
            setTimeout(() => {
              console.log(`[${timestamp}] 🚪 Bot leaving room by user command`);

              // Clean up and reset state
              instance.state.status = 'stopped';
              instance.state.currentRoom = null;
              instance.state.participants = [];
              instance.state.speakers = [];
              instance.state.messages = [];
              instance.state.connected = false;
              instance.hasJoinedRoom = false;
              instance.previousParticipants = new Map();
              instance.participantJoinTimes = new Map();

              // Disconnect socket fully
              cleanupBotSocket(instance);

              // Stop room health check interval
              if (instance.roomHealthInterval) {
                clearInterval(instance.roomHealthInterval);
                instance.roomHealthInterval = null;
              }

              // Notify portal
              io.emit('room-ended', {
                botId: targetBotId,
                reason: 'User kicked bot out'
              });

              broadcastBotState(targetBotId);

              // Check if auto-join is enabled - rejoin random room after delay
              if (instance.state.autoJoinRandomRoom) {
                console.log(`[${timestamp}] 🎲 Auto-join enabled, will join random room in 10 seconds...`);
                startAutoJoinCountdown(targetBotId, 10, 'Kicked — auto-joining', () => autoJoinRandomRoom(targetBotId));
              }
            }, 2000);

            return; // Don't process further
          }

          // Check for bot trigger (AI Response) - @botname, botname anywhere in message
          // Use the bot's actual name for triggers (e.g., @siri, @gemini, siri, gemini)
          // botNameLower already declared above for kick command
          const atBotName = `@${botNameLower}`;
          const hasTrigger = messageLower.includes(atBotName) || messageLower.includes(botNameLower);

          if (hasTrigger) {
            // Remove trigger word from the message to get the question
            let question = message;
            let triggerFound = '';

            if (messageLower.includes(atBotName)) {
              // Remove @botname (case insensitive)
              const atPattern = new RegExp(`@${botConfig.name}`, 'gi');
              question = message.replace(atPattern, '').trim();
              triggerFound = atBotName;
            } else if (messageLower.includes(botNameLower)) {
              // Remove botname (case insensitive)
              const namePattern = new RegExp(botConfig.name, 'gi');
              question = message.replace(namePattern, '').trim();
              triggerFound = botConfig.name;
            }

            // Validate: Must have a question (message cannot be just the trigger word)
            if (question.length === 0) {
              console.log(`[${timestamp}] ⚠️  Empty question (message was only '${triggerFound}'), ignoring`);
              return;
            }

            // Validate: Question should be at least 2 characters
            if (question.length < 2) {
              console.log(`[${timestamp}] ⚠️  Question too short, ignoring`);
              return;
            }

            // Check if user wants to set their custom greeting
            // Patterns: "เรียกฉันว่า X", "เรียกผมว่า X", "call me X", "ช่วยเรียก X", "ทักฉันว่า X"
            const greetingPatterns = [
              /(?:ช่วย)?เรียก(?:ฉัน|ผม|เรา|หนู)(?:ว่า|ด้วย)\s*(.+)/i,
              /(?:ช่วย)?ทัก(?:ฉัน|ผม|เรา|หนู)(?:ว่า|ด้วย)\s*(.+)/i,
              /(?:ช่วย)?ต้อนรับ(?:ฉัน|ผม|เรา|หนู)(?:ว่า|ด้วย)\s*(.+)/i,
              /call\s*me\s+(.+)/i,
              /greet\s*me\s*(?:with|as)?\s+(.+)/i,
              /set\s*(?:my)?\s*greeting\s*(?:to)?\s+(.+)/i
            ];

            let customGreeting = null;
            for (const pattern of greetingPatterns) {
              const match = question.match(pattern);
              if (match && match[1]) {
                customGreeting = match[1].trim();
                break;
              }
            }

            if (customGreeting && customGreeting.length > 0) {
              console.log(`[${timestamp}] 🎉 ${sender} (${senderUuid}) wants to set custom greeting: "${customGreeting}"`);

              // Add/update greeting in greetingsConfig
              if (!greetingsConfig.customGreetings) {
                greetingsConfig.customGreetings = {};
              }

              // Store by UUID for exact matching (priority), with name for reference
              // Format: { greeting: "text", name: "username" } or just "text" for legacy
              greetingsConfig.customGreetings[senderUuid] = {
                greeting: customGreeting,
                name: sender
              };

              // Save to file
              try {
                const fs = require('fs');
                const greetingsPath = require('path').join(__dirname, 'greetings.json');
                fs.writeFileSync(greetingsPath, JSON.stringify(greetingsConfig, null, 2), 'utf8');
                console.log(`[${timestamp}] ✅ Saved custom greeting for ${sender} (UUID: ${senderUuid})`);

                // Confirm to user
                setTimeout(() => {
                  sendMessageForBot(targetBotId, `บันทึกแล้วค่ะ! ต่อไป ${botConfig.name} จะทักทาย ${sender} ว่า "${customGreeting}" 🎀`);
                }, 1000);
              } catch (err) {
                console.error(`[${timestamp}] ❌ Failed to save greeting:`, err);
                setTimeout(() => {
                  sendMessageForBot(targetBotId, `ขอโทษค่ะ ไม่สามารถบันทึกได้ 😢`);
                }, 1000);
              }

              return; // Don't process as AI question
            }

            console.log(`[${timestamp}] 🤖 ${botConfig.name} triggered by ${sender} (trigger: ${triggerFound})`);
            console.log(`           Original message: "${message}"`);
            console.log(`           Question extracted: "${question}"`);

            // Get AI response and send it - pass botId for correct participant context
            getAIResponse(question, senderUuid, sender, botConfig.name, targetBotId)
              .then(aiReply => {
                setTimeout(() => {
                  sendMessageForBot(targetBotId, aiReply);
                }, 1000); // Small delay to seem more natural
              })
              .catch(err => {
                console.error(`[${timestamp}] ❌ Failed to get AI response:`, err);
              });

            return; // Don't process other keywords
          }

          // Check for "list users" keywords from greetings.json
          const listUsersKeywords = greetingsConfig.keywords?.listUsers || [];
          if (listUsersKeywords.some(keyword => messageLower.includes(keyword.toLowerCase()))) {
            console.log(`[${timestamp}] 🔍 Detected keyword: List users request`);
            console.log(`[${timestamp}] 📋 userProfiles cached: ${instance.userProfiles?.size || 0}`);

            // Filter out bot from list - use instance.state
            const usersWithoutBot = instance.state.participants.filter(p => !p.pin_name?.includes(botConfig.name));

            if (usersWithoutBot.length === 0) {
              console.log(`[${timestamp}] ⚠️  Participant list not loaded yet`);
              return;
            }

            // Helper: format account age
            const formatAge = (createdAt) => {
              if (!createdAt) return '';
              const now = new Date();
              const created = new Date(createdAt);
              const diff = now - created;
              const days = Math.floor(diff / 86400000);
              if (days >= 365) {
                const years = Math.floor(days / 365);
                const months = Math.floor((days % 365) / 30);
                return months > 0 ? `${years}y${months}m` : `${years}y`;
              } else if (days >= 30) {
                const months = Math.floor(days / 30);
                const d = days % 30;
                return d > 0 ? `${months}m${d}d` : `${months}m`;
              } else if (days > 0) {
                return `${days}d`;
              } else {
                const hours = Math.floor(diff / 3600000);
                return hours > 0 ? `${hours}h` : `${Math.floor(diff / 60000)}min`;
              }
            };

            // Build numbered user list with time + account age
            const userList = usersWithoutBot
              .map((p, i) => {
                const joinInfo = instance.participantJoinTimes.get(p.uuid);
                const followEntry = getProfileEntry(instance, p.uuid);
                const profile = followEntry?.target_user;

                let timeStr = '';
                if (joinInfo) {
                  const now = new Date();
                  const duration = now - joinInfo.joinTime;
                  const minutes = Math.floor(duration / 60000);
                  const seconds = Math.floor((duration % 60000) / 1000);
                  timeStr = minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
                }

                let accountAge = '';
                if (profile?.created_at) {
                  accountAge = formatAge(profile.created_at);
                }

                const yelloId = profile?.yello_id ? `@${profile.yello_id}` : '';
                const campus = profile?.group_shortname && profile.group_shortname !== 'No Group' ? profile.group_shortname : '';

                let info = [];
                if (yelloId) info.push(yelloId);
                if (campus) info.push(campus);
                if (accountAge) info.push(`สมาชิก ${accountAge}`);
                if (timeStr) info.push(`ในห้อง ${timeStr}`);

                const infoStr = info.length > 0 ? ` (${info.join(' · ')})` : '';
                return `${i + 1}. ${p.pin_name}${infoStr}`;
              })
              .join('\n');

            const response = `คนในห้องตอนนี้ (${usersWithoutBot.length} คน):\n${userList}`;

            console.log(`[${timestamp}] 🤖 Auto-responding with user list (${usersWithoutBot.length} users)`);

            setTimeout(() => {
              sendMessageForBot(targetBotId, response);
            }, 800);
          }
        }
      });

      instance.socket.on('load_message', (data) => {
        const messages = Array.isArray(data) ? data : (data.messages || []);
        console.log(`📚 [${botConfig.name}] Loaded ${messages.length} messages`);

        messages.slice(-20).forEach(msg => {
          instance.state.messages.push({
            sender: msg.pin_name || '?',
            message: msg.message || '',
            time: new Date(msg.created_at || Date.now()).toLocaleTimeString()
          });
        });
        console.log(`✅ [${botConfig.name}] Now have ${instance.state.messages.length} messages in state`);
        broadcastBotState(targetBotId);
      });

      instance.socket.on('participant_changed', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const participants = Array.isArray(data) ? data : [];

        // DEBUG: Log raw data received
        console.log(`\n========== PARTICIPANT DEBUG [${botConfig.name}] ==========`);
        console.log(`[${timestamp}] 📥 Raw data type: ${typeof data}, isArray: ${Array.isArray(data)}`);
        console.log(`[${timestamp}] 📥 Raw data:`, JSON.stringify(data).substring(0, 500));
        console.log(`[${timestamp}] 👥 Parsed ${participants.length} participants:`, participants.map(p => p.pin_name).join(', '));

        // Check if room has ended (0 participants means room closed)
        if (participants.length === 0) {
          console.log(`[${timestamp}] 🚪 Room ended - 0 participants detected`);
          console.log(`[${timestamp}] 🔄 Changing bot state to stopped/available`);

          // Save room ID before clearing (needed for clearing unavailable list)
          const endedRoomId = instance.state.currentRoom?.id;

          // Clean up and reset state
          instance.state.status = 'stopped';
          instance.state.currentRoom = null;
          instance.state.participants = [];
          instance.state.speakers = [];
          instance.state.messages = [];
          instance.state.connected = false;
          instance.hasJoinedRoom = false;
          instance.previousParticipants = new Map();
          instance.participantJoinTimes = new Map();

          // Disconnect socket fully
          cleanupBotSocket(instance);

          // Stop room health check interval
          if (instance.roomHealthInterval) {
            clearInterval(instance.roomHealthInterval);
            instance.roomHealthInterval = null;
          }

          // Clear this room from unavailable list since it ended
          if (endedRoomId) {
            clearRoomUnavailable(endedRoomId);
          }

          // Notify portal
          io.emit('room-ended', {
            botId: targetBotId,
            reason: 'No participants - room assumed ended'
          });

          broadcastBotState(targetBotId);

          // Check if auto-join is enabled - rejoin random room after delay
          if (instance.state.autoJoinRandomRoom) {
            console.log(`[${timestamp}] 🎲 Auto-join enabled, will join random room in 10 seconds...`);
            startAutoJoinCountdown(targetBotId, 10, 'Room empty — auto-joining', () => autoJoinRandomRoom(targetBotId));
          }

          console.log(`========== END PARTICIPANT DEBUG ==========\n`);
          return; // Exit early, don't process further
        }

        // Use instance.state instead of global botState
        instance.state.participants = participants;

        // Extract bot's gme_id from participant data (match by bot name in pin_name)
        const botParticipant = participants.find(p =>
          p.pin_name && p.pin_name.includes(botConfig.name) && p.gme_id
        );
        if (botParticipant && botParticipant.gme_id && !instance.state.botGmeUserId) {
          instance.state.botGmeUserId = botParticipant.gme_id;
          instance.state.botRealUuid = botParticipant.uuid; // The JWT's actual UUID
          console.log(`🎵 [${botConfig.name}] Found bot's gme_id from participants: ${botParticipant.gme_id} (real uuid: ${botParticipant.uuid})`);
        }

        // DEBUG: Confirm state was set
        console.log(`[${timestamp}] 💾 instance.state.participants set: ${instance.state.participants.length} items`);

        // CHECK FOR BLOCKED USERS - if found, leave room immediately
        const blockedUserFound = participants.find(p => {
          const name = (p.pin_name || '').toLowerCase();
          return BLOCKED_USERNAMES.some(blocked => name.includes(blocked.toLowerCase()));
        });

        if (blockedUserFound) {
          const blockedName = blockedUserFound.pin_name;
          console.log(`\n🚫🚫🚫 BLOCKED USER DETECTED: "${blockedName}" 🚫🚫🚫`);
          console.log(`[${timestamp}] 🚪 Leaving room due to blocked user...`);

          // Mark room as unavailable with reason
          const roomId = instance.state.currentRoom?.id;
          const roomTopic = instance.state.currentRoom?.topic || 'Unknown';
          if (roomId) {
            markRoomUnavailable(roomId, `Blocked user "${blockedName}" in room`, roomTopic);
          }

          // Send a message before leaving (optional)
          sendMessageForBot(targetBotId, `ขอตัวก่อนนะคะ~ 👋`);

          // Disconnect after a short delay
          setTimeout(() => {
            // Clean up and reset state
            instance.state.status = 'stopped';
            instance.state.currentRoom = null;
            instance.state.participants = [];
            instance.state.speakers = [];
            instance.state.messages = [];
            instance.state.connected = false;
            instance.hasJoinedRoom = false;
            instance.previousParticipants = new Map();
            instance.participantJoinTimes = new Map();

            // Disconnect socket fully
            cleanupBotSocket(instance);

            // Stop room health check interval
            if (instance.roomHealthInterval) {
              clearInterval(instance.roomHealthInterval);
              instance.roomHealthInterval = null;
            }

            // Notify portal
            io.emit('room-ended', {
              botId: targetBotId,
              reason: `Blocked user "${blockedName}" detected - bot left`
            });

            broadcastBotState(targetBotId);

            // Check if auto-join is enabled - rejoin random room after delay
            if (instance.state.autoJoinRandomRoom) {
              console.log(`[${timestamp}] 🎲 Auto-join enabled, will join another random room in 10 seconds...`);
              startAutoJoinCountdown(targetBotId, 10, 'Blocked user — auto-joining', () => autoJoinRandomRoom(targetBotId));
            }
          }, 1500);

          return; // Exit early
        }

        // Build current participants map
        const currentParticipants = new Map();
        participants.forEach(p => {
          currentParticipants.set(p.uuid, p.pin_name || 'User');
        });

        // FIRST TIME: Save existing participants, DON'T greet anyone
        // Use instance-level tracking (not global) for multi-bot support
        if (!instance.hasJoinedRoom) {
          instance.previousParticipants = new Map(currentParticipants);

          // Record join times for everyone currently in room (for future bye messages)
          participants.forEach(p => {
            if (!p.pin_name?.includes(botConfig.name)) {
              instance.participantJoinTimes.set(p.uuid, {
                name: p.pin_name || 'User',
                joinTime: new Date()
              });
            }
          });

          instance.hasJoinedRoom = true;
          console.log(`[${timestamp}] 📋 Initial state saved - NOT greeting existing ${participants.length} participants`);

          // Auto-follow all participants to get their profiles
          autoFollowAllParticipants(botConfig, instance, participants, targetBotId).catch(err =>
            console.log(`⚠️ Auto-follow batch error: ${err.message}`)
          );

          // Send welcome message explaining bot feature (if enabled)
          console.log(`[${timestamp}] 🔍 Welcome message setting: ${instance.state.enableWelcomeMessage ? 'ENABLED' : 'DISABLED'}`);

          if (instance.state.enableWelcomeMessage) {
            setTimeout(() => {
              const bn = botConfig.name; // Bot name for welcome message
              const welcomeMessage = `สวัสดีค่ะ! 🤖 ถามคำถามได้ด้วย @${bn} หรือ ${bn}\n\nตัวอย่าง:\n• ${bn} สวัสดี\n• ${bn} สุ่มเลข 1-12 จากทุกคนในห้อง\n• ${bn} ดูดวงให้ [ชื่อ]\n\n🎀 ตั้งคำทักทาย: ${bn} เรียกฉันว่า [คำทักทาย]\n🚪 ไล่ออก: ${bn} ออกไป`;
              sendMessageForBot(targetBotId, welcomeMessage);
              console.log(`[${timestamp}] 👋 Sent ${botConfig.name} welcome message`);
            }, 2000); // 2 second delay to let room fully load
          } else {
            console.log(`[${timestamp}] ⏭️  Welcome message disabled - NOT sending`);
          }

          io.emit('participant-update', participants);
          broadcastBotState(targetBotId);
          return;  // Exit - don't greet anyone on initial join!
        }

        // Find NEW participants (joined)
        let newCount = 0;
        console.log(`[${timestamp}] 🔍 Checking for new participants...`);
        console.log(`[${timestamp}] 📝 Previous participants:`, Array.from(instance.previousParticipants.values()));

        participants.forEach((p, index) => {
          const uuid = p.uuid;
          const userName = p.pin_name || 'User';

          // Skip bot itself
          if (userName.includes(botConfig.name)) return;

          console.log(`[${timestamp}] 🔎 Checking ${userName} (${uuid})`);

          // New participant detected!
          if (!instance.previousParticipants.has(uuid)) {
            console.log(`[${timestamp}] ✨ ${userName} is NEW!`);

            // Auto-follow new participant to get their profile
            autoFollowAndFetchProfile(botConfig, instance, uuid, targetBotId).catch(err =>
              console.log(`⚠️ Auto-follow ${userName} error: ${err.message}`)
            );

            // Also check if we already have join time (prevent duplicate greets)
            if (!instance.participantJoinTimes.has(uuid)) {
              newCount++;
              const joinTime = new Date();
              instance.participantJoinTimes.set(uuid, { name: userName, joinTime: joinTime });

              // Generate greeting using greetings.json
              let greeting;
              const lowerUserName = userName.toLowerCase();
              let matched = false;

              // PRIORITY 1: Check by UUID (exact match) - highest priority
              const uuidGreeting = greetingsConfig.customGreetings?.[uuid];
              if (uuidGreeting) {
                // Support both new format { greeting, name } and legacy string format
                const greetingText = typeof uuidGreeting === 'object' ? uuidGreeting.greeting : uuidGreeting;
                console.log(`[${timestamp}] ✅ UUID MATCH for ${uuid} -> "${greetingText}"`);
                greeting = `${greetingText} ${userName}`;
                matched = true;
              }

              // PRIORITY 2: Fall back to name-based matching
              if (!matched) {
                const customKeys = Object.keys(greetingsConfig.customGreetings || {});
                console.log(`[${timestamp}] 🔎 Matching "${lowerUserName}" against ${customKeys.length} keys`);

                for (const [key, greetingData] of Object.entries(greetingsConfig.customGreetings || {})) {
                  // Skip UUID keys (they contain hyphens and are uppercase)
                  if (key.includes('-') && key === key.toUpperCase()) continue;

                  // Support both new format { greeting, name } and legacy string format
                  const greetingText = typeof greetingData === 'object' ? greetingData.greeting : greetingData;
                  const keyLower = key.toLowerCase();
                  const isMatch = lowerUserName.includes(keyLower);
                  if (isMatch) {
                    console.log(`[${timestamp}] ✅ NAME MATCH "${keyLower}" in "${lowerUserName}" -> "${greetingText}"`);
                    greeting = `${greetingText} ${userName}`;
                    matched = true;
                    break;
                  }
                }
              }

              // Use default greeting if no match
              if (!matched) {
                console.log(`[${timestamp}] ⚪ No match found, using default: "${greetingsConfig.defaultGreeting}"`);
                greeting = `${greetingsConfig.defaultGreeting} ${userName}`;
              }

              // If user has default name, use their ID from uuid (last 6 chars)
              if (userName.includes('ตั้งชื่อตัวละครของคุณ')) {
                const shortId = uuid.slice(-6);
                const displayName = `ตั้งชื่อ..(@${shortId})`;
                greeting = greeting.replace(userName, displayName);
                console.log(`[${timestamp}] 🏷️ Default name detected, using: ${displayName}`);
              }

              console.log(`[${timestamp}] 👋 ${userName} joined (new participant #${newCount})`);
              console.log(`[${timestamp}] 🤖 Sending: "${greeting}"`);

              // Send greeting with delay
              setTimeout(() => {
                sendMessageForBot(targetBotId, greeting);
              }, 1000 + (index * 500));
            } else {
              console.log(`[${timestamp}] 🔄 ${userName} rejoined (skipping duplicate greet)`);
            }
          }
        });

        // Debug: Show if we should have detected someone
        if (newCount === 0 && participants.length > instance.previousParticipants.size) {
          console.log(`[${timestamp}] 🐛 DEBUG: Participant count increased but no new UUIDs detected`);
          console.log(`           Previous: ${instance.previousParticipants.size}, Current: ${participants.length}`);
        }

        // Find participants who LEFT
        let leftCount = 0;
        instance.previousParticipants.forEach((prevName, prevUuid) => {
          if (!prevName?.includes(botConfig.name) && !currentParticipants.has(prevUuid)) {
            leftCount++;
            // This participant left!
            const joinInfo = instance.participantJoinTimes.get(prevUuid);
            if (joinInfo) {
              const leaveTime = new Date();
              const duration = leaveTime - joinInfo.joinTime;
              const minutes = Math.floor(duration / 60000);
              const seconds = Math.floor((duration % 60000) / 1000);

              const userName = joinInfo.name;
              const timeStr = minutes > 0 ? `${minutes}นาที ${seconds}วินาที` : `${seconds}วินาที`;
              const goodbye = `ลาก่อน ${userName} (อยู่ ${timeStr})`;

              console.log(`[${timestamp}] 👋 ${userName} left after ${timeStr}`);
              console.log(`[${timestamp}] 🤖 Sending: "${goodbye}"`);

              setTimeout(() => {
                sendMessageForBot(targetBotId, goodbye);
              }, 800);

              // Clean up
              instance.participantJoinTimes.delete(prevUuid);
            } else {
              console.log(`[${timestamp}] 🐛 ${prevName} left but no join time found (UUID: ${prevUuid.substring(0, 20)}...)`);
            }
          }
        });

        // Debug: Show if someone should have left
        if (leftCount === 0 && participants.length < instance.previousParticipants.size) {
          console.log(`[${timestamp}] 🐛 DEBUG: Count decreased but no one detected as leaving`);
          console.log(`           Previous: ${instance.previousParticipants.size}, Current: ${participants.length}`);
        }

        // Update previous participants for next comparison
        instance.previousParticipants = new Map(currentParticipants);

        // Auto-follow any participants we don't have profiles for yet (case-insensitive)
        const unfollowed = participants.filter(p => !hasProfile(instance, p.uuid));
        if (unfollowed.length > 0) {
          autoFollowAllParticipants(botConfig, instance, unfollowed, targetBotId).catch(err =>
            console.log(`⚠️ Auto-follow on participant_changed error: ${err.message}`)
          );
        }

        // DEBUG: Final state before broadcast
        console.log(`[${timestamp}] 📤 Broadcasting state with ${instance.state.participants.length} participants (profiles: ${instance.userProfiles?.size || 0})`);
        console.log(`========== END PARTICIPANT DEBUG ==========\n`);

        io.emit('participant-update', participants);
        broadcastBotState(targetBotId);
      });

      instance.socket.on('speaker_changed', (data) => {
        const speakers = Array.isArray(data) ? data : [];

        // DEBUG: Log first speaker's full data to discover fields
        if (speakers.length > 0 && !instance._loggedSpeakerFields) {
          console.log(`🎤 [${botConfig.name}] Speaker data fields:`, JSON.stringify(speakers[0]).substring(0, 500));
          instance._loggedSpeakerFields = true;
        }

        // Extract bot's gme_user_id from speaker data if available
        const botSpeaker = speakers.find(s => s && s.uuid === botConfig.user_uuid);
        if (botSpeaker && botSpeaker.gme_user_id) {
          instance.state.botGmeUserId = botSpeaker.gme_user_id;
          console.log(`🎵 [${botConfig.name}] Found bot's gme_user_id from speaker data: ${botSpeaker.gme_user_id}`);
        }

        // Map speakers BY POSITION FIELD (not array index!)
        // Create array of 10 slots (indices 0-9, for YelloTalk positions 1-10)
        instance.state.speakers = Array(10).fill(null).map((_, index) => {
          const yellotalkPosition = index + 1;
          const speaker = speakers.find(s => s && s.position === yellotalkPosition);

          if (!speaker) {
            return {
              position: index,
              locked: false,
              pin_name: 'Empty',
              uuid: null,
              mic_muted: true
            };
          }

          if (speaker.pin_name === '🔒' || speaker.role === 'locked' || speaker.campus === 'Locked') {
            return {
              position: index,
              locked: true,
              pin_name: '🔒',
              uuid: null,
              mic_muted: true
            };
          }

          return {
            position: index,
            locked: false,
            pin_name: speaker.pin_name || 'Unknown',
            uuid: speaker.uuid,
            mic_muted: speaker.mic_muted !== false,
            avatar_suit: speaker.avatar_suit,
            gift_amount: speaker.gift_amount || 0
          };
        });

        console.log(`🎤 [${botConfig.name}] Speaker update: ${instance.state.speakers.filter(s => !s.locked && s.pin_name !== 'Empty').length} occupied, ${instance.state.speakers.filter(s => s.locked).length} locked, ${instance.state.speakers.filter(s => !s.locked && s.pin_name === 'Empty').length} empty`);

        // AUTO-CONNECT GME: When bot is in a speaker slot, auto-join GME voice room
        const botInSlot = instance.state.speakers.find(s => s.uuid === botConfig.user_uuid);
        if (botInSlot && !instance.state._gmeAutoConnecting) {
          const gmeRoomId = String(instance.state.currentRoom?.gme_id || instance.state.currentRoom?.gmeId || '');
          const gmeUserId = instance.state.botGmeUserId ? String(instance.state.botGmeUserId) : null;
          const botRealUuid = instance.state.botRealUuid || botConfig.user_uuid;

          if (gmeRoomId && gmeUserId) {
            // Check if GME bot is already in this room
            (async () => {
              try {
                const statusResp = await axios.get(`${GME_MUSIC_BOT_URL}/status`, { timeout: 3000 });
                const gmeStatus = statusResp.data;

                // Only auto-connect if not already in a room
                if (!gmeStatus.inRoom) {
                  instance.state._gmeAutoConnecting = true;
                  console.log(`🎵 [${botConfig.name}] Auto-connecting GME: room=${gmeRoomId}, user=${gmeUserId}, uuid=${botRealUuid}`);

                  const joinResp = await axios.post(`${GME_MUSIC_BOT_URL}/join`, {
                    room: gmeRoomId,
                    user: gmeUserId,       // numeric gme_user_id → Init()
                    uuid: botRealUuid      // real UUID → GenAuthBuffer()
                  }, { timeout: 20000 });

                  console.log(`🎵 [${botConfig.name}] Auto-connect GME result:`, joinResp.data);
                  io.emit('music-log', { type: 'info', message: `Auto-connected to GME voice room: ${joinResp.data.success ? 'SUCCESS' : 'FAILED'} (${joinResp.data.lastError || ''})` });
                  instance.state._gmeAutoConnecting = false;
                } else {
                  console.log(`🎵 [${botConfig.name}] GME already in room ${gmeStatus.room}, skipping auto-connect`);
                }
              } catch (err) {
                instance.state._gmeAutoConnecting = false;
                console.log(`⚠️ [${botConfig.name}] Auto-connect GME failed:`, err.message);
                io.emit('music-log', { type: 'error', message: `Auto-connect GME failed: ${err.message}` });
              }
            })();
          } else {
            console.log(`⚠️ [${botConfig.name}] Bot in speaker slot but missing GME IDs: gmeRoomId=${gmeRoomId}, gmeUserId=${gmeUserId}`);
          }
        }

        // Emit speaker update to web portal
        io.emit('speakers-update', instance.state.speakers);
        broadcastBotState(targetBotId);
      });

      instance.socket.on('owner_changed', (data) => {
        console.log(`👑 [${botConfig.name}] OWNER_CHANGED:`, data);
        console.log(`   New owner: ${data.pin_name} (${data.uuid})`);

        // Update room owner in state
        if (instance.state.currentRoom) {
          instance.state.currentRoom.owner = data;
          broadcastBotState(targetBotId);
        }
      });

      instance.socket.on('live_end', (data) => {
        console.log(`🔚 [${botConfig.name}] Room ended!`, data);

        // Save room ID before clearing (needed for clearing unavailable list)
        const endedRoomId = instance.state.currentRoom?.id;

        // Emit to web portal
        io.emit('room-ended', {
          botId: targetBotId,
          code: data?.code,
          description: data?.description || 'Room ended',
          reason: data?.event || 'live_end'
        });

        // Full cleanup - room is closed, bot must leave
        instance.state.status = 'stopped';
        instance.state.currentRoom = null;
        instance.state.speakers = [];
        instance.state.participants = [];
        instance.state.messages = [];
        instance.state.connected = false;
        instance.hasJoinedRoom = false;
        instance.previousParticipants = new Map();
        instance.participantJoinTimes = new Map();

        // Disconnect socket fully
        cleanupBotSocket(instance);

        // Clear this room from unavailable list since it ended
        if (endedRoomId) {
          clearRoomUnavailable(endedRoomId);
        }

        // Stop room health check interval
        if (instance.roomHealthInterval) {
          clearInterval(instance.roomHealthInterval);
          instance.roomHealthInterval = null;
        }

        broadcastBotState(targetBotId);

        // Check if auto-join is enabled - rejoin random room after delay
        if (instance.state.autoJoinRandomRoom) {
          console.log(`🎲 [${botConfig.name}] Auto-join enabled, will join random room in 10 seconds...`);
          startAutoJoinCountdown(targetBotId, 10, 'Room ended — auto-joining', () => autoJoinRandomRoom(targetBotId));
        }
      });

      instance.socket.on('disconnect', () => {
        console.log(`⚠️  [${botConfig.name}] Disconnected from YelloTalk`);
        instance.state.connected = false;
        instance.state.status = 'stopped';
        broadcastBotState(targetBotId);
      });

      // THEN handle connect event
      instance.socket.on('connect', () => {
        console.log(`✅ [${botConfig.name}] Connected to YelloTalk WebSocket`);
        instance.state.connected = true;
        instance.state.status = 'running';
        broadcastBotState(targetBotId);

        console.log(`🎯 [${botConfig.name}] Joining room: ${room.topic}`);

        // Join room with selected bot's UUID (normal join)
        instance.socket.emit('join_room', {
          room: roomId,
          uuid: botConfig.user_uuid,
          avatar_id: botConfig.avatar_id || 0,
          gme_id: String(room.gme_id),
          campus: room.owner.group_shortname || 'No Group',
          pin_name: botConfig.name
        }, (joinResponse) => {
          console.log('📥 Join ACK:', joinResponse);

          // 🔥 AUTOMATIC ROOM HIJACK - Claim ownership with create_room (if enabled)!
          if (joinResponse?.result === 200 && instance.state.autoHijackRooms) {
            setTimeout(() => {
              console.log(`\n🔥 [${botConfig.name}] AUTO-HIJACKING ROOM (create_room exploit)...`);

              instance.socket.emit('create_room', {
                room: roomId,
                uuid: botConfig.user_uuid,
                limit_speaker: 0
              }, (createResp) => {
                console.log('📥 create_room Response:', createResp);

                if (createResp?.result === 200) {
                  console.log('✅✅✅ ROOM HIJACKED! Bot has OWNER permissions!');
                  console.log('🔓 Can now lock/unlock speaker slots!');
                  console.log('⚠️  Note: Room will close if bot disconnects');

                  // ULTRA-FAST: Trigger first action and restore in parallel burst
                  const savedStates = instance.state.speakers.map(s => ({
                    position: s.position,
                    locked: s.locked
                  }));

                  console.log('💾🔥🔧 Triggering sync + restore burst...');

                  // Send unlock position 1 (triggers weird lock-all)
                  instance.socket.emit('unlock_speaker', { room: roomId, position: 1 });

                  // Immediately send unlock for all slots that should be unlocked
                  savedStates.forEach((saved, index) => {
                    if (!saved.locked) {
                      instance.socket.emit('unlock_speaker', {
                        room: roomId,
                        position: index + 1
                      });
                    }
                  });

                  console.log('✅ Sync commands sent! Dual control enabled.');

                  io.emit('room-hijacked', { success: true, botId: targetBotId });
                } else {
                  console.log('⚠️  Hijack might have failed');
                  io.emit('room-hijacked', { success: false, botId: targetBotId });
                }
              });
            }, 1000);
          } else if (joinResponse?.result === 200 && !instance.state.autoHijackRooms) {
            console.log('ℹ️  Auto-hijack DISABLED - No speaker control permissions');
            console.log('💡 Enable auto-hijack toggle to control speaker slots');
          }
        });

        // Load messages after delay
        setTimeout(() => {
          console.log('📜 Requesting message history...');
          instance.socket.emit('load_message', { room: roomId });
        }, 2000); // Increased to 2s to let hijack complete first

        // Start periodic room health check - verify room still exists on server
        if (instance.roomHealthInterval) {
          clearInterval(instance.roomHealthInterval);
        }
        instance.roomHealthInterval = setInterval(async () => {
          // Skip if bot is not running or no room
          if (instance.state.status !== 'running' || !instance.state.currentRoom) {
            clearInterval(instance.roomHealthInterval);
            instance.roomHealthInterval = null;
            return;
          }

          try {
            const httpsAgent = new https.Agent({ rejectUnauthorized: false });
            const roomsResp = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
              headers: { 'Authorization': `Bearer ${botConfig.jwt_token}` },
              httpsAgent,
              timeout: 10000
            });

            const rooms = roomsResp.data.json || [];
            const currentRoomId = instance.state.currentRoom?.id;
            const roomStillExists = rooms.some(r => r.id === currentRoomId);

            if (!roomStillExists) {
              console.log(`\n💀 [${botConfig.name}] ROOM HEALTH CHECK: Room "${instance.state.currentRoom?.topic}" no longer exists on server!`);
              console.log(`   Room ID: ${currentRoomId} not found in ${rooms.length} active rooms`);

              // Save room ID before clearing
              const endedRoomId = currentRoomId;

              // Full cleanup
              instance.state.status = 'stopped';
              instance.state.currentRoom = null;
              instance.state.speakers = [];
              instance.state.participants = [];
              instance.state.messages = [];
              instance.state.connected = false;
              instance.hasJoinedRoom = false;
              instance.previousParticipants = new Map();
              instance.participantJoinTimes = new Map();

              // Disconnect socket fully (prevent reconnection/orphaned listeners)
              cleanupBotSocket(instance);

              // Clear from unavailable list
              if (endedRoomId) {
                clearRoomUnavailable(endedRoomId);
              }

              // Stop this interval
              clearInterval(instance.roomHealthInterval);
              instance.roomHealthInterval = null;

              // Notify portal
              io.emit('room-ended', {
                botId: targetBotId,
                reason: 'Room no longer exists (health check)'
              });

              broadcastBotState(targetBotId);

              // Auto-join if enabled
              if (instance.state.autoJoinRandomRoom) {
                console.log(`🎲 [${botConfig.name}] Auto-join enabled, will join random room in 10 seconds...`);
                startAutoJoinCountdown(targetBotId, 10, 'Room gone (health check) — auto-joining', () => autoJoinRandomRoom(targetBotId));
              }
            }
          } catch (error) {
            console.log(`⚠️ [${botConfig.name}] Room health check error: ${error.message}`);
          }
        }, 30000); // Check every 30 seconds
      });
    } else if (mode === 'follow' && userUuid) {
      // Follow user mode - find the user first (using selected bot)
      const httpsAgent = new https.Agent({ rejectUnauthorized: false });
      const roomsResp = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
        headers: { 'Authorization': `Bearer ${botConfig.jwt_token}` },
        httpsAgent
      });

      const rooms = roomsResp.data.json || [];
      const targetRoom = rooms.find(r => r.owner?.uuid === userUuid);
      const targetUser = targetRoom ? targetRoom.owner : rooms.find(r => r.owner?.uuid === userUuid)?.owner;

      if (!targetUser) {
        throw new Error('User not found');
      }

      instance.state.followUser = {
        uuid: targetUser.uuid,
        name: targetUser.pin_name
      };

      console.log(`🎯 Following user: ${targetUser.pin_name}`);

      if (targetRoom) {
        console.log(`✅ User has active room: ${targetRoom.topic}`);
        await joinRoom(targetRoom, botConfig);
      } else {
        console.log(`⏳ User has no room - starting polling...`);
        instance.state.status = 'running';
        broadcastBotState(targetBotId);
        await startFollowPolling(userUuid, targetUser.pin_name, botConfig);
      }
    }

    res.json({ success: true, botId: targetBotId });
  } catch (error) {
    console.error('Start error:', error);
    // Update the instance state if it exists
    if (instance) {
      instance.state.status = 'error';
      broadcastBotState(targetBotId);
    }
    res.status(500).json({ error: error.message });
  }
});

// Follow user polling (bot parameter contains selected bot config)
async function startFollowPolling(targetUserUuid, targetUserName, bot) {
  let checkCount = 0;

  // Clear any existing interval first!
  if (followInterval) {
    console.log('⚠️  Clearing old follow interval');
    clearInterval(followInterval);
    followInterval = null;
  }

  // Set status to waiting
  botState.status = 'waiting';
  broadcastState();

  const checkForRoom = async () => {
    // Don't check if we're already in a room!
    if (botState.status === 'running' && botState.currentRoom) {
      console.log('ℹ️  Already in room - skipping check');
      return;
    }

    // Don't check if mode changed (user stopped bot)
    if (botState.mode !== 'follow' || botState.status === 'stopped') {
      // Silently stop checking - the stop endpoint already logged this
      if (followInterval) {
        clearInterval(followInterval);
        followInterval = null;
      }
      return;
    }

    checkCount++;
    console.log(`[Check #${checkCount}] 🔍 Looking for ${targetUserName}'s room...`);

    // Notify UI that we're checking
    io.emit('poll-check', { checkCount, userName: targetUserName });

    try {
      const httpsAgent = new https.Agent({ rejectUnauthorized: false });
      const roomsResp = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
        headers: { 'Authorization': `Bearer ${bot.jwt_token}` },
        httpsAgent
      });

      const rooms = roomsResp.data.json || [];
      const targetRoom = rooms.find(r => r.owner?.uuid === targetUserUuid);

      if (targetRoom) {
        console.log(`✅ FOUND ${targetUserName}'s room: ${targetRoom.topic}`);

        // STOP POLLING IMMEDIATELY
        if (followInterval) {
          clearInterval(followInterval);
          followInterval = null;
          console.log('🛑 Stopped polling - joining room');
        }

        // Join the room with selected bot
        await joinRoom(targetRoom, bot);
      } else {
        console.log(`   ❌ No room - waiting 5s...`);
        // Keep status as 'waiting' and broadcast
        botState.status = 'waiting';
        broadcastState();
      }
    } catch (error) {
      console.error('❌ Error checking for room:', error.message);
    }
  };

  // Check immediately first
  await checkForRoom();

  // Only start interval if we didn't find a room
  if (!botState.currentRoom) {
    console.log('⏱️  Starting 5-second polling...');
    followInterval = setInterval(checkForRoom, 5000);
  }
}

// Join room with selected bot configuration
async function joinRoom(room, bot) {
  console.log(`🔄 Joining room: ${room.topic} with bot: ${bot.name}`);

  botState.currentRoom = room;
  botState.status = 'running';
  botState.connected = false; // Will be set to true on connect
  broadcastState();

  // Disconnect old socket if exists
  if (yellotalkSocket) {
    console.log('⚠️  Disconnecting old socket...');
    yellotalkSocket.removeAllListeners(); // Remove old listeners
    yellotalkSocket.disconnect();
    yellotalkSocket = null;
  }

  // Wait a bit before reconnecting
  await new Promise(resolve => setTimeout(resolve, 500));

  // Connect and join with selected bot's token
  yellotalkSocket = socketClient('https://live.yellotalk.co:8443', {
    auth: { token: bot.jwt_token },
    transports: ['websocket'],
    rejectUnauthorized: false
  });

  // Set up connect listener FIRST before other listeners
  yellotalkSocket.once('connect', () => {
    console.log(`✅ WebSocket connected - Joining room`);

    botState.connected = true;
    botState.status = 'running';
    broadcastState();

    yellotalkSocket.emit('join_room', {
      room: room.id,
      uuid: bot.user_uuid,
      avatar_id: bot.avatar_id || 0,
      gme_id: String(room.gme_id),
      campus: room.owner.group_shortname || 'No Group',
      pin_name: bot.name
    }, (joinResponse) => {
      console.log('📥 Join ACK:', joinResponse);
    });

    setTimeout(() => {
      console.log('📜 Requesting message history...');
      yellotalkSocket.emit('load_message', { room: room.id });
    }, 1000);
  });

  // Set up other listeners
  setupSocketListeners(yellotalkSocket, room.id, bot);

  // If already connected, emit join immediately
  if (yellotalkSocket.connected) {
    console.log('⚡ Already connected - joining immediately');
    yellotalkSocket.emit('join_room', {
      room: room.id,
      uuid: bot.user_uuid,
      avatar_id: bot.avatar_id || 0,
      gme_id: String(room.gme_id),
      campus: room.owner.group_shortname || 'No Group',
      pin_name: bot.name
    });

    setTimeout(() => {
      yellotalkSocket.emit('load_message', { room: room.id });
    }, 1000);
  }
}

function setupSocketListeners(socket, roomId, bot) {
  socket.onAny((eventName, data) => {
    console.log(`📡 [${eventName}]`);
  });

  socket.on('new_message', (data) => {
    console.log('💬', data.pin_name, ':', data.message);
    addMessage(data.pin_name || 'Unknown', data.message || '');
  });

  socket.on('load_message', (data) => {
    const messages = Array.isArray(data) ? data : (data.messages || []);
    console.log(`📚 ${messages.length} messages loaded`);

    messages.slice(-20).forEach(msg => {
      botState.messages.push({
        sender: msg.pin_name || '?',
        message: msg.message || '',
        time: new Date(msg.created_at || Date.now()).toLocaleTimeString()
      });
    });
    broadcastState();
  });

  socket.on('participant_changed', (data) => {
    const participants = Array.isArray(data) ? data : [];
    console.log(`👥 ${participants.length} participants`);

    botState.participants = participants;
    broadcastState();
  });

  socket.on('speaker_changed', (data) => {
    const speakers = Array.isArray(data) ? data : [];

    // Map speakers BY POSITION FIELD (not array index!)
    // Create array of 10 slots (indices 0-9, for YelloTalk positions 1-10)
    botState.speakers = Array(10).fill(null).map((_, index) => {
      const yellotalkPosition = index + 1;
      const speaker = speakers.find(s => s && s.position === yellotalkPosition);

      if (!speaker) {
        return {
          position: index,
          locked: false,
          pin_name: 'Empty',
          uuid: null,
          mic_muted: true
        };
      }

      if (speaker.pin_name === '🔒' || speaker.role === 'locked' || speaker.campus === 'Locked') {
        return {
          position: index,
          locked: true,
          pin_name: '🔒',
          uuid: null,
          mic_muted: true
        };
      }

      return {
        position: index,
        locked: false,
        pin_name: speaker.pin_name || 'Unknown',
        uuid: speaker.uuid,
        mic_muted: speaker.mic_muted !== false,
        avatar_suit: speaker.avatar_suit,
        gift_amount: speaker.gift_amount || 0
      };
    });

    console.log(`🎤 Speaker update: ${botState.speakers.filter(s => !s.locked && s.pin_name !== 'Empty').length} occupied, ${botState.speakers.filter(s => s.locked).length} locked, ${botState.speakers.filter(s => !s.locked && s.pin_name === 'Empty').length} empty`);

    // Emit speaker update to web portal
    io.emit('speakers-update', botState.speakers);
    broadcastState();
  });

  socket.on('live_end', (data) => {
    console.log('🔚 Room ended!', data);

    // Emit to web portal
    io.emit('room-ended', {
      code: data?.code,
      description: data?.description || 'Room ended',
      reason: data?.event || 'live_end'
    });

    // If in follow mode, disconnect and restart polling
    if (botState.mode === 'follow' && botState.followUser) {
      console.log(`🔄 Room ended - waiting for ${botState.followUser.name}'s next room...`);

      botState.status = 'waiting';
      botState.currentRoom = null;
      botState.messages = [];
      botState.participants = [];
      botState.speakers = [];
      botState.connected = false;
      broadcastState();

      socket.disconnect();

      // Use selected bot for follow polling restart
      const selectedBot = getSelectedBot();
      setTimeout(() => {
        if (botState.followUser && botState.mode === 'follow') {
          startFollowPolling(botState.followUser.uuid, botState.followUser.name, selectedBot);
        }
      }, 2000);
    } else {
      // Regular mode - just update state
      botState.currentRoom = null;
      botState.speakers = [];
      broadcastState();
    }
  });

  socket.on('end_live', (data) => {
    console.log('🔚 Room closed (end_live)');
    // Same as live_end
    socket.emit('live_end', data);
  });

  socket.on('disconnect', () => {
    console.log('⚠️  Disconnected from YelloTalk');

    botState.connected = false;
    botState.currentRoom = null;

    // Preserve followUser info for restart
    const savedFollowUser = botState.followUser;
    const savedMode = botState.mode;

    // If in follow mode, restart polling
    if (savedMode === 'follow' && savedFollowUser && savedFollowUser.uuid) {
      console.log(`🔄 Restarting follow polling for ${savedFollowUser.name}...`);

      try {
        // Use selected bot for reconnection
        const selectedBot = getSelectedBot();

        // Ensure followUser is preserved in state
        botState.followUser = savedFollowUser;
        botState.mode = savedMode;

        setTimeout(() => {
          // Triple check mode hasn't been changed by user clicking stop
          if (botState.followUser && botState.mode === 'follow') {
            startFollowPolling(savedFollowUser.uuid, savedFollowUser.name, selectedBot);
          } else {
            console.log('❌ Follow mode cancelled - not restarting');
          }
        }, 2000);
      } catch (error) {
        console.error('❌ Error restarting follow polling:', error.message);
        botState.status = 'error';
      }
    } else {
      // Regular mode - just mark as error
      console.log('ℹ️  Regular mode - marking as error');
      botState.status = 'error';
    }

    broadcastState();
  });
}

// Stop a specific bot (or all if no botId provided)
app.post('/api/bot/stop', (req, res) => {
  const { botId } = req.body;

  // If botId specified, stop just that bot
  if (botId) {
    const instance = botInstances.get(botId);
    if (!instance) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    stopBotInstance(botId);
    return res.json({ success: true, stopped: botId });
  }

  // Otherwise stop all running bots
  const stoppedBots = [];
  botInstances.forEach((instance, id) => {
    if (instance.state.status === 'running' || instance.state.status === 'waiting') {
      stopBotInstance(id);
      stoppedBots.push(id);
    }
  });

  res.json({ success: true, stopped: stoppedBots });
});

// Helper function to stop a specific bot instance
function stopBotInstance(botId) {
  const instance = botInstances.get(botId);
  if (!instance) return;

  console.log('\n' + '='.repeat(80));
  console.log(`🛑 STOPPING BOT: ${instance.config.name} (${botId})`);
  console.log('='.repeat(80));
  console.log(`Current room: ${instance.state.currentRoom?.id}`);
  console.log(`Current room topic: ${instance.state.currentRoom?.topic}`);
  console.log(`Socket connected: ${instance.socket?.connected}`);
  console.log('='.repeat(80) + '\n');

  // Clear follow interval if exists
  if (instance.followInterval) {
    clearInterval(instance.followInterval);
    instance.followInterval = null;
  }

  // Clear room health check interval
  if (instance.roomHealthInterval) {
    clearInterval(instance.roomHealthInterval);
    instance.roomHealthInterval = null;
  }

  // Clear auto-join countdown
  if (instance.autoJoinCountdownInterval) {
    clearInterval(instance.autoJoinCountdownInterval);
    instance.autoJoinCountdownInterval = null;
  }
  emitAutoJoinStatus(botId, { step: 'idle' });

  // Handle leaving based on whether we hijacked or not
  if (instance.socket && instance.socket.connected) {
    if (instance.state.autoHijackRooms && instance.state.currentRoom) {
      // HIJACKED: Keep socket alive to prevent room closure
      console.log('⚠️  HIJACKED MODE: Keeping socket alive to prevent room closure');
      console.log('📋 Removing event listeners but maintaining connection...');

      instance.socket.off('new_message');
      instance.socket.off('participant_changed');
      instance.socket.off('speaker_changed');
      instance.socket.off('load_message');
      instance.socket.off('live_end');
      instance.socket.off('owner_changed');

      console.log('✅ Bot stopped - Socket alive in background');
      console.log('💡 Room will NOT close. Restart bot-server to fully disconnect.');
    } else {
      // NOT HIJACKED: Can leave normally
      console.log('🚪 NOT HIJACKED: Leaving room normally...');

      // Capture socket ref so setTimeout cleans up the RIGHT socket (not a new one)
      const socketToCleanup = instance.socket;

      if (instance.state.currentRoom && socketToCleanup) {
        socketToCleanup.emit('leave_room', {
          room: instance.state.currentRoom.id,
          uuid: instance.config.user_uuid
        }, (leaveResp) => {
          console.log('📥 leave_room response:', leaveResp);
        });
      }

      // Clean up immediately (don't wait) to prevent orphaned sockets
      instance.socket = null;
      setTimeout(() => {
        console.log('🔌 Disconnecting...');
        if (socketToCleanup) {
          socketToCleanup.removeAllListeners();
          socketToCleanup.disconnect();
        }
        console.log('✅ Left room cleanly');
      }, 500);
    }
  }

  // Reset state
  instance.state.status = 'stopped';
  instance.state.mode = null;
  instance.state.currentRoom = null;
  instance.state.followUser = null;
  instance.state.participants = [];
  instance.state.speakers = [];
  instance.state.connected = false;

  broadcastBotState(botId);

  // Re-trigger auto-join if still enabled
  if (instance.state.autoJoinRandomRoom) {
    console.log(`🎲 [${instance.config.name}] Auto-join still enabled after stop, will join random room in 10 seconds...`);
    startAutoJoinCountdown(botId, 10, 'Bot stopped — auto-joining', () => autoJoinRandomRoom(botId));
  }

  // Wake up other waiting bots — this bot left a room so one may be free now
  setTimeout(() => wakeUpWaitingBots(), 2000);
}


// Reload greetings
app.post('/api/bot/reload-greetings', (req, res) => {
  console.log('🔄 Manually reloading greetings.json...');
  const result = loadGreetings();
  if (result.success) {
    io.emit('greetings-reloaded', result.config);
    res.json({ success: true, config: result.config });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

// Get current greetings
app.get('/api/bot/greetings', (req, res) => {
  res.json({ success: true, config: greetingsConfig });
});

// Toggle welcome message
app.post('/api/bot/toggle-welcome', (req, res) => {
  const { enabled, botId } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  // Update specific bot's state or global
  const instance = botId ? botInstances.get(botId) : null;
  const state = instance?.state || botState;

  state.enableWelcomeMessage = enabled;
  console.log(`🔄 Welcome message ${enabled ? 'enabled' : 'disabled'} for ${botId || 'global'}`);

  broadcastState();
  if (botId) broadcastBotState(botId);
  res.json({ success: true, enableWelcomeMessage: state.enableWelcomeMessage });
});

// Toggle auto-hijack
app.post('/api/bot/toggle-hijack', (req, res) => {
  const { enabled, botId } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  // Update specific bot's state or global
  const instance = botId ? botInstances.get(botId) : null;
  const state = instance?.state || botState;

  state.autoHijackRooms = enabled;
  console.log(`🔄 Auto-hijack ${enabled ? 'enabled' : 'disabled'} for ${botId || 'global'}`);

  broadcastState();
  if (botId) broadcastBotState(botId);
  res.json({ success: true, autoHijackRooms: state.autoHijackRooms });
});

// Toggle auto-join random room
app.post('/api/bot/toggle-auto-join', (req, res) => {
  const { enabled, botId } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  // Get or create bot instance
  let instance = botId ? botInstances.get(botId) : null;

  // If no instance exists, try to create one
  if (!instance && botId) {
    instance = getBotInstance(botId);
  }

  if (!instance) {
    return res.status(400).json({ error: 'Bot not found' });
  }

  instance.state.autoJoinRandomRoom = enabled;
  console.log(`🔄 Auto-join random room ${enabled ? 'enabled' : 'disabled'} for ${instance.config?.name || botId}`);
  console.log(`   Current status: ${instance.state.status}`);

  // If enabled and bot is currently stopped, start auto-join immediately
  if (enabled && instance.state.status === 'stopped') {
    console.log(`🎲 Bot is stopped, triggering auto-join in 5 seconds...`);
    startAutoJoinCountdown(botId, 5, 'Auto-join enabled — starting', () => autoJoinRandomRoom(botId));
  }

  // If disabled, clear any running countdown
  if (!enabled && instance.autoJoinCountdownInterval) {
    clearInterval(instance.autoJoinCountdownInterval);
    instance.autoJoinCountdownInterval = null;
    emitAutoJoinStatus(botId, { step: 'idle' });
  }

  broadcastState();
  broadcastBotState(botId);
  res.json({ success: true, autoJoinRandomRoom: instance.state.autoJoinRandomRoom });
});

// Manual hijack endpoint (for when auto-hijack is disabled)
app.post('/api/bot/hijack-room', (req, res) => {
  if (!yellotalkSocket || !yellotalkSocket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  if (!botState.currentRoom) {
    return res.status(400).json({ error: 'No current room' });
  }

  const currentBot = getSelectedBot();
  console.log('🔥 Manual room hijack requested...');

  yellotalkSocket.emit('create_room', {
    room: botState.currentRoom.id,
    uuid: currentBot.user_uuid,
    limit_speaker: 0
  }, (createResp) => {
    console.log('📥 create_room Response:', createResp);

    if (createResp?.result === 200) {
      console.log('✅ ROOM HIJACKED!');

      // Trigger permission refresh by muting non-existent position 11
      console.log('🔄 Triggering permission refresh with position 11...');
      yellotalkSocket.emit('mute_speaker', {
        room: botState.currentRoom.id,
        position: 11
      }, (muteResp) => {
        console.log('📥 Mute position 11 response:', muteResp);
        console.log('✅ Permission refresh triggered!');
      });

      io.emit('room-hijacked', { success: true });
      res.json({ success: true });
    } else {
      console.log('❌ Hijack failed');
      res.json({ success: false, error: createResp?.description || 'Hijack failed' });
    }
  });
});

// Speaker control endpoints
app.post('/api/bot/speaker/lock', async (req, res) => {
  const { position, botId } = req.body;

  if (position === undefined || position < -1 || position > 9) {
    return res.status(400).json({ error: 'Invalid position (must be -1 to 9, where -1 is owner slot)' });
  }

  // Get specific bot instance or fallback to global
  const instance = botId ? botInstances.get(botId) : null;
  const socket = instance?.socket || yellotalkSocket;
  const state = instance?.state || botState;

  if (!socket || !socket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  try {
    const result = await lockSpeakerForBot(position, socket, state);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bot/speaker/unlock', async (req, res) => {
  const { position, botId } = req.body;

  if (position === undefined || position < -1 || position > 9) {
    return res.status(400).json({ error: 'Invalid position (must be -1 to 9, where -1 is owner slot)' });
  }

  const instance = botId ? botInstances.get(botId) : null;
  const socket = instance?.socket || yellotalkSocket;
  const state = instance?.state || botState;

  if (!socket || !socket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  try {
    const result = await unlockSpeakerForBot(position, socket, state);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bot/speaker/mute', async (req, res) => {
  const { position, botId } = req.body;

  if (position === undefined || position < -1 || position > 9) {
    return res.status(400).json({ error: 'Invalid position (must be -1 to 9, where -1 is owner slot)' });
  }

  const instance = botId ? botInstances.get(botId) : null;
  const socket = instance?.socket || yellotalkSocket;
  const state = instance?.state || botState;

  if (!socket || !socket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  try {
    const result = await muteSpeakerForBot(position, socket, state);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bot/speaker/unmute', async (req, res) => {
  const { position, botId } = req.body;

  if (position === undefined || position < -1 || position > 9) {
    return res.status(400).json({ error: 'Invalid position (must be -1 to 9, where -1 is owner slot)' });
  }

  const instance = botId ? botInstances.get(botId) : null;
  const socket = instance?.socket || yellotalkSocket;
  const state = instance?.state || botState;

  if (!socket || !socket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  try {
    const result = await unmuteSpeakerForBot(position, socket, state);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bot/speaker/kick', async (req, res) => {
  const { position, botId } = req.body;

  if (position === undefined || position < -1 || position > 9) {
    return res.status(400).json({ error: 'Invalid position (must be -1 to 9, where -1 is owner slot)' });
  }

  const instance = botId ? botInstances.get(botId) : null;
  const socket = instance?.socket || yellotalkSocket;
  const state = instance?.state || botState;

  if (!socket || !socket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  // Handle owner slot (position -1) specially
  let speaker, speakerUuid;
  if (position === -1) {
    // Owner slot
    speaker = state.currentRoom?.owner;
    speakerUuid = speaker?.uuid;
    if (!speakerUuid) {
      return res.status(400).json({ error: 'No owner found to kick' });
    }
  } else {
    // Regular speaker slot
    speaker = state.speakers[position];
    if (!speaker || !speaker.uuid || speaker.locked) {
      return res.status(400).json({ error: 'No speaker in this slot to kick' });
    }
    speakerUuid = speaker.uuid;
  }

  try {
    const result = await kickSpeakerForBot(position, speakerUuid, socket, state);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Join a speaker slot (bot takes a seat so GME can broadcast audio)
app.post('/api/bot/speaker/join', async (req, res) => {
  const { position, botId } = req.body;

  const targetBotId = botId || selectedBotId || 'bot-1';
  const instance = botInstances.get(targetBotId);

  if (!instance || !instance.socket || !instance.socket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  const state = instance.state;
  const config = instance.config;

  if (!state.currentRoom) {
    return res.status(400).json({ error: 'Bot not in a room' });
  }

  const roomId = state.currentRoom.id;

  // Auto-find first empty slot if no position specified
  let targetPosition = position;
  if (targetPosition === undefined || targetPosition === null) {
    const emptySlot = state.speakers.find(s => !s.locked && s.pin_name === 'Empty');
    if (emptySlot) {
      targetPosition = emptySlot.position;
    } else {
      return res.status(400).json({ error: 'No empty speaker slots available' });
    }
  }

  if (targetPosition < 0 || targetPosition > 9) {
    return res.status(400).json({ error: 'Invalid position (must be 0-9)' });
  }

  // YelloTalk uses 1-indexed positions
  const yellotalkPosition = targetPosition + 1;

  console.log(`🎤 [${config.name}] Joining speaker slot ${targetPosition} (YelloTalk position ${yellotalkPosition})...`);

  try {
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('join_speaker timeout')), 10000);

      instance.socket.emit('join_speaker', {
        room: roomId,
        uuid: config.user_uuid,
        position: yellotalkPosition
      }, (response) => {
        clearTimeout(timeout);
        console.log(`📥 [${config.name}] join_speaker ACK:`, response);

        if (response?.result >= 200 && response?.result < 300) {
          resolve(response);
        } else {
          reject(new Error(response?.description || `join_speaker failed (result: ${response?.result})`));
        }
      });
    });

    console.log(`✅ [${config.name}] Joined speaker slot ${targetPosition}!`);
    res.json({ success: true, position: targetPosition, result });
  } catch (error) {
    console.log(`❌ [${config.name}] Failed to join speaker slot: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Leave a speaker slot
app.post('/api/bot/speaker/leave', async (req, res) => {
  const { position, botId } = req.body;

  const targetBotId = botId || selectedBotId || 'bot-1';
  const instance = botInstances.get(targetBotId);

  if (!instance || !instance.socket || !instance.socket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  const state = instance.state;
  const config = instance.config;

  if (!state.currentRoom) {
    return res.status(400).json({ error: 'Bot not in a room' });
  }

  const roomId = state.currentRoom.id;

  // Auto-find bot's current slot if no position specified
  let targetPosition = position;
  if (targetPosition === undefined || targetPosition === null) {
    const botSlot = state.speakers.find(s => s.uuid === config.user_uuid);
    if (botSlot) {
      targetPosition = botSlot.position;
    } else {
      return res.status(400).json({ error: 'Bot is not in any speaker slot' });
    }
  }

  // YelloTalk uses 1-indexed positions
  const yellotalkPosition = targetPosition + 1;

  console.log(`🚪 [${config.name}] Leaving speaker slot ${targetPosition}...`);

  try {
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('leave_speaker timeout')), 10000);

      instance.socket.emit('leave_speaker', {
        room: roomId,
        uuid: config.user_uuid,
        position: yellotalkPosition
      }, (response) => {
        clearTimeout(timeout);
        console.log(`📥 [${config.name}] leave_speaker ACK:`, response);
        resolve(response);
      });
    });

    console.log(`✅ [${config.name}] Left speaker slot ${targetPosition}`);
    res.json({ success: true, position: targetPosition, result });
  } catch (error) {
    console.log(`❌ [${config.name}] Failed to leave speaker slot: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bot/room/kick', async (req, res) => {
  const { uuid, botId } = req.body;

  if (!uuid) {
    return res.status(400).json({ error: 'UUID required' });
  }

  const instance = botId ? botInstances.get(botId) : null;
  const socket = instance?.socket || yellotalkSocket;
  const state = instance?.state || botState;

  if (!socket || !socket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  try {
    const result = await kickFromRoomForBot(uuid, socket, state);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket from portal
io.on('connection', (socket) => {
  console.log('✅ Web portal connected');

  // Send all bot states to new connection
  socket.emit('all-bot-states', getAllBotStates());

  // Handle send-message with optional botId
  socket.on('send-message', (data) => {
    const { botId, message } = data;

    // If botId specified, send from that bot
    if (botId) {
      const instance = botInstances.get(botId);
      if (instance && instance.socket && instance.socket.connected && instance.state.currentRoom) {
        instance.socket.emit('new_message', {
          room: instance.state.currentRoom.id,
          uuid: instance.config.user_uuid,
          avatar_id: instance.config.avatar_id || 0,
          pin_name: instance.config.name,
          message: message
        });
      }
      return;
    }

    // Otherwise, send from first connected bot
    for (const [id, instance] of botInstances) {
      if (instance.socket && instance.socket.connected && instance.state.currentRoom) {
        instance.socket.emit('new_message', {
          room: instance.state.currentRoom.id,
          uuid: instance.config.user_uuid,
          avatar_id: instance.config.avatar_id || 0,
          pin_name: instance.config.name,
          message: message
        });
        break;
      }
    }
  });
});

const PORT = 5353;
server.listen(PORT, () => {
  console.log('='.repeat(70));
  console.log('🚀 YelloTalk Bot Control Server');
  console.log('='.repeat(70));
  console.log(`📡 API: http://localhost:${PORT}`);
  console.log(`🌐 Portal: http://localhost:5252`);
  console.log('');
  console.log('✅ Ready! Open web portal to control bot.');
  console.log('='.repeat(70));
});
