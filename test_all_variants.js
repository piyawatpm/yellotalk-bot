#!/usr/bin/env node
/**
 * Test ALL possible event name variants
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

    console.log('Testing all event name variants...');
    console.log('Room:', room.topic);
    console.log();

    const socket = io('https://live.yellotalk.co:8443', {
        auth: { token: TOKEN },
        transports: ['websocket'],
        rejectUnauthorized: false
    });

    let eventsSeen = [];

    socket.onAny((event, data) => {
        eventsSeen.push(event);
        console.log(`📡 [${event}]`);

        if (event.includes('speaker') || event.includes('participant')) {
            console.log(`   Data:`, JSON.stringify(data).substring(0, 150));
        }
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
            // Try ALL possible event names
            const eventTests = [
                { name: 'speaker_action', payload: { action: 'unlock', position: 1 } },
                { name: 'action_speaker', payload: { action: 'unlock', position: 2 } },
                { name: 'speaker-action', payload: { action: 'unlock', position: 3 } },
                { name: 'speakerAction', payload: { action: 'unlock', position: 4 } },
                { name: 'update_speaker', payload: { position: 5, action: 'unlock' } },
                { name: 'modify_speaker', payload: { position: 6, locked: false } },
                { name: 'set_speaker', payload: { position: 7, locked: false } },
                { name: 'admin_unlock', payload: { position: 8 } },
                { name: 'force_unlock', payload: { position: 9 } },
            ];

            let i = 0;
            const tryNext = () => {
                if (i >= eventTests.length) {
                    setTimeout(() => {
                        console.log('\n✅ All tests complete');
                        console.log('\nEvents that got responses will show ACK');
                        console.log('Events seen:', eventsSeen.filter(e => e.includes('speaker') || e.includes('participant')));
                        socket.disconnect();
                        process.exit(0);
                    }, 2000);
                    return;
                }

                const test = eventTests[i];
                console.log(`\n🧪 Test ${i+1}: ${test.name}`);
                console.log(`   Payload:`, JSON.stringify(test.payload));

                socket.emit(test.name, test.payload, (resp) => {
                    if (resp) {
                        console.log(`   ✅ ACK RECEIVED:`, resp);
                    }
                });

                i++;
                setTimeout(tryNext, 2000);
            };

            tryNext();
        }, 2000);
    });
}

test();
