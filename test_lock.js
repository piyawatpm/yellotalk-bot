#!/usr/bin/env node
/**
 * Test lock/unlock speaker slots
 */

const io = require('socket.io-client');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const TOKEN = config.jwt_token;
const UUID = config.user_uuid;
const PIN_NAME = config.pin_name;

// Use a room where you're the owner!
const ROOM_ID = process.argv[2];

if (!ROOM_ID) {
    console.log('Usage: node test_lock.js <room_id>');
    console.log('\n⚠️  You must use a room where YOU are the owner!');
    process.exit(1);
}

console.log('Testing lock/unlock on room:', ROOM_ID);
console.log('⚠️  Note: This only works if you are the room owner!\n');

const socket = io('https://live.yellotalk.co:8443', {
    auth: { token: TOKEN },
    transports: ['websocket'],
    rejectUnauthorized: false
});

socket.on('connect', () => {
    console.log('✅ Connected!');

    // Join room
    const joinData = {
        room: ROOM_ID,
        uuid: UUID,
        pin_name: PIN_NAME,
        avatar_id: 0
    };

    socket.emit('join_room', joinData, (joinResponse) => {
        console.log('✅ Join response:', JSON.stringify(joinResponse, null, 2).substring(0, 300));

        // Check if we're the owner
        const ownerUuid = joinResponse?.room?.owner?.uuid;
        if (ownerUuid === UUID) {
            console.log('✅ You are the owner! Lock/unlock should work.\n');
        } else {
            console.log(`⚠️  You are NOT the owner (owner: ${ownerUuid})`);
            console.log('   Lock/unlock might not work!\n');
        }

        // Test lock slot 5
        setTimeout(() => {
            console.log('Testing: Lock slot 5...');

            const lockData = { room: ROOM_ID, position: 4 };  // 0-indexed
            socket.emit('lock_speaker', lockData, (response) => {
                console.log('🔒 Lock response:', response);
            });

            // Test unlock slot 5
            setTimeout(() => {
                console.log('\nTesting: Unlock slot 5...');

                const unlockData = { room: ROOM_ID, position: 4 };
                socket.emit('unlock_speaker', unlockData, (response) => {
                    console.log('🔓 Unlock response:', response);

                    // Done
                    setTimeout(() => {
                        console.log('\n✅ Test complete!');
                        socket.disconnect();
                        process.exit(0);
                    }, 1000);
                });
            }, 2000);
        }, 2000);
    });
});

socket.on('connect_error', (error) => {
    console.log('❌ Error:', error.message);
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
});
