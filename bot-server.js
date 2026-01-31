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
    autoHijackRooms: false
  };
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
    io.emit('bot-state-update', {
      botId,
      state: { ...instance.state, id: botId, name: instance.config.name }
    });
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
    console.log('✅ Loaded greetings.json:', greetingsConfig);
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

// AI Response Handler with Dual API Key Support
async function getAIResponse(userQuestion, userUuid, userName, botName = 'Siri') {
  try {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🤖 ${userName} asking AI: "${userQuestion}"`);

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

    // Add room owner info (หัวห้อง)
    if (botState.currentRoom && botState.currentRoom.owner) {
      const owner = botState.currentRoom.owner;
      const ownerName = owner.pin_name || owner.name || 'Unknown';
      contextInfo += ` | Room Owner (หัวห้อง/หห): ${ownerName}`;
      if (botState.currentRoom.topic) {
        contextInfo += ` | Room Topic: ${botState.currentRoom.topic}`;
      }
    }

    // Add participants list with time duration
    const roomOwnerId = botState.currentRoom?.owner?.uuid;

    // Build list of all participants (including room owner if not in list)
    let allParticipants = [...(botState.participants || [])];

    // Check if room owner is in participants list, if not add them
    if (roomOwnerId && !allParticipants.some(p => p.uuid === roomOwnerId)) {
      const owner = botState.currentRoom.owner;
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

          // Add time duration if available
          const joinInfo = participantJoinTimes.get(p.uuid);
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
You are a CHAT BOT in YelloTalk chat room. You are NOT Apple's Siri. You are NOT created by Apple.
YOUR CREATOR IS: คุณ${config.pin_name}

When ANYONE asks "ใครเป็นคนสร้าง", "ใครทำบอทนี้", "who created you/this bot", or similar questions:
YOU MUST ALWAYS ANSWER: "คุณ${config.pin_name} เป็นผู้สร้างบอทนี้ค่ะ"
NEVER say "Apple" or "created by Apple". Your creator is ONLY คุณ${config.pin_name}.

OTHER INSTRUCTIONS:
1. Keep responses SHORT and CONCISE (2-4 sentences maximum). This is a chat room, not an essay.

2. SPECIAL ABILITIES - You CAN do these:
   - Random number assignments: When asked "สุ่มเลข 1-12 จากทุกคนในห้อง" or similar, assign unique random numbers to each participant from the room list above
   - Random person selection: When asked "สุ่มคนในห้อง", randomly pick someone from the participant list
   - Dice rolls, coin flips, any randomization tasks
   - Example: If room has Alice, Bob, Charlie and user asks "สุ่มเลข 1-3 จากทุกคน", respond:
     "Alice: 2, Bob: 1, Charlie: 3" or similar format

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
      temperature: 0.7,
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

  // Check if this specific bot is already running
  if (instance.state.status === 'running') {
    return res.json({ error: `Bot "${botConfig.name}" is already running` });
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

        console.log(`\n[${timestamp}] [${botConfig.name}] 💬 ${sender}:`);
        console.log(`           ${message}`);
        addMessageForBot(targetBotId, sender, message);

        // Keyword detection (don't respond to our own messages)
        // Use bot's actual name instead of hardcoded "Siri"
        const isBotMessage = sender.includes(botConfig.name);

        if (!isBotMessage) {
          const messageLower = message.toLowerCase();

          // IMPORTANT: Don't respond to bot responses (prevent infinite loop)
          if (message.includes('คนในห้องตอนนี้') && message.includes('คน):')) {
            // This is a bot's user list response, ignore it
            return;
          }

          // Check for Siri trigger (AI Response) - @siri, siri, or สิริ anywhere in message
          if (messageLower.includes('@siri') || messageLower.includes('siri') || message.includes('สิริ')) {
            // Remove trigger word from the message to get the question
            // Check multiple patterns: @siri, siri, or สิริ (Thai)
            let question = message;
            let triggerFound = '';

            if (messageLower.includes('@siri')) {
              question = message.replace(/@siri/i, '').trim();
              triggerFound = '@siri';
            } else if (message.includes('สิริ')) {
              question = message.replace(/สิริ/g, '').trim();
              triggerFound = 'สิริ';
            } else if (messageLower.includes('siri')) {
              question = message.replace(/siri/gi, '').trim();
              triggerFound = 'siri';
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
              console.log(`[${timestamp}] 🎉 ${sender} wants to set custom greeting: "${customGreeting}"`);

              // Add/update greeting in greetingsConfig
              if (!greetingsConfig.customGreetings) {
                greetingsConfig.customGreetings = {};
              }

              // Use a key that will match the user's name (partial match)
              // Find a unique identifier from their name
              const greetingKey = sender;
              greetingsConfig.customGreetings[greetingKey] = customGreeting;

              // Save to file
              try {
                const fs = require('fs');
                const greetingsPath = require('path').join(__dirname, 'greetings.json');
                fs.writeFileSync(greetingsPath, JSON.stringify(greetingsConfig, null, 2), 'utf8');
                console.log(`[${timestamp}] ✅ Saved custom greeting for ${sender}`);

                // Confirm to user
                setTimeout(() => {
                  sendMessage(`บันทึกแล้วค่ะ! ต่อไป Siri จะทักทาย ${sender} ว่า "${customGreeting}" 🎀`);
                }, 1000);
              } catch (err) {
                console.error(`[${timestamp}] ❌ Failed to save greeting:`, err);
                setTimeout(() => {
                  sendMessage(`ขอโทษค่ะ ไม่สามารถบันทึกได้ 😢`);
                }, 1000);
              }

              return; // Don't process as AI question
            }

            console.log(`[${timestamp}] 🤖 Siri triggered by ${sender} (trigger: ${triggerFound})`);
            console.log(`           Original message: "${message}"`);
            console.log(`           Question extracted: "${question}"`);

            // Get AI response and send it
            getAIResponse(question, senderUuid, sender, botConfig.name)
              .then(aiReply => {
                setTimeout(() => {
                  sendMessage(aiReply);
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

            // Filter out bot from list
            const usersWithoutBot = botState.participants.filter(p => !p.pin_name?.includes(botConfig.name));

            if (usersWithoutBot.length === 0) {
              console.log(`[${timestamp}] ⚠️  Participant list not loaded yet`);
              return;
            }

            // Build numbered user list with time
            const userList = usersWithoutBot
              .map((p, i) => {
                const joinInfo = participantJoinTimes.get(p.uuid);
                if (joinInfo) {
                  const now = new Date();
                  const duration = now - joinInfo.joinTime;
                  const minutes = Math.floor(duration / 60000);
                  const seconds = Math.floor((duration % 60000) / 1000);
                  const timeStr = minutes > 0 ? `${minutes}นาที ${seconds}วินาที` : `${seconds}วินาที`;
                  return `${i + 1}. ${p.pin_name} (${timeStr})`;
                } else {
                  return `${i + 1}. ${p.pin_name}`;
                }
              })
              .join('\n');

            const response = `คนในห้องตอนนี้ (${usersWithoutBot.length} คน):\n${userList}`;

            console.log(`[${timestamp}] 🤖 Auto-responding with user list (${usersWithoutBot.length} users)`);

            setTimeout(() => {
              sendMessage(response);
            }, 800);
          }
        }
      });

      yellotalkSocket.on('load_message', (data) => {
        const messages = Array.isArray(data) ? data : (data.messages || []);
        console.log(`📚 Loaded ${messages.length} messages`);

        messages.slice(-20).forEach(msg => {
          botState.messages.push({
            sender: msg.pin_name || '?',
            message: msg.message || '',
            time: new Date(msg.created_at || Date.now()).toLocaleTimeString()
          });
        });
        console.log(`✅ Now have ${botState.messages.length} messages in state`);
        broadcastState();
      });

      yellotalkSocket.on('participant_changed', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const participants = Array.isArray(data) ? data : [];
        console.log(`👥 ${participants.length} participants:`, participants.map(p => p.pin_name).join(', '));

        botState.participants = participants;

        // Build current participants map
        const currentParticipants = new Map();
        participants.forEach(p => {
          currentParticipants.set(p.uuid, p.pin_name || 'User');
        });

        // FIRST TIME: Save existing participants, DON'T greet anyone
        if (!hasJoinedRoom) {
          previousParticipants = new Map(currentParticipants);

          // Record join times for everyone currently in room (for future bye messages)
          participants.forEach(p => {
            if (!p.pin_name?.includes(botConfig.name)) {
              participantJoinTimes.set(p.uuid, {
                name: p.pin_name || 'User',
                joinTime: new Date()
              });
            }
          });

          hasJoinedRoom = true;
          console.log(`[${timestamp}] 📋 Initial state saved - NOT greeting existing ${participants.length} participants`);

          // Send welcome message explaining Siri feature (if enabled)
          console.log(`[${timestamp}] 🔍 Welcome message setting: ${botState.enableWelcomeMessage ? 'ENABLED' : 'DISABLED'}`);

          if (botState.enableWelcomeMessage) {
            setTimeout(() => {
              const welcomeMessage = 'สวัสดีค่ะ! 🤖 สามารถถามคำถามทั่วไปกับ AI ได้ด้วย @siri, siri หรือ สิริ\n⚠️ ตอบได้เฉพาะคำถามทั่วไป ไม่รวมข่าวล่าสุดหรือข้อมูลเรียลไทม์\n\nตัวอย่าง:\n• @siri สวัสดี\n• siri อธิบาย AI คืออะไร\n• สิริ สุ่มเลข 1-12 จากทุกคนในห้อง\n• ใครคือหห? siri\n\n🎀 ตั้งคำทักทายของตัวเอง:\n• siri เรียกฉันว่า [คำทักทาย]\n• siri ทักฉันว่า สวัสดีคนสวย';
              sendMessage(welcomeMessage);
              console.log(`[${timestamp}] 👋 Sent Siri welcome message`);
            }, 2000); // 2 second delay to let room fully load
          } else {
            console.log(`[${timestamp}] ⏭️  Welcome message disabled - NOT sending`);
          }

          io.emit('participant-update', participants);
          broadcastState();
          return;  // Exit - don't greet anyone on initial join!
        }

        // Find NEW participants (joined)
        let newCount = 0;
        console.log(`[${timestamp}] 🔍 Checking for new participants...`);
        console.log(`[${timestamp}] 📝 Previous participants:`, Array.from(previousParticipants.values()));

        participants.forEach((p, index) => {
          const uuid = p.uuid;
          const userName = p.pin_name || 'User';

          // Skip bot itself
          if (userName.includes(botConfig.name)) return;

          console.log(`[${timestamp}] 🔎 Checking ${userName} (${uuid})`);

          // New participant detected!
          if (!previousParticipants.has(uuid)) {
            console.log(`[${timestamp}] ✨ ${userName} is NEW!`);
            // Also check if we already have join time (prevent duplicate greets)
            if (!participantJoinTimes.has(uuid)) {
              newCount++;
              const joinTime = new Date();
              participantJoinTimes.set(uuid, { name: userName, joinTime: joinTime });

              // Generate greeting using greetings.json
              let greeting;
              const lowerUserName = userName.toLowerCase();

              // Check custom greetings
              let matched = false;
              const customKeys = Object.keys(greetingsConfig.customGreetings || {});
              console.log(`[${timestamp}] 🔎 Matching "${lowerUserName}" against ${customKeys.length} keys: [${customKeys.join(', ')}]`);
              
              for (const [key, greetingText] of Object.entries(greetingsConfig.customGreetings || {})) {
                const keyLower = key.toLowerCase();
                const isMatch = lowerUserName.includes(keyLower);
                if (isMatch) {
                  console.log(`[${timestamp}] ✅ MATCH "${keyLower}" in "${lowerUserName}" -> "${greetingText}"`);
                  greeting = `${greetingText} ${userName}`;
                  matched = true;
                  break;
                }
              }

              // Use default greeting if no match
              if (!matched) {
                console.log(`[${timestamp}] ⚪ No match found, using default: "${greetingsConfig.defaultGreeting}"`);
                greeting = `${greetingsConfig.defaultGreeting} ${userName}`;
              }

              console.log(`[${timestamp}] 👋 ${userName} joined (new participant #${newCount})`);
              console.log(`[${timestamp}] 🤖 Sending: "${greeting}"`);

              // Send greeting with delay
              setTimeout(() => {
                sendMessage(greeting);
              }, 1000 + (index * 500));
            } else {
              console.log(`[${timestamp}] 🔄 ${userName} rejoined (skipping duplicate greet)`);
            }
          }
        });

        // Debug: Show if we should have detected someone
        if (newCount === 0 && participants.length > previousParticipants.size) {
          console.log(`[${timestamp}] 🐛 DEBUG: Participant count increased but no new UUIDs detected`);
          console.log(`           Previous: ${previousParticipants.size}, Current: ${participants.length}`);
        }

        // Find participants who LEFT
        let leftCount = 0;
        previousParticipants.forEach((prevName, prevUuid) => {
          if (!prevName?.includes(botConfig.name) && !currentParticipants.has(prevUuid)) {
            leftCount++;
            // This participant left!
            const joinInfo = participantJoinTimes.get(prevUuid);
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
                sendMessage(goodbye);
              }, 800);

              // Clean up
              participantJoinTimes.delete(prevUuid);
            } else {
              console.log(`[${timestamp}] 🐛 ${prevName} left but no join time found (UUID: ${prevUuid.substring(0, 20)}...)`);
            }
          }
        });

        // Debug: Show if someone should have left
        if (leftCount === 0 && participants.length < previousParticipants.size) {
          console.log(`[${timestamp}] 🐛 DEBUG: Count decreased but no one detected as leaving`);
          console.log(`           Previous: ${previousParticipants.size}, Current: ${participants.length}`);
        }

        // Update previous participants for next comparison
        previousParticipants = new Map(currentParticipants);

        io.emit('participant-update', participants);
        broadcastState();
      });

      yellotalkSocket.on('speaker_changed', (data) => {
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

      yellotalkSocket.on('owner_changed', (data) => {
        console.log('👑 OWNER_CHANGED:', data);
        console.log(`   New owner: ${data.pin_name} (${data.uuid})`);

        // Update room owner in state
        if (botState.currentRoom) {
          botState.currentRoom.owner = data;
          broadcastState();
        }
      });

      yellotalkSocket.on('live_end', (data) => {
        console.log('🔚 Room ended!', data);

        // Emit to web portal
        io.emit('room-ended', {
          code: data?.code,
          description: data?.description || 'Room ended',
          reason: data?.event || 'live_end'
        });

        // Clear room state
        botState.currentRoom = null;
        botState.speakers = [];
        botState.participants = [];
        broadcastState();
      });

      yellotalkSocket.on('disconnect', () => {
        console.log('⚠️  Disconnected from YelloTalk');
        botState.connected = false;
        botState.status = 'stopped';
        // Also update instance state
        instance.state.connected = false;
        instance.state.status = 'stopped';
        broadcastState();
        broadcastBotState(targetBotId);
      });

      // THEN handle connect event
      yellotalkSocket.on('connect', () => {
        console.log('✅ Connected to YelloTalk WebSocket');
        botState.connected = true;
        botState.status = 'running';
        // Also update the instance state
        instance.state.connected = true;
        instance.state.status = 'running';
        broadcastState();
        broadcastBotState(targetBotId); // Emit bot-specific state for portal loading reset

        console.log(`🎯 Joining room: ${room.topic}`);

        // Join room with selected bot's UUID (normal join)
        yellotalkSocket.emit('join_room', {
          room: roomId,
          uuid: botConfig.user_uuid,
          avatar_id: botConfig.avatar_id || 0,
          gme_id: String(room.gme_id),
          campus: room.owner.group_shortname || 'No Group',
          pin_name: botConfig.name
        }, (joinResponse) => {
          console.log('📥 Join ACK:', joinResponse);

          // 🔥 AUTOMATIC ROOM HIJACK - Claim ownership with create_room (if enabled)!
          if (joinResponse?.result === 200 && botState.autoHijackRooms) {
            setTimeout(() => {
              console.log('\n🔥 AUTO-HIJACKING ROOM (create_room exploit)...');

              yellotalkSocket.emit('create_room', {
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
                  const savedStates = botState.speakers.map(s => ({
                    position: s.position,
                    locked: s.locked
                  }));

                  console.log('💾🔥🔧 Triggering sync + restore burst...');

                  // Send unlock position 1 (triggers weird lock-all)
                  yellotalkSocket.emit('unlock_speaker', { room: roomId, position: 1 });

                  // Immediately send unlock for all slots that should be unlocked
                  savedStates.forEach((saved, index) => {
                    if (!saved.locked) {
                      yellotalkSocket.emit('unlock_speaker', {
                        room: roomId,
                        position: index + 1
                      });
                    }
                  });

                  console.log('✅ Sync commands sent! Dual control enabled.');

                  io.emit('room-hijacked', { success: true });
                } else {
                  console.log('⚠️  Hijack might have failed');
                  io.emit('room-hijacked', { success: false });
                }
              });
            }, 1000);
          } else if (joinResponse?.result === 200 && !botState.autoHijackRooms) {
            console.log('ℹ️  Auto-hijack DISABLED - No speaker control permissions');
            console.log('💡 Enable auto-hijack toggle to control speaker slots');
          }
        });

        // Load messages after delay
        setTimeout(() => {
          console.log('📜 Requesting message history...');
          yellotalkSocket.emit('load_message', { room: roomId });
        }, 2000); // Increased to 2s to let hijack complete first
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

      if (instance.state.currentRoom) {
        instance.socket.emit('leave_room', {
          room: instance.state.currentRoom.id,
          uuid: instance.config.user_uuid
        }, (leaveResp) => {
          console.log('📥 leave_room response:', leaveResp);
        });
      }

      setTimeout(() => {
        console.log('🔌 Disconnecting...');
        instance.socket.removeAllListeners();
        instance.socket.disconnect();
        instance.socket = null;
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
