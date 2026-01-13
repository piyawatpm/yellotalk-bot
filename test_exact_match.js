#!/usr/bin/env node
/**
 * Test lock with EXACT same format as Android app
 * Including ALL fields (even null ones)
 */

const io = require('socket.io-client');
const axios = require('axios');
const https = require('https');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const TOKEN = config.jwt_token;
const UUID = config.user_uuid;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function test() {
    const rooms = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
        headers: { 'Authorization': `Bearer ${TOKEN}` },
        httpsAgent
    });

    const room = rooms.data.json[0];
    const roomId = room.id;
    const gmeId = String(room.gme_id);

    console.log('Testing room:', room.topic);
    console.log('Room ID:', roomId);
    console.log('Owner:', room.owner.uuid === UUID ? 'YOU ✅' : 'NOT YOU ❌');
    console.log();

    const socket = io('https://live.yellotalk.co:8443', {
        auth: { token: TOKEN },
        transports: ['websocket'],
        rejectUnauthorized: false
    });

    socket.on('connect', () => {
        console.log('✅ Connected');

        // Join room
        socket.emit('join_room', {
            room: roomId,
            uuid: UUID,
            avatar_id: 0,
            gme_id: gmeId,
            campus: room.owner.group_shortname,
            pin_name: config.pin_name
        }, (resp) => {
            console.log('✅ Joined');

            // Test 3 different lock formats

            // Format 1: Minimal (what we're currently sending)
            console.log('\n🧪 Test 1: Minimal format');
            const lockMinimal = {
                room: roomId,
                position: 4
            };
            console.log('Sending:', JSON.stringify(lockMinimal));
            socket.emit('lock_speaker', lockMinimal, (r) => {
                console.log('Response:', r);
            });

            setTimeout(() => {
                // Format 2: With ALL null fields (like Android)
                console.log('\n🧪 Test 2: Android format with nulls');
                const lockAndroid = {
                    room: roomId,
                    uuid: null,
                    position: 4,
                    avatar_id: null,
                    gme_id: null,
                    campus: null,
                    pin_name: null,
                    message: null,
                    reaction: null,
                    reason_id: null,
                    reason_text: null,
                    target_user: null,
                    target_uuid: null,
                    limit_speaker: null
                };
                console.log('Sending:', JSON.stringify(lockAndroid));
                socket.emit('lock_speaker', lockAndroid, (r) => {
                    console.log('Response:', r);
                });
            }, 2000);

            setTimeout(() => {
                // Format 3: Without nulls (Gson default)
                console.log('\n🧪 Test 3: Without null fields');
                const lockClean = { room: roomId, position: 4 };
                console.log('Sending:', JSON.stringify(lockClean));
                socket.emit('lock_speaker', lockClean, (r) => {
                    console.log('Response:', r);

                    setTimeout(() => {
                        console.log('\n✅ All tests complete');
                        socket.disconnect();
                        process.exit(0);
                    }, 1000);
                });
            }, 4000);
        });
    });
}

test().catch(err => console.log('Error:', err.message));
