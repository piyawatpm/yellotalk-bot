#!/usr/bin/env node
/**
 * Test: Join as SPEAKER then try lock/unlock
 * Maybe speakers can lock their own position!
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

    console.log('Room:', room.topic.substring(0, 40));
    console.log('Testing: Join as SPEAKER, then lock/unlock\n');

    const socket = io('https://live.yellotalk.co:8443', {
        auth: { token: TOKEN },
        transports: ['websocket'],
        rejectUnauthorized: false
    });

    socket.on('connect', () => {
        console.log('✅ Connected');

        // Step 1: Join room as participant
        socket.emit('join_room', {
            room: roomId,
            uuid: UUID,
            avatar_id: 0,
            gme_id: gmeId,
            campus: room.owner.group_shortname,
            pin_name: config.pin_name
        }, (resp) => {
            console.log('✅ Joined room as participant');

            setTimeout(() => {
                // Step 2: Join as SPEAKER (request speaker slot)
                console.log('\n🎤 Requesting to join as speaker (position 5)...');

                socket.emit('join_speaker', {
                    room: roomId,
                    uuid: UUID,
                    position: 4  // Request position 5 (0-indexed)
                }, (speakerResp) => {
                    console.log('Speaker response:', speakerResp);

                    setTimeout(() => {
                        // Step 3: Now try to lock OUR position
                        console.log('\n🔒 Trying to lock OUR speaker position (5)...');

                        socket.emit('lock_speaker', {
                            room: roomId,
                            position: 4
                        }, (lockResp) => {
                            console.log('Lock response:', lockResp);

                            if (lockResp) {
                                console.log('\n✅ Got response!');
                                if (lockResp.result === 200) {
                                    console.log('🎉 SUCCESS - Speakers CAN lock their position!');
                                }
                            } else {
                                console.log('\n⚠️  No response');
                            }

                            setTimeout(() => {
                                socket.disconnect();
                                process.exit(0);
                            }, 2000);
                        });
                    }, 2000);
                });
            }, 2000);
        });
    });

    // Listen for speaker_changed event
    socket.on('speaker_changed', (data) => {
        console.log('📡 speaker_changed:', Array.isArray(data) ? `${data.length} speakers` : data);
    });
}

test();
