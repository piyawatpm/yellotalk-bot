#!/usr/bin/env node
/**
 * YelloTalk Chat Bot - WORKING VERSION
 * Monitors YelloTalk room chat in real-time
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
    const roomId = room.id;
    const gmeId = String(room.gme_id || '');
    const topic = (room.topic || 'Untitled').substring(0, 60);
    const campus = room.owner?.group_shortname || 'No Group';

    console.log('\n' + '='.repeat(80));
    console.log(`🔌 Connecting to: ${topic}`);
    console.log('='.repeat(80));

    // Create Socket.IO connection
    const socket = io('https://live.yellotalk.co:8443', {
        auth: { token: TOKEN },
        transports: ['websocket'],
        rejectUnauthorized: false
    });

    socket.on('connect', () => {
        console.log('✅ Connected!');

        // Join room
        const joinData = {
            room: roomId,
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
            } else {
                console.log('⚠️  Join response:', response);
            }
        });

        // Load messages after joining
        setTimeout(() => {
            console.log('📜 Loading message history...');
            socket.emit('load_message', { room: roomId });

            console.log('\n' + '='.repeat(80));
            console.log('📺 LIVE CHAT FEED');
            console.log('='.repeat(80));
            console.log('Listening for new messages... (Press Ctrl+C to stop)\n');
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

    socket.on('speaker_changed', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const user = data.pin_name || 'User';
        console.log(`[${timestamp}] 🎤 ${user} speaker status changed`);
    });

    socket.on('participant_changed', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] 👥 Participants updated (${Array.isArray(data) ? data.length : '?'} total)`);
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
        socket.disconnect();

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
    console.log('🤖 YelloTalk Chat Bot');
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
