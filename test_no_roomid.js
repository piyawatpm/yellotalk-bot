#!/usr/bin/env node
/**
 * Test: Send lock WITHOUT room ID
 * Maybe server infers room from WebSocket session
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

    console.log('Testing lock WITHOUT room ID...');
    console.log('Room:', room.topic);
    console.log('Owner:', room.owner.uuid === UUID ? 'YOU' : 'NOT YOU');
    console.log();

    const socket = io('https://live.yellotalk.co:8443', {
        auth: { token: TOKEN },
        transports: ['websocket'],
        rejectUnauthorized: false
    });

    socket.onAny((event, data) => {
        console.log(`📡 [${event}]`, typeof data === 'string' ? data : JSON.stringify(data).substring(0, 100));
    });

    socket.on('connect', () => {
        console.log('✅ Connected\n');

        socket.emit('join_room', {
            room: roomId,
            uuid: UUID,
            avatar_id: 0,
            gme_id: String(room.gme_id),
            campus: room.owner.group_shortname,
            pin_name: config.pin_name
        });

        setTimeout(() => {
            console.log('🧪 Test 1: Lock WITH room ID (normal)\n');

            socket.emit('lock_speaker', {
                room: roomId,
                position: 3
            }, (resp) => {
                console.log('ACK 1:', resp);
            });

            setTimeout(() => {
                console.log('\n🧪 Test 2: Lock WITHOUT room ID (just position)\n');

                socket.emit('lock_speaker', {
                    position: 4
                }, (resp) => {
                    console.log('ACK 2:', resp);
                });

                setTimeout(() => {
                    console.log('\n🧪 Test 3: Lock with ONLY position (no object)\n');

                    socket.emit('lock_speaker', 5, (resp) => {
                        console.log('ACK 3:', resp);
                    });

                    setTimeout(() => {
                        console.log('\n⏱️  All tests complete');
                        socket.disconnect();
                        process.exit(0);
                    }, 3000);
                }, 3000);
            }, 3000);
        }, 3000);
    });
}

test();
