#!/usr/bin/env node
/**
 * YelloTalk Bot - Follow User Mode
 * Waits for a specific user to create a room, then auto-joins
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

// Target user to follow
const TARGET_USER_UUID = process.argv[2];
const CHECK_INTERVAL = 5000; // 5 seconds

if (!TARGET_USER_UUID) {
    console.log('Usage: node follow_user.js <target_user_uuid>');
    console.log('');
    console.log('Example: node follow_user.js 4A00FD02-5F23-4B4E-94AB-1D6DC7B65EED');
    console.log('');
    console.log('To find user UUIDs:');
    console.log('  node bot.js');
    console.log('  Join a room and look at participant_changed events');
    process.exit(1);
}

console.log('='.repeat(80));
console.log('🎯 YelloTalk Bot - Follow User Mode');
console.log('='.repeat(80));
console.log(`Target User UUID: ${TARGET_USER_UUID}`);
console.log(`Check Interval: ${CHECK_INTERVAL / 1000} seconds`);
console.log('');

// Fetch all rooms
async function fetchAllRooms() {
    try {
        const response = await axios.get(`${API_URL}/v1/rooms?limit=100&offset=0`, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'User-Agent': 'ios'
            },
            httpsAgent,
            timeout: 10000
        });

        return response.data.json || [];
    } catch (error) {
        console.log('⚠️  Error fetching rooms:', error.message);
        return [];
    }
}

// Find room by target user (as owner)
async function findTargetUserRoom() {
    const allRooms = await fetchAllRooms();

    if (allRooms.length === 0) {
        return null;
    }

    // Find room where target user is the owner
    const targetRoom = allRooms.find(room => {
        return room.owner && room.owner.uuid === TARGET_USER_UUID;
    });

    return targetRoom;
}

// Join room and monitor
function joinRoom(room) {
    console.log('\n' + '='.repeat(80));
    console.log(`✅ FOUND TARGET USER'S ROOM!`);
    console.log('='.repeat(80));
    console.log(`Room: ${room.topic}`);
    console.log(`Owner: ${room.owner.pin_name}`);
    console.log(`Room ID: ${room.id}`);
    console.log(`Participants: ${room.participants_count}`);
    console.log('');

    const roomId = room.id;
    const gmeId = String(room.gme_id || '');
    const campus = room.owner.group_shortname || 'No Group';

    const socket = io('https://live.yellotalk.co:8443', {
        auth: { token: TOKEN },
        transports: ['websocket'],
        rejectUnauthorized: false
    });

    socket.on('connect', () => {
        console.log('🔌 Connected to room!');

        // Join room
        socket.emit('join_room', {
            room: roomId,
            uuid: UUID,
            avatar_id: AVATAR_ID,
            gme_id: gmeId,
            campus: campus,
            pin_name: PIN_NAME
        }, (response) => {
            if (response?.result === 200) {
                console.log('✅ Successfully joined!');
                console.log('');
                console.log('📺 Now monitoring chat...');
                console.log('(Press Ctrl+C to stop)');
                console.log('');
            }
        });

        // Load messages
        setTimeout(() => {
            socket.emit('load_message', { room: roomId });
        }, 1000);
    });

    // Show messages
    socket.on('new_message', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const sender = data.pin_name || 'Unknown';
        const message = data.message || '';

        console.log(`[${timestamp}] 💬 ${sender}: ${message}`);
    });

    // Show when target user leaves
    socket.on('participant_changed', (participants) => {
        const timestamp = new Date().toLocaleTimeString();
        const isTargetStillHere = participants.some(p => p.uuid === TARGET_USER_UUID);

        if (!isTargetStillHere) {
            console.log(`\n[${timestamp}] ⚠️  Target user left the room!`);
            console.log('Disconnecting...');
            socket.disconnect();
            process.exit(0);
        }
    });

    socket.on('disconnect', (reason) => {
        console.log(`\n⚠️  Disconnected: ${reason}`);
    });

    // Handle exit
    process.on('SIGINT', () => {
        console.log('\n\n👋 Stopping...');
        socket.disconnect();
        process.exit(0);
    });
}

// Main loop - keep checking for target user's room
async function followUser() {
    let checkCount = 0;

    console.log('🔍 Searching for target user\'s room...');
    console.log('');

    const checkInterval = setInterval(async () => {
        checkCount++;
        const now = new Date().toLocaleTimeString();

        console.log(`[${now}] 🔍 Check #${checkCount} - Scanning rooms...`);

        const targetRoom = await findTargetUserRoom();

        if (targetRoom) {
            clearInterval(checkInterval);
            joinRoom(targetRoom);
        } else {
            console.log(`         ❌ Target user not found - waiting ${CHECK_INTERVAL / 1000}s...`);
        }
    }, CHECK_INTERVAL);

    // Initial check (don't wait 5 seconds)
    const initialRoom = await findTargetUserRoom();
    if (initialRoom) {
        clearInterval(checkInterval);
        joinRoom(initialRoom);
    }
}

// Start
followUser();
