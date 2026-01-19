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

// Bot state
let botState = {
  status: 'stopped', // stopped, starting, running, waiting, error
  mode: null,
  currentRoom: null,
  followUser: null,
  messageCount: 0,
  participants: [],
  speakers: [], // Speaker slot status (10 slots)
  messages: [],
  connected: false,
  startTime: null,
  enableWelcomeMessage: true, // Toggle for welcome message on room join
  autoHijackRooms: true // Toggle for automatic room hijacking
};

let yellotalkSocket = null;
let followInterval = null;
let botUUID = null; // Bot's own UUID to skip greeting itself

// Load config for Groq API keys
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
const GROQ_API_KEYS = config.groq_api_keys || [];

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

function sendMessage(text) {
  if (!yellotalkSocket || !yellotalkSocket.connected) {
    console.log('⚠️  Cannot send message - not connected');
    return;
  }
  yellotalkSocket.emit('new_message', { message: text });
  console.log(`📤 Sent: ${text}`);
  addMessage('Bot', text);
}

// Speaker control functions
function lockSpeaker(position) {
  if (!yellotalkSocket || !yellotalkSocket.connected) {
    console.log('⚠️  Cannot lock - not connected');
    return Promise.reject(new Error('Not connected'));
  }

  return new Promise((resolve, reject) => {
    console.log(`🔒 Locking speaker slot ${position + 1}...`);
    yellotalkSocket.emit('lock_speaker', {
      room: botState.currentRoom?.id,
      position
    }, (response) => {
      console.log(`📥 Lock response:`, response);
      if (response?.result === 200) {
        console.log(`✅ Slot ${position + 1} locked!`);
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
    console.log(`🔓 Unlocking speaker slot ${position + 1}...`);
    yellotalkSocket.emit('unlock_speaker', {
      room: botState.currentRoom?.id,
      position
    }, (response) => {
      console.log(`📥 Unlock response:`, response);
      if (response?.result === 200) {
        console.log(`✅ Slot ${position + 1} unlocked!`);
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
    console.log(`🔇 Muting speaker slot ${position + 1}...`);
    yellotalkSocket.emit('mute_speaker', {
      room: botState.currentRoom?.id,
      position
    }, (response) => {
      console.log(`📥 Mute response:`, response);
      if (response?.result === 200) {
        console.log(`✅ Slot ${position + 1} muted!`);
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
    console.log(`🔊 Unmuting speaker slot ${position + 1}...`);
    yellotalkSocket.emit('unmute_speaker', {
      room: botState.currentRoom?.id,
      position
    }, (response) => {
      console.log(`📥 Unmute response:`, response);
      if (response?.result === 200) {
        console.log(`✅ Slot ${position + 1} unmuted!`);
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
    console.log(`👢 Kicking speaker from slot ${position + 1}...`);
    yellotalkSocket.emit('kick_speaker', {
      room: botState.currentRoom?.id,
      uuid: targetUuid,
      position
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

function addMessage(sender, message) {
  botState.messages.push({
    sender,
    message,
    time: new Date().toLocaleTimeString()
  });
  botState.messageCount++;

  // Keep only last 100 messages
  if (botState.messages.length > 100) {
    botState.messages = botState.messages.slice(-100);
  }

  io.emit('new-message', { sender, message, time: new Date().toLocaleTimeString() });
  broadcastState();
}

// AI Response Handler with Dual API Key Support
async function getAIResponse(userQuestion, userUuid, userName) {
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
        .filter(p => p.uuid !== botUUID && p.uuid !== config.user_uuid) // Exclude bot by UUID
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

// Fetch rooms
app.get('/api/bot/rooms', async (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
      headers: {
        'Authorization': `Bearer ${config.jwt_token}`,
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

// Get status
app.get('/api/bot/status', (req, res) => {
  res.json(botState);
});

// Start bot
app.post('/api/bot/start', async (req, res) => {
  if (botState.status === 'running') {
    return res.json({ error: 'Bot already running' });
  }

  const { mode, roomId, userUuid } = req.body;

  try {
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

    // Set bot UUID to skip greeting itself
    botUUID = config.user_uuid;

    botState.status = 'starting';
    botState.mode = mode;
    botState.startTime = Date.now();
    botState.messages = [];
    botState.participants = [];
    botState.messageCount = 0;

    // Reset greeting tracking
    previousParticipants = new Map();
    participantJoinTimes = new Map();
    hasJoinedRoom = false;

    broadcastState();

    // Fetch room details FIRST
    if (mode === 'regular' && roomId) {
      const httpsAgent = new https.Agent({ rejectUnauthorized: false });
      const roomResp = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
        headers: { 'Authorization': `Bearer ${config.jwt_token}` },
        httpsAgent
      });

      const room = roomResp.data.json.find(r => r.id === roomId);
      if (!room) {
        throw new Error('Room not found');
      }

      botState.currentRoom = room;
      console.log(`📋 Room found: ${room.topic}`);

      // Connect to YelloTalk
      yellotalkSocket = socketClient('https://live.yellotalk.co:8443', {
        auth: { token: config.jwt_token },
        transports: ['websocket'],
        rejectUnauthorized: false
      });

      // Set up ALL event listeners FIRST
      yellotalkSocket.onAny((eventName, data) => {
        console.log(`📡 [${eventName}]`, typeof data === 'object' ? JSON.stringify(data).substring(0, 100) : data);
      });

      yellotalkSocket.on('new_message', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const sender = data.pin_name || 'Unknown';
        const message = data.message || '';
        const senderUuid = data.uuid;

        console.log(`\n[${timestamp}] 💬 ${sender}:`);
        console.log(`           ${message}`);
        addMessage(sender, message);

        // Keyword detection (don't respond to our own messages)
        if (senderUuid !== botUUID) {
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

            console.log(`[${timestamp}] 🤖 Siri triggered by ${sender} (trigger: ${triggerFound})`);
            console.log(`           Original message: "${message}"`);
            console.log(`           Question extracted: "${question}"`);

            // Get AI response and send it
            getAIResponse(question, senderUuid, sender)
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
            const usersWithoutBot = botState.participants.filter(p => p.uuid !== botUUID);

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
            if (p.uuid !== botUUID) {
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
              const welcomeMessage = 'สวัสดีค่ะ! 🤖 สามารถถามคำถามทั่วไปกับ AI ได้ด้วย @siri, siri หรือ สิริ\n⚠️ ตอบได้เฉพาะคำถามทั่วไป ไม่รวมข่าวล่าสุดหรือข้อมูลเรียลไทม์\n\nตัวอย่าง:\n• @siri สวัสดี\n• siri อธิบาย AI คืออะไร\n• สิริ สุ่มเลข 1-12 จากทุกคนในห้อง\n• ใครคือหห? siri';
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
          if (uuid === botUUID) return;

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
          if (prevUuid !== botUUID && !currentParticipants.has(prevUuid)) {
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
        const timestamp = new Date().toLocaleTimeString();
        console.log(`\n${'='.repeat(80)}`);
        console.log(`[${timestamp}] 🎤 SPEAKER_CHANGED EVENT`);
        console.log(`${'='.repeat(80)}`);

        // Log COMPLETE raw data
        console.log(`📋 Raw data (full JSON):`);
        console.log(JSON.stringify(data, null, 2));
        console.log(`\n📊 Data structure:`);
        console.log(`   Type: ${typeof data}`);
        console.log(`   isArray: ${Array.isArray(data)}`);
        console.log(`   Length: ${data?.length}`);

        if (Array.isArray(data)) {
          console.log(`\n🔍 Analyzing each slot:`);
          data.forEach((speaker, index) => {
            console.log(`\n   Slot ${index}:`);
            if (speaker === null) {
              console.log(`      → NULL (empty/locked slot)`);
            } else if (speaker === undefined) {
              console.log(`      → UNDEFINED`);
            } else {
              console.log(`      → Object:`);
              console.log(`         pin_name: "${speaker.pin_name}"`);
              console.log(`         uuid: ${speaker.uuid}`);
              console.log(`         role: "${speaker.role}"`);
              console.log(`         mic_muted: ${speaker.mic_muted}`);
              console.log(`         campus: "${speaker.campus}"`);
            }
          });
        }

        // Map speakers - KEEP ORIGINAL DATA, don't transform
        const speakers = Array.isArray(data) ? data : [];
        botState.speakers = speakers.map((speaker, index) => {
          if (speaker === null || speaker === undefined) {
            // Null/undefined = empty or locked slot
            return {
              position: index,
              locked: false, // Consider as empty, not locked
              pin_name: 'Empty',
              uuid: null,
              mic_muted: true
            };
          }

          // Speaker object exists - check if it's locked or occupied
          if (speaker.pin_name === '🔒' || speaker.role === 'locked' || speaker.campus === 'Locked') {
            return {
              position: index,
              locked: true,
              pin_name: '🔒',
              uuid: null,
              mic_muted: true
            };
          }

          // Actual speaker present
          return {
            position: index,
            locked: false,
            pin_name: speaker.pin_name || 'Unknown',
            uuid: speaker.uuid,
            mic_muted: speaker.mic_muted !== false, // Default to muted if undefined
            avatar_suit: speaker.avatar_suit,
            gift_amount: speaker.gift_amount || 0
          };
        });

        console.log(`\n✅ Mapped ${botState.speakers.length} speakers`);
        console.log(`${'='.repeat(80)}\n`);

        // Emit speaker update to web portal
        io.emit('speakers-update', botState.speakers);
        broadcastState();
      });

      yellotalkSocket.on('disconnect', () => {
        console.log('⚠️  Disconnected from YelloTalk');
        botState.connected = false;
        botState.status = 'error';
        broadcastState();
      });

      // THEN handle connect event
      yellotalkSocket.on('connect', () => {
        console.log('✅ Connected to YelloTalk WebSocket');
        botState.connected = true;
        botState.status = 'running';
        broadcastState();

        console.log(`🎯 Joining room: ${room.topic}`);

        // Join room with ALL data
        yellotalkSocket.emit('join_room', {
          room: roomId,
          uuid: config.user_uuid,
          avatar_id: config.avatar_id,
          gme_id: String(room.gme_id),
          campus: room.owner.group_shortname || 'No Group',
          pin_name: config.pin_name
        }, (joinResponse) => {
          console.log('📥 Join ACK:', joinResponse);

          // 🔥 AUTOMATIC ROOM HIJACK - Claim ownership immediately (if enabled)!
          if (joinResponse?.result === 200 && botState.autoHijackRooms) {
            setTimeout(() => {
              console.log('\n🔥 AUTO-HIJACKING ROOM (Claiming ownership...)');

              yellotalkSocket.emit('create_room', {
                room: roomId,
                uuid: config.user_uuid,
                limit_speaker: 0
              }, (createResp) => {
                console.log('📥 create_room Response:', createResp);

                if (createResp?.result === 200) {
                  console.log('✅✅✅ ROOM HIJACKED! Bot has OWNER permissions!');
                  console.log('🔓 Can now lock/unlock speaker slots!');
                  io.emit('room-hijacked', { success: true });
                } else {
                  console.log('⚠️  Hijack might have failed');
                  io.emit('room-hijacked', { success: false });
                }
              });
            }, 1000);
          } else if (joinResponse?.result === 200 && !botState.autoHijackRooms) {
            console.log('ℹ️  Auto-hijack DISABLED - Not claiming ownership');
            console.log('💡 Enable auto-hijack or use manual hijack button for speaker control');
          }
        });

        // Load messages after delay
        setTimeout(() => {
          console.log('📜 Requesting message history...');
          yellotalkSocket.emit('load_message', { room: roomId });
        }, 2000); // Increased to 2s to let hijack complete first
      });
    } else if (mode === 'follow' && userUuid) {
      // Follow user mode - find the user first
      const httpsAgent = new https.Agent({ rejectUnauthorized: false });
      const roomsResp = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
        headers: { 'Authorization': `Bearer ${config.jwt_token}` },
        httpsAgent
      });

      const rooms = roomsResp.data.json || [];
      const targetRoom = rooms.find(r => r.owner?.uuid === userUuid);
      const targetUser = targetRoom ? targetRoom.owner : rooms.find(r => r.owner?.uuid === userUuid)?.owner;

      if (!targetUser) {
        throw new Error('User not found');
      }

      botState.followUser = {
        uuid: targetUser.uuid,
        name: targetUser.pin_name
      };

      console.log(`🎯 Following user: ${targetUser.pin_name}`);

      if (targetRoom) {
        console.log(`✅ User has active room: ${targetRoom.topic}`);
        await joinRoom(targetRoom, config);
      } else {
        console.log(`⏳ User has no room - starting polling...`);
        botState.status = 'running';
        broadcastState();
        await startFollowPolling(userUuid, targetUser.pin_name, config);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Start error:', error);
    botState.status = 'error';
    broadcastState();
    res.status(500).json({ error: error.message });
  }
});

// Follow user polling
async function startFollowPolling(targetUserUuid, targetUserName, config) {
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
        headers: { 'Authorization': `Bearer ${config.jwt_token}` },
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

        // Join the room
        await joinRoom(targetRoom, config);
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

async function joinRoom(room, config) {
  console.log(`🔄 Joining room: ${room.topic}`);

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

  // Connect and join
  yellotalkSocket = socketClient('https://live.yellotalk.co:8443', {
    auth: { token: config.jwt_token },
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
      uuid: config.user_uuid,
      avatar_id: config.avatar_id,
      gme_id: String(room.gme_id),
      campus: room.owner.group_shortname || 'No Group',
      pin_name: config.pin_name
    }, (joinResponse) => {
      console.log('📥 Join ACK:', joinResponse);
    });

    setTimeout(() => {
      console.log('📜 Requesting message history...');
      yellotalkSocket.emit('load_message', { room: room.id });
    }, 1000);
  });

  // Set up other listeners
  setupSocketListeners(yellotalkSocket, room.id, config);

  // If already connected, emit join immediately
  if (yellotalkSocket.connected) {
    console.log('⚡ Already connected - joining immediately');
    yellotalkSocket.emit('join_room', {
      room: room.id,
      uuid: config.user_uuid,
      avatar_id: config.avatar_id,
      gme_id: String(room.gme_id),
      campus: room.owner.group_shortname || 'No Group',
      pin_name: config.pin_name
    });

    setTimeout(() => {
      yellotalkSocket.emit('load_message', { room: room.id });
    }, 1000);
  }
}

function setupSocketListeners(socket, roomId, config) {
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
    const timestamp = new Date().toLocaleTimeString();
    const speakers = Array.isArray(data) ? data : [];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${timestamp}] 🎤 SPEAKER_CHANGED EVENT RECEIVED`);
    console.log(`${'='.repeat(80)}`);
    console.log(`📋 Raw data type: ${typeof data}, isArray: ${Array.isArray(data)}, length: ${speakers.length}`);
    console.log(`📋 Full raw speaker data:`);
    console.log(JSON.stringify(data, null, 2).substring(0, 1000));
    console.log(`${'='.repeat(80)}\n`);

    // Update speaker state with DETAILED logging per slot
    botState.speakers = speakers.map((speaker, index) => {
      console.log(`\n🔍 Slot ${index}:`);
      console.log(`   speaker value:`, speaker);
      console.log(`   speaker is null: ${speaker === null}`);
      console.log(`   speaker is undefined: ${speaker === undefined}`);
      console.log(`   speaker.role: ${speaker?.role}`);
      console.log(`   speaker.pin_name: ${speaker?.pin_name}`);
      console.log(`   speaker.uuid: ${speaker?.uuid}`);

      // Check if slot is locked
      const isLocked = !speaker || speaker.role === 'locked' || speaker.pin_name === '🔒';
      console.log(`   → isLocked: ${isLocked} (because: ${!speaker ? 'null/undefined' : speaker.role === 'locked' ? 'role=locked' : speaker.pin_name === '🔒' ? 'pin_name=🔒' : 'SHOULD NOT BE LOCKED!'})`);

      if (isLocked) {
        return {
          position: index,
          locked: true,
          pin_name: '🔒',
          uuid: null,
          mic_muted: true
        };
      }

      // Speaker is present (not locked, has data)
      const result = {
        position: index,
        locked: false,
        pin_name: speaker.pin_name || 'Empty',
        uuid: speaker.uuid || null,
        mic_muted: speaker.mic_muted !== undefined ? speaker.mic_muted : true,
        avatar_suit: speaker.avatar_suit,
        gift_amount: speaker.gift_amount || 0
      };
      console.log(`   → Mapped as:`, result);
      return result;
    });

    console.log(`\n📊 Final mapped speakers:`);
    botState.speakers.forEach(s => {
      console.log(`   Slot ${s.position}: ${s.pin_name} | Locked: ${s.locked} | Mic: ${s.mic_muted ? 'Muted' : 'Live'}`);
    });
    console.log(`${'='.repeat(80)}\n`);

    // Emit speaker update to web portal
    io.emit('speakers-update', botState.speakers);
    broadcastState();
  });

  socket.on('live_end', (data) => {
    console.log('🔚 Room ended!');

    // If in follow mode, disconnect and restart polling
    if (botState.mode === 'follow' && botState.followUser) {
      console.log(`🔄 Room ended - waiting for ${botState.followUser.name}'s next room...`);

      botState.status = 'waiting'; // New state: waiting for next room
      botState.currentRoom = null;
      botState.messages = [];
      botState.participants = [];
      botState.connected = false;
      broadcastState();

      // Disconnect and restart polling
      socket.disconnect();

      const freshConfig = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
      setTimeout(() => {
        if (botState.followUser && botState.mode === 'follow') {
          startFollowPolling(botState.followUser.uuid, botState.followUser.name, freshConfig);
        }
      }, 2000);
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
        // Read config fresh
        const freshConfig = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

        // Ensure followUser is preserved in state
        botState.followUser = savedFollowUser;
        botState.mode = savedMode;

        setTimeout(() => {
          // Triple check mode hasn't been changed by user clicking stop
          if (botState.followUser && botState.mode === 'follow') {
            startFollowPolling(savedFollowUser.uuid, savedFollowUser.name, freshConfig);
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

// Stop bot
app.post('/api/bot/stop', (req, res) => {
  console.log('\n' + '='.repeat(80));
  console.log('🛑 STOP BOT REQUESTED');
  console.log('='.repeat(80));
  console.log(`Current room: ${botState.currentRoom?.id}`);
  console.log(`Current room topic: ${botState.currentRoom?.topic}`);
  console.log(`Bot UUID: ${config.user_uuid}`);
  console.log(`Socket connected: ${yellotalkSocket?.connected}`);
  console.log('='.repeat(80) + '\n');

  // CRITICAL: DON'T DISCONNECT AT ALL!
  // Keep the hijacked "owner" connection alive in the background
  // Just stop responding to events
  if (yellotalkSocket && yellotalkSocket.connected) {
    console.log('⚠️  CRITICAL: We hijacked this room as "owner"');
    console.log('⚠️  If we disconnect, room will close and kick everyone!');
    console.log('\n💡 SOLUTION: Keep connection alive, just stop listening to events\n');

    // Remove ALL our event listeners but keep socket alive
    console.log('📋 Step 1: Removing event listeners...');
    yellotalkSocket.off('new_message');
    yellotalkSocket.off('participant_changed');
    yellotalkSocket.off('speaker_changed');
    yellotalkSocket.off('load_message');
    yellotalkSocket.off('new_gift');
    yellotalkSocket.off('new_reaction');
    yellotalkSocket.off('live_end');
    yellotalkSocket.off('end_live');
    console.log('✅ Event listeners removed');

    console.log('\n📋 Step 2: Socket status:');
    console.log(`   Connected: ${yellotalkSocket.connected}`);
    console.log(`   Alive: YES (keeping connection open!)`);
    console.log('   Action: NONE (not disconnecting!)');

    console.log('\n✅✅✅ BOT STOPPED - Room connection PRESERVED');
    console.log('🎉 Room will NOT close!');
    console.log('💡 Socket remains connected in background to prevent room closure');
    console.log('⚠️  Note: To fully disconnect, restart the bot-server process\n');
    console.log('='.repeat(80) + '\n');

    // Keep yellotalkSocket alive! Don't set to null!
    // yellotalkSocket = null; ← NEVER DO THIS!
  } else {
    console.log('ℹ️  No active connection to preserve');
  }

  // Clear follow interval
  if (followInterval) {
    clearInterval(followInterval);
    followInterval = null;
    console.log('✅ Follow polling stopped');
  }

  // Reset state completely (preserve user preferences)
  const keepWelcomePreference = botState.enableWelcomeMessage;
  const keepHijackPreference = botState.autoHijackRooms;

  botState = {
    status: 'stopped',
    mode: null,
    currentRoom: null,
    followUser: null,
    messageCount: 0,
    participants: [],
    speakers: [],
    messages: [],
    connected: false, // Mark as disconnected for UI, even though socket alive
    startTime: null,
    enableWelcomeMessage: keepWelcomePreference, // Preserve user preference
    autoHijackRooms: keepHijackPreference // Preserve user preference
  };

  // Reset greeting tracking
  previousParticipants = new Map();
  participantJoinTimes = new Map();
  hasJoinedRoom = false;

  console.log('✅ Bot fully stopped');
  broadcastState();
  res.json({ success: true });
});

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
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  botState.enableWelcomeMessage = enabled;
  console.log(`🔄 Welcome message ${enabled ? 'enabled' : 'disabled'}`);

  broadcastState();
  res.json({ success: true, enableWelcomeMessage: botState.enableWelcomeMessage });
});

// Toggle auto-hijack
app.post('/api/bot/toggle-hijack', (req, res) => {
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  botState.autoHijackRooms = enabled;
  console.log(`🔄 Auto-hijack ${enabled ? 'enabled' : 'disabled'}`);

  broadcastState();
  res.json({ success: true, autoHijackRooms: botState.autoHijackRooms });
});

// Manual hijack endpoint (for when auto-hijack is disabled)
app.post('/api/bot/hijack-room', (req, res) => {
  if (!yellotalkSocket || !yellotalkSocket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  if (!botState.currentRoom) {
    return res.status(400).json({ error: 'No current room' });
  }

  console.log('🔥 Manual room hijack requested...');

  yellotalkSocket.emit('create_room', {
    room: botState.currentRoom.id,
    uuid: config.user_uuid,
    limit_speaker: 0
  }, (createResp) => {
    console.log('📥 create_room Response:', createResp);

    if (createResp?.result === 200) {
      console.log('✅ ROOM HIJACKED!');
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
  const { position } = req.body;

  if (position === undefined || position < 0 || position > 9) {
    return res.status(400).json({ error: 'Invalid position (must be 0-9, total 10 slots)' });
  }

  if (!yellotalkSocket || !yellotalkSocket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  try {
    const result = await lockSpeaker(position);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bot/speaker/unlock', async (req, res) => {
  const { position } = req.body;

  if (position === undefined || position < 0 || position > 9) {
    return res.status(400).json({ error: 'Invalid position (must be 0-9, total 10 slots)' });
  }

  if (!yellotalkSocket || !yellotalkSocket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  try {
    const result = await unlockSpeaker(position);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bot/speaker/mute', async (req, res) => {
  const { position } = req.body;

  if (position === undefined || position < 0 || position > 9) {
    return res.status(400).json({ error: 'Invalid position (must be 0-9, total 10 slots)' });
  }

  if (!yellotalkSocket || !yellotalkSocket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  try {
    const result = await muteSpeaker(position);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bot/speaker/unmute', async (req, res) => {
  const { position } = req.body;

  if (position === undefined || position < 0 || position > 9) {
    return res.status(400).json({ error: 'Invalid position (must be 0-9, total 10 slots)' });
  }

  if (!yellotalkSocket || !yellotalkSocket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  try {
    const result = await unmuteSpeaker(position);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bot/speaker/kick', async (req, res) => {
  const { position } = req.body;

  if (position === undefined || position < 0 || position > 9) {
    return res.status(400).json({ error: 'Invalid position (must be 0-9, total 10 slots)' });
  }

  if (!yellotalkSocket || !yellotalkSocket.connected) {
    return res.status(400).json({ error: 'Bot not connected to room' });
  }

  // Find speaker at this position
  const speaker = botState.speakers[position];
  if (!speaker || !speaker.uuid || speaker.locked) {
    return res.status(400).json({ error: 'No speaker in this slot to kick' });
  }

  try {
    const result = await kickSpeaker(position, speaker.uuid);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket from portal
io.on('connection', (socket) => {
  console.log('✅ Web portal connected');
  socket.emit('bot-state', botState);

  socket.on('send-message', (data) => {
    if (yellotalkSocket && botState.currentRoom) {
      const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

      yellotalkSocket.emit('new_message', {
        room: botState.currentRoom.id,
        uuid: config.user_uuid,
        avatar_id: config.avatar_id,
        pin_name: config.pin_name,
        message: data.message
      });

      // DON'T add here - it will come back via new_message event
      // This prevents duplicate messages
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
