#!/usr/bin/env node
/**
 * Test if lock/unlock responses come as events (not ack)
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

    console.log('Room:', room.topic.substring(0, 40));
    console.log('Testing if lock response comes as EVENT (not ACK)...\n');

    const socket = io('https://live.yellotalk.co:8443', {
        auth: { token: TOKEN },
        transports: ['websocket'],
        rejectUnauthorized: false
    });

    // Listen for ALL events
    socket.onAny((eventName, data) => {
        console.log(`📡 Event: ${eventName}`);
        if (eventName.includes('lock') || eventName.includes('speaker') || eventName.includes('slot')) {
            console.log('   Data:', JSON.stringify(data).substring(0, 200));
        }
    });

    socket.on('connect', () => {
        console.log('✅ Connected\n');

        // Join
        socket.emit('join_room', {
            room: roomId,
            uuid: UUID,
            avatar_id: 0,
            gme_id: String(room.gme_id),
            campus: room.owner.group_shortname,
            pin_name: 'test'
        });

        setTimeout(() => {
            console.log('📤 Sending lock_speaker...\n');

            socket.emit('lock_speaker', {
                room: roomId,
                position: 4
            });

            // Wait and see what events come
            setTimeout(() => {
                console.log('\n⏱️  Waited 5 seconds - no lock event received');
                console.log('\n🎯 Conclusion:');
                console.log('Server either:');
                console.log('1. Silently rejects (most likely - we\'re not owner)');
                console.log('2. Sends no confirmation for lock/unlock');
                console.log('3. Only works for room owners');

                socket.disconnect();
                process.exit(0);
            }, 5000);
        }, 2000);
    });
}

test();
