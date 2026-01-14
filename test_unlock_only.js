#!/usr/bin/env node
/**
 * Test: Can we UNLOCK locked slots (not lock)?
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

    console.log('Testing UNLOCK on empty/locked slot...');
    console.log('Room:', room.topic);
    console.log();

    const socket = io('https://live.yellotalk.co:8443', {
        auth: { token: TOKEN },
        transports: ['websocket'],
        rejectUnauthorized: false
    });

    socket.onAny((eventName, data) => {
        console.log(`📡 [${eventName}]`, typeof data === 'string' ? data : JSON.stringify(data).substring(0, 150));
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
            console.log('🔓 TRYING TO UNLOCK SLOT 1 (likely locked/empty)...\n');

            socket.emit('unlock_speaker', {
                room: roomId,
                position: 0  // Slot 1
            }, (response) => {
                console.log('\n✅ UNLOCK ACK:', response);

                if (response) {
                    console.log('\n🎉 GOT RESPONSE!');
                    if (response.result === 200) {
                        console.log('✅ UNLOCK WORKED! Anyone can unlock locked slots!');
                    } else {
                        console.log('❌ UNLOCK FAILED:', response);
                    }
                }

                setTimeout(() => {
                    socket.disconnect();
                    process.exit(0);
                }, 2000);
            });
        }, 3000);
    });
}

test();
