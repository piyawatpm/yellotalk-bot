#!/usr/bin/env node
/**
 * Test server authorization for lock/unlock
 * Tries to lock a slot in a room we DON'T own
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
    // Get a popular room (we probably don't own it)
    const rooms = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
        headers: { 'Authorization': `Bearer ${TOKEN}` },
        httpsAgent
    });

    const room = rooms.data.json[0];
    const roomId = room.id;
    const ownerUuid = room.owner.uuid;
    const isOurRoom = (ownerUuid === UUID);

    console.log('Testing Authorization on Room:');
    console.log('  Topic:', room.topic);
    console.log('  Room ID:', roomId);
    console.log('  Owner UUID:', ownerUuid);
    console.log('  Our UUID:', UUID);
    console.log('  We are owner:', isOurRoom ? 'YES ✅' : 'NO ❌');
    console.log();

    if (isOurRoom) {
        console.log('⚠️  You own this room - test not valid');
        console.log('Lock/unlock will succeed because you\'re the owner');
        process.exit(0);
    }

    console.log('🧪 Testing: Can we lock a slot in a room we DON\'t own?');
    console.log('='.repeat(60));

    const socket = io('https://live.yellotalk.co:8443', {
        auth: { token: TOKEN },
        transports: ['websocket'],
        rejectUnauthorized: false
    });

    socket.on('connect', () => {
        console.log('\n✅ Connected to WebSocket');

        // Join the room first
        socket.emit('join_room', {
            room: roomId,
            uuid: UUID,
            avatar_id: 0,
            gme_id: String(room.gme_id),
            campus: room.owner.group_shortname,
            pin_name: 'test'
        }, (joinResp) => {
            console.log('✅ Joined room');

            // Now try to LOCK a slot (we're NOT the owner!)
            console.log('\n🔒 Attempting to lock slot 5 (we are NOT owner)...');

            socket.emit('lock_speaker', {
                room: roomId,
                position: 4
            }, (lockResp) => {
                console.log('\n📩 Server Response:');
                console.log(JSON.stringify(lockResp, null, 2));

                if (lockResp?.result === 200 || lockResp?.success) {
                    console.log('\n⚠️  SECURITY ISSUE: Lock succeeded without being owner!');
                    console.log('🚨 Server doesn\'t validate ownership properly!');
                } else if (lockResp?.result === 403 || lockResp?.error) {
                    console.log('\n✅ SECURE: Server rejected (not authorized)');
                    console.log('Authorization is properly enforced on server');
                } else if (!lockResp) {
                    console.log('\n⚠️  No response - server might be ignoring request');
                } else {
                    console.log('\n🤔 Unexpected response - check above');
                }

                socket.disconnect();
                process.exit(0);
            });
        });
    });

    socket.on('connect_error', (err) => {
        console.log('❌ Error:', err.message);
        process.exit(1);
    });
}

test().catch(err => {
    console.log('❌ Error:', err.message);
    process.exit(1);
});
