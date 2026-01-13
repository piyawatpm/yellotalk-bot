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
let participantJoinTimes = new Map(); // Track when each participant joined
let currentParticipantsList = []; // Store current participants for quick access

// Keywords to detect (expandable for future features)
const KEYWORDS = {
    LIST_USERS: ['ใครบ้าง', 'คนในห้อง', 'มีใครบ้าง', 'list', 'users', 'who'],
};

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
    console.log(`           Sending:`, JSON.stringify(lockData));

    socket.emit('lock_speaker', lockData, (response) => {
        if (response) {
            console.log(`[${timestamp}] ✅ Lock response:`, JSON.stringify(response).substring(0, 200));
            if (response.result === 200 || response.success) {
                console.log(`[${timestamp}] ✅ Slot ${position + 1} locked successfully!`);
            } else {
                console.log(`[${timestamp}] ⚠️  Lock failed:`, response.message || response.error || 'Unknown error');
            }
        } else {
            console.log(`[${timestamp}] ⚠️  No response from server (might not be owner)`);
        }
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
    console.log(`           Sending:`, JSON.stringify(unlockData));

    socket.emit('unlock_speaker', unlockData, (response) => {
        if (response) {
            console.log(`[${timestamp}] ✅ Unlock response:`, JSON.stringify(response).substring(0, 200));
            if (response.result === 200 || response.success) {
                console.log(`[${timestamp}] ✅ Slot ${position + 1} unlocked successfully!`);
            } else {
                console.log(`[${timestamp}] ⚠️  Unlock failed:`, response.message || response.error || 'Unknown error');
            }
        } else {
            console.log(`[${timestamp}] ⚠️  No response from server (might not be owner)`);
        }
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
                // DON'T set hasJoinedRoom here - let participant_changed handle it
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
        const senderUuid = data.uuid;

        console.log(`\n[${timestamp}] 💬 ${sender}:`);
        console.log(`           ${message}`);

        // Keyword detection (don't respond to our own messages)
        if (senderUuid !== UUID) {
            const messageLower = message.toLowerCase();

            // Check for "list users" keywords
            if (KEYWORDS.LIST_USERS.some(keyword => messageLower.includes(keyword))) {
                console.log(`[${timestamp}] 🔍 Detected keyword: List users request`);

                // Filter out bot from list
                const usersWithoutBot = currentParticipantsList.filter(p => p.uuid !== UUID);

                if (usersWithoutBot.length === 0) {
                    console.log(`[${timestamp}] ⚠️  Participant list not loaded yet`);
                    return;
                }

                // Build numbered user list
                const userList = usersWithoutBot
                    .map((p, i) => `${i + 1}. ${p.pin_name}`)
                    .join('\n');

                const response = `คนในห้องตอนนี้ (${usersWithoutBot.length} คน):\n${userList}`;

                console.log(`[${timestamp}] 🤖 Auto-responding with user list (${usersWithoutBot.length} users)`);

                setTimeout(() => {
                    sendMessage(response);
                }, 800);
            }
        }
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

    let previousParticipants = new Map(); // uuid -> name

    // Auto-greet NEW participants and say goodbye when they leave
    socket.on('participant_changed', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const participants = Array.isArray(data) ? data : [];

        console.log(`[${timestamp}] 👥 Participants updated (${participants.length} total)`);

        // Build current participant map
        const currentParticipants = new Map();
        participants.forEach(p => {
            currentParticipants.set(p.uuid, p.pin_name || 'User');
        });

        // FIRST TIME: Save existing participants, DON'T greet anyone
        if (!hasJoinedRoom) {
            previousParticipants = new Map(currentParticipants);

            // Record join times for everyone currently in room (for future bye messages)
            participants.forEach(p => {
                if (p.uuid !== UUID) {
                    participantJoinTimes.set(p.uuid, {
                        name: p.pin_name || 'User',
                        joinTime: new Date()
                    });
                }
            });

            hasJoinedRoom = true;
            console.log(`[${timestamp}] 📋 Initial state saved - NOT greeting existing ${participants.length} participants`);

            // Update current list BEFORE returning!
            currentParticipantsList = participants;
            return;  // Exit - don't greet anyone on initial join!
        }

        // Find NEW participants (joined)
        participants.forEach((participant, index) => {
            const uuid = participant.uuid;
            const userName = participant.pin_name || 'User';

            // New participant detected!
            if (uuid !== UUID && !previousParticipants.has(uuid)) {
                // Also check if we already have join time (prevent duplicate greets)
                if (!participantJoinTimes.has(uuid)) {
                    const joinTime = new Date();
                    participantJoinTimes.set(uuid, { name: userName, joinTime: joinTime });

                    const greeting = `สวัสดี ${userName}`;

                    console.log(`[${timestamp}] 👋 ${userName} joined`);
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

        // Find participants who LEFT
        previousParticipants.forEach((prevName, prevUuid) => {
            if (prevUuid !== UUID && !currentParticipants.has(prevUuid)) {
                // This participant left!
                const joinInfo = participantJoinTimes.get(prevUuid);
                if (joinInfo) {
                    const leaveTime = new Date();
                    const duration = leaveTime - joinInfo.joinTime;
                    const minutes = Math.floor(duration / 60000);
                    const seconds = Math.floor((duration % 60000) / 1000);

                    const userName = joinInfo.name;
                    const timeStr = minutes > 0 ? `${minutes}นาที ${seconds}วินาที` : `${seconds}วินาที`;
                    const goodbye = `bye~ ${userName} (อยู่ ${timeStr})`;

                    console.log(`[${timestamp}] 👋 ${userName} left after ${timeStr}`);
                    console.log(`[${timestamp}] 🤖 Sending: "${goodbye}"`);

                    setTimeout(() => {
                        sendMessage(goodbye);
                    }, 800);

                    // Clean up
                    participantJoinTimes.delete(prevUuid);
                }
            }
        });

        // Update previous participants list
        previousParticipants = new Map(currentParticipants);

        // Update current participants list for keyword responses
        currentParticipantsList = participants;
    });

    socket.on('speaker_changed', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const speakers = Array.isArray(data) ? data : [data];
        console.log(`[${timestamp}] 🎤 Speaker changed (${speakers.length} speakers)`);
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

// Follow specific user (mode 1)
async function followUserMode() {
    console.log('\n' + '='.repeat(80));
    console.log('🎯 Follow User Mode');
    console.log('='.repeat(80));

    // First, fetch ALL rooms and show owners
    console.log('\n🔍 Fetching all rooms and owners...');
    const allRooms = await fetchRooms();

    if (!allRooms || allRooms.length === 0) {
        console.log('❌ No rooms found!');
        process.exit(1);
    }

    console.log(`✅ Found ${allRooms.length} rooms\n`);

    // Display rooms with owners
    console.log('='.repeat(80));
    console.log('📋 ROOM OWNERS');
    console.log('='.repeat(80) + '\n');

    allRooms.slice(0, 20).forEach((room, i) => {
        const topic = (room.topic || 'Untitled').substring(0, 40);
        const ownerName = (room.owner?.pin_name || 'Unknown').substring(0, 25);
        const ownerUuid = room.owner?.uuid || 'N/A';
        const participants = room.participants_count || 0;

        console.log(`${String(i + 1).padStart(2)}. ${ownerName}`);
        console.log(`    Room: ${topic}`);
        console.log(`    UUID: ${ownerUuid}`);
        console.log(`    👥 ${participants} people`);
        console.log();
    });

    // Select target owner
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    readline.question(`➤ Select user to follow (1-${Math.min(allRooms.length, 20)}) or 'q' to quit: `, async (answer) => {
        readline.close();

        if (answer.toLowerCase() === 'q') {
            console.log('👋 Goodbye!');
            process.exit(0);
        }

        const choice = parseInt(answer) - 1;
        if (choice >= 0 && choice < allRooms.length) {
            const targetRoom = allRooms[choice];
            const targetUserUuid = targetRoom.owner.uuid;
            const targetUserName = targetRoom.owner.pin_name;

            console.log(`\n✅ Following: ${targetUserName}`);
            console.log(`   UUID: ${targetUserUuid}`);

            // Check if they have a room NOW
            if (targetRoom.participants_count !== undefined) {
                console.log(`\n✅ They have an active room right now!`);
                console.log(`   Joining immediately...\n`);
                connectAndJoin(targetRoom);
            } else {
                // Start polling
                console.log('\n⏱️  Waiting for them to create a room...');
                console.log('   Checking every 5 seconds...\n');

                let checkCount = 0;

                const checkForRoom = async () => {
                    checkCount++;
                    const now = new Date().toLocaleTimeString();

                    console.log(`[${now}] 🔍 Check #${checkCount} - Scanning...`);

                    const rooms = await fetchRooms();
                    const foundRoom = rooms.find(r => r.owner?.uuid === targetUserUuid);

                    if (foundRoom) {
                        console.log(`\n✅ FOUND ${targetUserName}'s room!`);
                        console.log(`   Topic: ${foundRoom.topic}`);
                        console.log(`   Joining now...\n`);

                        clearInterval(interval);
                        connectAndJoin(foundRoom);
                    } else {
                        console.log(`         ❌ No room yet - waiting 5s...`);
                    }
                };

                // Check immediately
                await checkForRoom();

                // Then check every 5 seconds
                const interval = setInterval(checkForRoom, 5000);
            }
        } else {
            console.log('❌ Invalid choice');
            process.exit(1);
        }
    });
}

// Regular mode (mode 2)
async function regularMode() {
    console.log('\n🔍 Fetching active rooms...');
    const rooms = await fetchRooms();

    if (!rooms || rooms.length === 0) {
        console.log('❌ No active rooms found!');
        process.exit(1);
    }

    console.log(`✅ Found ${rooms.length} rooms`);
    displayRooms(rooms);

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
}

// Main
(async () => {
    console.log('='.repeat(80));
    console.log('🤖 YelloTalk Chat Bot');
    console.log('='.repeat(80));

    // Mode selection
    console.log('\nSelect Mode:');
    console.log('  1. Follow User   - Auto-join when specific user creates room');
    console.log('  2. Regular       - Select room from list');
    console.log('');

    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    readline.question('➤ Mode (1 or 2): ', async (mode) => {
        readline.close();

        if (mode === '1') {
            // Follow user mode
            const rl2 = require('readline').createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl2.question('➤ Enter target user UUID: ', async (targetUuid) => {
                rl2.close();

                if (!targetUuid || targetUuid.length < 10) {
                    console.log('❌ Invalid UUID');
                    process.exit(1);
                }

                await followUserMode(targetUuid.trim());
            });
        } else if (mode === '2') {
            // Regular mode
            await regularMode();
        } else {
            console.log('❌ Invalid mode');
            process.exit(1);
        }
    });
})();
