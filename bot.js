#!/usr/bin/env node
/**
 * YelloTalk Chat Bot - With Auto-Greeting
 * Monitors chat and greets new participants
 */

const io = require('socket.io-client');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load config
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const TOKEN = config.jwt_token;
const API_URL = config.api_base_url;
const UUID = config.user_uuid;
const PIN_NAME = config.pin_name;
const AVATAR_ID = config.avatar_id;
const GEMINI_API_KEY = config.gemini_api_key;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

// Store conversation history per user (optional - for memory)
const conversationHistory = new Map();

let messageCount = 0;
let socket = null;
let currentRoomId = null;
let hasJoinedRoom = false;
let participantJoinTimes = new Map(); // Track when each participant joined
let currentParticipantsList = []; // Store current participants for quick access

// Keywords to detect (expandable for future features)
const KEYWORDS = {
    LIST_USERS: ['ใครบ้าง', 'มีใครบ้าง', 'list', 'users', 'who'],
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

// AI Response Handler
async function getAIResponse(userQuestion, userUuid, userName) {
    try {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] 🤖 Asking AI: "${userQuestion}"`);

        // Get or create conversation history for this user
        if (!conversationHistory.has(userUuid)) {
            conversationHistory.set(userUuid, []);
        }
        const history = conversationHistory.get(userUuid);

        // Start chat with history
        const chat = model.startChat({
            history: history,
            generationConfig: {
                maxOutputTokens: 500, // Limit response length for chat
            },
        });

        // Send message and get response
        const result = await chat.sendMessage(userQuestion);
        const response = result.response;
        const aiReply = response.text();

        // Update conversation history
        history.push(
            { role: 'user', parts: [{ text: userQuestion }] },
            { role: 'model', parts: [{ text: aiReply }] }
        );

        // Keep only last 10 messages (5 exchanges) to manage token usage
        if (history.length > 10) {
            history.splice(0, history.length - 10);
        }

        console.log(`[${timestamp}] 🤖 AI Response: "${aiReply.substring(0, 100)}..."`);
        return aiReply;

    } catch (error) {
        const timestamp = new Date().toLocaleTimeString();
        console.error(`[${timestamp}] ❌ AI Error:`, error.message);
        return `ขอโทษค่ะ เกิดข้อผิดพลาดในการประมวลผล: ${error.message}`;
    }
}

// Lock speaker slot
function lockSpeaker(position, room_id = null) {
    if (!socket || !socket.connected) {
        console.log('❌ Not connected to room');
        return;
    }

    // Try WITHOUT room ID (server might infer from session)
    const lockData = {
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
            console.log(`[${timestamp}] ⚠️  No response from server`);
        }
    });
}

// Unlock speaker slot
function unlockSpeaker(position, room_id = null) {
    if (!socket || !socket.connected) {
        console.log('❌ Not connected to room');
        return;
    }

    // Try WITHOUT room ID (server might infer from session)
    const unlockData = {
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
            console.log(`[${timestamp}] ⚠️  No response from server`);
        }
    });
}

// Mute speaker slot
function muteSpeaker(position) {
    if (!socket || !socket.connected) {
        console.log('❌ Not connected to room');
        return;
    }

    const muteData = {
        position: position
    };

    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🔇 Muting speaker slot ${position + 1}...`);
    console.log(`           Sending:`, JSON.stringify(muteData));

    socket.emit('mute_speaker', muteData, (response) => {
        if (response) {
            console.log(`[${timestamp}] ✅ Mute response:`, JSON.stringify(response).substring(0, 200));
        } else {
            console.log(`[${timestamp}] ⚠️  No response from server`);
        }
    });
}

// Unmute speaker slot
function unmuteSpeaker(position) {
    if (!socket || !socket.connected) {
        console.log('❌ Not connected to room');
        return;
    }

    const unmuteData = {
        position: position
    };

    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🔊 Unmuting speaker slot ${position + 1}...`);
    console.log(`           Sending:`, JSON.stringify(unmuteData));

    socket.emit('unmute_speaker', unmuteData, (response) => {
        if (response) {
            console.log(`[${timestamp}] ✅ Unmute response:`, JSON.stringify(response).substring(0, 200));
        } else {
            console.log(`[${timestamp}] ⚠️  No response from server`);
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
        } else if (cmd === 'mute' && parts.length === 2) {
            const position = parseInt(parts[1]);
            if (!isNaN(position) && position >= 1 && position <= 10) {
                muteSpeaker(position - 1);  // 0-indexed
            } else {
                console.log('❌ Position must be 1-10');
            }
        } else if (cmd === 'unmute' && parts.length === 2) {
            const position = parseInt(parts[1]);
            if (!isNaN(position) && position >= 1 && position <= 10) {
                unmuteSpeaker(position - 1);  // 0-indexed
            } else {
                console.log('❌ Position must be 1-10');
            }
        } else if (cmd === 'test' && parts.length === 3) {
            // Test alternative event names: test speaker_action 5
            const eventName = parts[1];
            const position = parseInt(parts[2]);

            if (!isNaN(position) && position >= 1 && position <= 10) {
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] 🧪 Testing event: ${eventName}`);
                console.log(`           Sending: ${eventName} with {action: 'unlock', position: ${position-1}}`);

                socket.emit(eventName, { action: 'unlock', position: position - 1 }, (resp) => {
                    if (resp) {
                        console.log(`[${timestamp}] ✅ Response:`, resp);
                    } else {
                        setTimeout(() => {
                            console.log(`[${timestamp}] ⚠️  No response after 2s`);
                        }, 2000);
                    }
                });
            } else {
                console.log('❌ Position must be 1-10');
            }
        } else if (cmd === 'combo' && parts.length === 2) {
            // Test sending unlock + get_participant together
            const position = parseInt(parts[1]);

            if (!isNaN(position) && position >= 1 && position <= 10) {
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] 🧪 Testing COMBO: unlock then get_participant`);

                // Send unlock
                socket.emit('unlock_speaker', { position: position - 1 }, (unlockResp) => {
                    console.log(`[${timestamp}] Unlock response:`, unlockResp);
                });

                // Wait 100ms, then send get_participant (force refresh)
                setTimeout(() => {
                    socket.emit('get_participant', { room: currentRoomId }, (resp) => {
                        console.log(`[${timestamp}] get_participant response:`, resp);
                    });
                }, 100);

                console.log(`           Watch for participant_changed event!`);
            } else {
                console.log('❌ Position must be 1-10');
            }
        } else if (cmd === 'withroom' && parts.length === 2) {
            // Test unlock WITH room ID (original way)
            const position = parseInt(parts[1]);

            if (!isNaN(position) && position >= 1 && position <= 10) {
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] 🧪 Testing unlock WITH room ID`);

                socket.emit('unlock_speaker', {
                    room: currentRoomId,
                    position: position - 1
                }, (resp) => {
                    if (resp) {
                        console.log(`[${timestamp}] ✅ Response:`, resp);
                    }
                });
            }
        } else if (cmd === 'sys' && parts.length === 2) {
            // Try unlock with targetUser: "system"
            const position = parseInt(parts[1]);

            if (!isNaN(position) && position >= 1 && position <= 10) {
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] 🧪 Testing unlock with targetUser: "system"`);

                socket.emit('unlock_speaker', {
                    position: position - 1,
                    targetUser: "system",
                    targetUuid: "system"
                }, (resp) => {
                    if (resp) {
                        console.log(`[${timestamp}] ✅ Response:`, resp);
                    }
                });
            }
        } else if (cmd === 'fullstate' && parts.length === 2) {
            // Try sending full room state update
            const position = parseInt(parts[1]);

            if (!isNaN(position) && position >= 1 && position <= 10) {
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] 🧪 Testing full state update (unlock position ${position})`);

                // Create speakers array with modified lock state
                const speakers = [];
                for (let i = 0; i < 10; i++) {
                    if (i === position - 1) {
                        // Unlocked position
                        speakers.push({ position: i, locked: false, role: 'speaker' });
                    } else {
                        // Keep others locked
                        speakers.push({ position: i, locked: true, role: 'locked' });
                    }
                }

                socket.emit('update_room_state', {
                    room: currentRoomId,
                    speakers: speakers
                }, (resp) => {
                    if (resp) {
                        console.log(`[${timestamp}] ✅ Response:`, resp);
                    }
                });
            }
        } else if (cmd === 'quit' || cmd === 'exit') {
            process.kill(process.pid, 'SIGINT');
        } else {
            console.log('❌ Unknown command');
            console.log('Try: msg, lock, unlock, mute, unmute, test, combo, sys, fullstate, quit');
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
function connectAndJoin(room, followUserUuid = null, followUserName = null) {
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
            console.log('  lock <1-10>   - Lock speaker slot (TEST if works without being owner!)');
            console.log('  unlock <1-10> - Unlock speaker slot (TEST if works without being owner!)');
            console.log('  mute <1-10>   - Mute speaker slot');
            console.log('  unmute <1-10> - Unmute speaker slot');
            console.log('  sys <pos>     - Test unlock with system target');
            console.log('  fullstate <pos> - Test full room state update');
            console.log('  test <event> <pos> - Test event name');
            console.log('  quit          - Exit bot');
            console.log();

            // Start command input handler
            startCommandInterface();
        }, 1000);
    });

    socket.on('disconnect', (reason) => {
        console.log(`\n⚠️  Disconnected: ${reason}`);

        // Clear all tracking when disconnected (room ended)
        participantJoinTimes.clear();
        currentParticipantsList = [];
        hasJoinedRoom = false;  // Reset for next room

        console.log(`[Cleared all participant tracking]`);

        // If in follow mode, start polling again
        if (followUserUuid) {
            console.log(`\n⏱️  Waiting for ${followUserName} to create a new room...`);
            console.log('   Checking every 5 seconds...\n');

            setTimeout(() => {
                startFollowPolling(followUserUuid, followUserName);
            }, 2000);
        }
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

            // IMPORTANT: Don't respond to bot responses (prevent infinite loop)
            if (message.includes('คนในห้องตอนนี้') && message.includes('คน):')) {
                // This is a bot's user list response, ignore it
                return;
            }

            // Check for @siri trigger (AI Response)
            if (messageLower.startsWith('@siri ')) {
                const question = message.substring(6).trim(); // Remove '@siri ' prefix

                // Validate: Must have a question after @siri
                if (question.length === 0) {
                    console.log(`[${timestamp}] ⚠️  Empty @siri question, ignoring`);
                    return;
                }

                // Validate: Question should be at least 2 characters
                if (question.length < 2) {
                    console.log(`[${timestamp}] ⚠️  @siri question too short, ignoring`);
                    return;
                }

                console.log(`[${timestamp}] 🤖 @siri triggered by ${sender}`);
                console.log(`           Question: "${question}"`);

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

            // Check for "list users" keywords
            if (KEYWORDS.LIST_USERS.some(keyword => messageLower.includes(keyword))) {
                console.log(`[${timestamp}] 🔍 Detected keyword: List users request`);

                // Filter out bot from list
                const usersWithoutBot = currentParticipantsList.filter(p => p.uuid !== UUID);

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

        // Log participant UUIDs for debugging
        if (participants.length <= 5) {
            console.log(`           👤 Participants:`, participants.map(p => p.pin_name).join(', '));
        }

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
        let newCount = 0;
        participants.forEach((participant, index) => {
            const uuid = participant.uuid;
            const userName = participant.pin_name || 'User';

            // Skip bot itself
            if (uuid === UUID) return;

            // New participant detected!
            if (!previousParticipants.has(uuid)) {
                // Also check if we already have join time (prevent duplicate greets)
                if (!participantJoinTimes.has(uuid)) {
                    newCount++;
                    const joinTime = new Date();
                    participantJoinTimes.set(uuid, { name: userName, joinTime: joinTime });

                    // Custom greetings
                    let greeting;

                    if (userName.includes('botyoi')) {
                        greeting = `สวัสดีพี่ชาย ${userName}`;
                    }
                    else if (userName.includes('rose')) {
                        greeting = `สวัสดีคนสวย ${userName}`;
                    }
                    else if (userName.includes('baby')) {
                        greeting = `สวัสดีคนสวย ${userName}`;
                    }
                    else if (userName.includes('somesome')) {
                        greeting = `Hi ${userName}`;
                    }
                    // Everyone else
                    else {
                        greeting = `สวัสดีสุดหล่อ ${userName}`;
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

            // Find who's new
            const currentUuids = new Set(participants.map(p => p.uuid));
            const previousUuids = new Set(previousParticipants.keys());

            console.log(`\n           Current UUIDs (${currentUuids.size}):`);
            participants.forEach((p, i) => {
                const isNew = !previousUuids.has(p.uuid);
                const isBot = p.uuid === UUID;
                const inJoinTimes = participantJoinTimes.has(p.uuid);

                console.log(`           ${i+1}. ${p.pin_name}`);
                console.log(`              UUID: ${p.uuid.substring(0, 20)}...`);
                console.log(`              New? ${isNew} | Bot? ${isBot} | HasJoinTime? ${inJoinTimes}`);
            });

            console.log(`\n           Previous UUIDs (${previousUuids.size}):`);
            Array.from(previousUuids).forEach((uuid, i) => {
                console.log(`           ${i+1}. ${uuid.substring(0, 20)}...`);
            });
        }

        // Find participants who LEFT
        let leftCount = 0;
        previousParticipants.forEach((prevName, prevUuid) => {
            if (prevUuid !== UUID && !currentParticipants.has(prevUuid)) {
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

        // Update previous participants list
        const oldSize = previousParticipants.size;
        previousParticipants = new Map(currentParticipants);
        const newSize = previousParticipants.size;

        // Debug: If same count but event fired, what changed?
        if (oldSize === newSize && oldSize > 0) {
            console.log(`[${timestamp}] 📊 Updated previousParticipants: ${oldSize} → ${newSize} (same count - refresh?)`);
        } else {
            console.log(`[${timestamp}] 📊 Updated previousParticipants: ${oldSize} → ${newSize}`);
        }

        // Update current participants list for keyword responses
        currentParticipantsList = participants;

        // DON'T check if target left via participant_changed
        // Owner might not be in participant list!
        // We'll detect room end via live_end/end_live events instead
    });

    socket.on('speaker_changed', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const speakers = Array.isArray(data) ? data : [data];

        console.log(`[${timestamp}] 🎤 Speaker changed (${speakers.length} speakers)`);

        // Log locked slots (with null check)
        const lockedSlots = speakers.filter(s => s && (s.role === 'locked' || s.pin_name === '🔒'));
        if (lockedSlots.length > 0) {
            console.log(`           🔒 Locked slots: ${lockedSlots.map(s => s.position).join(', ')}`);
        }

        // Log empty slots (with null check)
        const emptySlots = speakers.filter(s => s && (!s.pin_name || s.pin_name === ''));
        if (emptySlots.length > 0) {
            console.log(`           ⭕ Empty slots: ${emptySlots.map(s => s.position).join(', ')}`);
        }

        // Full data dump for debugging
        console.log(`           📋 Full speaker data:`, JSON.stringify(speakers).substring(0, 300));
    });

    // Catch ALL other events (might reveal botyoi's method)
    const knownEvents = new Set([
        'connect', 'disconnect', 'connect_error',
        'new_message', 'load_message', 'participant_changed',
        'speaker_changed', 'new_gift', 'new_reaction',
        'room_info', 'live_end', 'end_live', 'user_changed'
    ]);

    socket.onAny((eventName, data) => {
        if (!knownEvents.has(eventName)) {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`[${timestamp}] 🔍 UNKNOWN EVENT: [${eventName}]`);
            console.log(`           Data:`, JSON.stringify(data).substring(0, 200));
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

    // Detect room end
    socket.on('live_end', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`\n[${timestamp}] 🔚 Room ended!`);

        if (followUserUuid) {
            console.log(`[${timestamp}] 🔄 Waiting for ${followUserName}'s next room...\n`);
            setTimeout(() => {
                if (socket) socket.disconnect();
            }, 1000);
        }
    });

    socket.on('end_live', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`\n[${timestamp}] 🔚 Room closed!`);

        if (followUserUuid) {
            console.log(`[${timestamp}] 🔄 Waiting for ${followUserName}'s next room...\n`);
            setTimeout(() => {
                if (socket) socket.disconnect();
            }, 1000);
        }
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

// Polling function for follow mode
async function startFollowPolling(targetUserUuid, targetUserName) {
    let checkCount = 0;
    let interval = null;  // Declare interval first!

    const checkForRoom = async () => {
        checkCount++;
        const now = new Date().toLocaleTimeString();

        console.log(`[${now}] 🔍 Check #${checkCount} - Looking for ${targetUserName}'s room...`);

        const rooms = await fetchRooms();
        const foundRoom = rooms.find(r => r.owner?.uuid === targetUserUuid);

        if (foundRoom) {
            console.log(`\n✅ FOUND ${targetUserName}'s room!`);
            console.log(`   Topic: ${foundRoom.topic}`);
            console.log(`   Joining now...\n`);

            if (interval) clearInterval(interval);  // Clear if exists
            connectAndJoin(foundRoom, targetUserUuid, targetUserName);
        } else {
            console.log(`         ❌ No room - waiting 5s...`);
        }
    };

    // Start checking every 5 seconds
    interval = setInterval(checkForRoom, 5000);

    // Also check immediately (first check)
    await checkForRoom();
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
                connectAndJoin(targetRoom, targetUserUuid, targetUserName);
            } else {
                // Start polling
                console.log('\n⏱️  Waiting for them to create a room...');
                console.log('   Checking every 5 seconds...\n');

                startFollowPolling(targetUserUuid, targetUserName);
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
            // Follow user mode - shows all owners, user selects
            await followUserMode();
        } else if (mode === '2') {
            // Regular mode - select room from list
            await regularMode();
        } else {
            console.log('❌ Invalid mode');
            process.exit(1);
        }
    });
})();
