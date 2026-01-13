#!/usr/bin/env node
/**
 * YelloTalk Chat Bot - With Auto-Greeting
 * Monitors chat and greets new participants
 */

const io = require('socket.io-client');
const axios = require('axios');
const https = require('https');
const fs = require('fs');

// Load config
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const TOKEN = config.jwt_token;
const API_URL = config.api_base_url;
const UUID = config.user_uuid;
const PIN_NAME = config.pin_name;
const AVATAR_ID = config.avatar_id;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

let messageCount = 0;
let socket = null;
let currentRoomId = null;
let hasJoinedRoom = false;

// Fetch rooms
async function fetchRooms() {
    const response = await axios.get(`${API_URL}/v1/rooms/popular`, {
        headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'User-Agent': 'ios'
        },
        httpsAgent
    });
    return response.data.json || [];
}

// Send message function
function sendMessage(message, room_id = null) {
    if (!socket || !socket.connected) {
        console.log('❌ Not connected to room');
        return;
    }

    const roomId = room_id || currentRoomId;

    const messageData = {
        room: roomId,
        uuid: UUID,
        avatar_id: AVATAR_ID,
        pin_name: PIN_NAME,
        message: message
    };

    socket.emit('new_message', messageData, (response) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ✅ Message sent: "${message}"`);
    });
}

// Lock speaker slot
function lockSpeaker(position, room_id = null) {
    if (!socket || !socket.connected) {
        console.log('❌ Not connected to room');
        return;
    }

    const roomId = room_id || currentRoomId;

    const lockData = {
        room: roomId,
        position: position
    };

    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🔒 Locking speaker slot ${position + 1}...`);

    socket.emit('lock_speaker', lockData, (response) => {
        console.log(`[${timestamp}] ✅ Lock response:`, response);
    });
}

// Unlock speaker slot
function unlockSpeaker(position, room_id = null) {
    if (!socket || !socket.connected) {
        console.log('❌ Not connected to room');
        return;
    }

    const roomId = room_id || currentRoomId;

    const unlockData = {
        room: roomId,
        position: position
    };

    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🔓 Unlocking speaker slot ${position + 1}...`);

    socket.emit('unlock_speaker', unlockData, (response) => {
        console.log(`[${timestamp}] ✅ Unlock response:`, response);
    });
}

// Command interface for interactive control
function startCommandInterface() {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: ''
    });

    rl.on('line', (line) => {
        const input = line.trim();
        if (!input) return;

        const parts = input.split(' ');
        const cmd = parts[0].toLowerCase();

        console.log(`> ${input}`);  // Echo command

        if (cmd === 'msg' && parts.length > 1) {
            const message = parts.slice(1).join(' ');
            sendMessage(message);
        } else if (cmd === 'lock' && parts.length === 2) {
            const position = parseInt(parts[1]);
            if (!isNaN(position) && position >= 1 && position <= 10) {
                lockSpeaker(position - 1);  // 0-indexed
            } else {
                console.log('❌ Position must be 1-10');
            }
        } else if (cmd === 'unlock' && parts.length === 2) {
            const position = parseInt(parts[1]);
            if (!isNaN(position) && position >= 1 && position <= 10) {
                unlockSpeaker(position - 1);  // 0-indexed
            } else {
                console.log('❌ Position must be 1-10');
            }
        } else if (cmd === 'quit' || cmd === 'exit') {
            process.kill(process.pid, 'SIGINT');
        } else {
            console.log('❌ Unknown command. Try: msg <text>, lock <1-10>, unlock <1-10>, quit');
        }
    });
}

// Display rooms
function displayRooms(rooms) {
    console.log('\n' + '='.repeat(80));
    console.log('📋 ACTIVE ROOMS');
    console.log('='.repeat(80) + '\n');

    rooms.slice(0, 15).forEach((room, i) => {
        const topic = (room.topic || 'Untitled').substring(0, 50);
        const participants = room.participants_count || 0;
        const owner = (room.owner?.pin_name || 'Unknown').substring(0, 20);

        console.log(`${String(i + 1).padStart(2)}. ${topic}`);
        console.log(`    👥 ${participants} people | 👤 ${owner}`);
        console.log();
    });
}

// Connect and monitor room
function connectAndJoin(room) {
    currentRoomId = room.id;
    const gmeId = String(room.gme_id || '');
    const topic = (room.topic || 'Untitled').substring(0, 60);
    const campus = room.owner?.group_shortname || 'No Group';

    console.log('\n' + '='.repeat(80));
    console.log(`🔌 Connecting to: ${topic}`);
    console.log('='.repeat(80));

    // Create Socket.IO connection
    socket = io('https://live.yellotalk.co:8443', {
        auth: { token: TOKEN },
        transports: ['websocket'],
        rejectUnauthorized: false
    });

    socket.on('connect', () => {
        console.log('✅ Connected!');

        // Join room
        const joinData = {
            room: currentRoomId,
            uuid: UUID,
            avatar_id: AVATAR_ID,
            gme_id: gmeId,
            campus: campus,
            pin_name: PIN_NAME
        };

        console.log('📥 Joining room...');
        socket.emit('join_room', joinData, (response) => {
            if (response?.result === 200) {
                console.log('✅ Successfully joined room!');
                hasJoinedRoom = true;
            } else {
                console.log('⚠️  Join response:', response);
            }
        });

        // Load messages
        setTimeout(() => {
            console.log('📜 Loading message history...');
            socket.emit('load_message', { room: currentRoomId });

            console.log('\n' + '='.repeat(80));
            console.log('📺 LIVE CHAT FEED & AUTO-GREETING');
            console.log('='.repeat(80));
            console.log('Listening for new messages...\n');
            console.log('Commands:');
            console.log('  msg <text>    - Send message');
            console.log('  lock <1-10>   - Lock speaker slot');
            console.log('  unlock <1-10> - Unlock speaker slot');
            console.log('  quit          - Exit bot');
            console.log();

            // Start command input handler
            startCommandInterface();
        }, 1000);
    });

    socket.on('disconnect', (reason) => {
        console.log(`\n⚠️  Disconnected: ${reason}`);
    });

    socket.on('connect_error', (error) => {
        console.log(`❌ Connection error: ${error.message}`);
    });

    // === MESSAGE HANDLERS ===

    socket.on('new_message', (data) => {
        messageCount++;
        const timestamp = new Date().toLocaleTimeString();
        const sender = data.pin_name || 'Unknown';
        const message = data.message || '';

        console.log(`\n[${timestamp}] 💬 ${sender}:`);
        console.log(`           ${message}`);
    });

    socket.on('load_message', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const messages = Array.isArray(data) ? data : (data.messages || []);

        if (messages.length > 0) {
            console.log(`\n[${timestamp}] 📚 Message History (${messages.length} total):`);
            console.log('-'.repeat(80));
            messages.slice(-15).forEach(msg => {
                const sender = msg.pin_name || '?';
                const text = msg.message || '';
                console.log(`  ${sender}: ${text}`);
            });
            console.log('-'.repeat(80));
        }
    });

    socket.on('participant_changed', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const participants = Array.isArray(data) ? data : [];

        console.log(`[${timestamp}] 👥 Participants updated (${participants.length} total)`);
    });

    // Auto-greet new speakers (people who join voice)
    socket.on('speaker_changed', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const userName = data.pin_name || 'User';

        console.log(`[${timestamp}] 🎤 ${userName} joined as speaker`);

        // Only greet after we've fully joined (ignore initial speaker list)
        if (hasJoinedRoom && data.uuid !== UUID) {
            const greeting = `สวัสดี ${userName}`;

            console.log(`[${timestamp}] 👋 Greeting new participant`);
            console.log(`[${timestamp}] 🤖 Sending: "${greeting}"`);

            // Send greeting after 1 second delay
            setTimeout(() => {
                sendMessage(greeting);
            }, 1000);
        }
    });

    socket.on('new_gift', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const sender = data.pin_name || 'Someone';
        console.log(`[${timestamp}] 🎁 ${sender} sent a gift!`);
    });

    socket.on('new_reaction', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ❤️  Reaction received`);
    });

    socket.on('room_info', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ℹ️  Room info updated`);
    });

    // Handle exit
    process.on('SIGINT', () => {
        console.log('\n\n👋 Disconnecting...');
        if (socket) socket.disconnect();

        console.log('\n' + '='.repeat(80));
        console.log('📊 Session Summary');
        console.log('='.repeat(80));
        console.log(`Messages received: ${messageCount}`);
        console.log(`Room: ${topic}`);
        console.log('='.repeat(80));

        process.exit(0);
    });
}

// Main
(async () => {
    console.log('='.repeat(80));
    console.log('🤖 YelloTalk Chat Bot - Auto-Greeting Edition');
    console.log('='.repeat(80));

    // Fetch rooms
    console.log('\n🔍 Fetching active rooms...');
    const rooms = await fetchRooms();

    if (!rooms || rooms.length === 0) {
        console.log('❌ No active rooms found!');
        process.exit(1);
    }

    console.log(`✅ Found ${rooms.length} rooms`);

    // Display rooms
    displayRooms(rooms);

    // Get user input
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    readline.question(`➤ Select room (1-${Math.min(rooms.length, 15)}) or 'q' to quit: `, (answer) => {
        readline.close();

        if (answer.toLowerCase() === 'q') {
            console.log('👋 Goodbye!');
            process.exit(0);
        }

        const choice = parseInt(answer) - 1;
        if (choice >= 0 && choice < rooms.length) {
            const room = rooms[choice];
            console.log(`\n✅ Selected: ${room.topic?.substring(0, 50) || 'Untitled'}`);
            connectAndJoin(room);
        } else {
            console.log('❌ Invalid choice');
            process.exit(1);
        }
    });
})();
