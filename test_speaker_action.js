#!/usr/bin/env node
/**
 * Test: Try 'speaker_action' event (like their API path suggests)
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

    console.log('Testing alternative event names...');
    console.log('Room:', room.topic);
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
            // Test 1: speaker_action (like their API path)
            console.log('🧪 Test 1: speaker_action event\n');

            socket.emit('speaker_action', {
                action: 'unlock',
                position: 2
            }, (resp) => {
                console.log('ACK 1:', resp);
            });

            setTimeout(() => {
                // Test 2: action_speaker
                console.log('\n🧪 Test 2: action_speaker event\n');

                socket.emit('action_speaker', {
                    action: 'unlock',
                    position: 3
                }, (resp) => {
                    console.log('ACK 2:', resp);
                });

                setTimeout(() => {
                    // Test 3: update_speaker
                    console.log('\n🧪 Test 3: update_speaker event\n');

                    socket.emit('update_speaker', {
                        position: 4,
                        locked: false
                    }, (resp) => {
                        console.log('ACK 3:', resp);
                    });

                    setTimeout(() => {
                        console.log('\n✅ Tests complete');
                        socket.disconnect();
                        process.exit(0);
                    }, 3000);
                }, 3000);
            }, 3000);
        }, 3000);
    });
}

test();
