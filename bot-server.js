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

// Import bot logic from bot.js
const socketClient = require('socket.io-client');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: 'http://localhost:5252', credentials: true }
});

app.use(cors());
app.use(express.json());

// Bot state
let botState = {
  status: 'stopped', // stopped, starting, running, waiting, error
  mode: null,
  currentRoom: null,
  followUser: null,
  messageCount: 0,
  participants: [],
  messages: [],
  connected: false,
  startTime: null
};

let yellotalkSocket = null;
let followInterval = null;

function broadcastState() {
  io.emit('bot-state', botState);
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

    botState.status = 'starting';
    botState.mode = mode;
    botState.startTime = Date.now();
    botState.messages = [];
    botState.participants = [];
    botState.messageCount = 0;
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
        console.log('💬 New message from:', data.pin_name);
        addMessage(data.pin_name || 'Unknown', data.message || '');
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
        const participants = Array.isArray(data) ? data : [];
        console.log(`👥 ${participants.length} participants:`, participants.map(p => p.pin_name).join(', '));

        botState.participants = participants;
        io.emit('participant-update', participants);
        broadcastState();
      });

      yellotalkSocket.on('speaker_changed', (data) => {
        console.log('🎤 Speaker changed');
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
        });

        // Load messages after delay
        setTimeout(() => {
          console.log('📜 Requesting message history...');
          yellotalkSocket.emit('load_message', { room: roomId });
        }, 1000);
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
  console.log('🛑 Stopping bot...');

  // Disconnect socket
  if (yellotalkSocket) {
    yellotalkSocket.removeAllListeners(); // Remove ALL listeners first
    yellotalkSocket.disconnect();
    yellotalkSocket = null;
    console.log('✅ Socket disconnected');
  }

  // Clear follow interval
  if (followInterval) {
    clearInterval(followInterval);
    followInterval = null;
    console.log('✅ Follow polling stopped');
  }

  // Reset state completely
  botState = {
    status: 'stopped',
    mode: null,
    currentRoom: null,
    followUser: null,
    messageCount: 0,
    participants: [],
    messages: [],
    connected: false,
    startTime: null
  };

  console.log('✅ Bot fully stopped');
  broadcastState();
  res.json({ success: true });
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
