#!/usr/bin/env node
/**
 * Comprehensive test - Listen for EVERY event after lock attempt
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

    console.log('Room:', room.topic);
    console.log('Testing with FULL event monitoring...\n');

    const socket = io('https://live.yellotalk.co:8443', {
        auth: { token: TOKEN },
        transports: ['websocket'],
        rejectUnauthorized: false
    });

    // Listen to EVERY single event
    socket.onAny((eventName, data) => {
        console.log(`📡 [${eventName}]`, typeof data === 'object' ? JSON.stringify(data).substring(0, 150) : data);
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
            console.log('\n🔒 SENDING LOCK REQUEST...\n');

            socket.emit('lock_speaker', {
                room: roomId,
                position: 4
            }, (ackData) => {
                console.log('\n✅ ACK RECEIVED:', ackData);
            });

            // Wait and watch for ANY event that might be the response
            setTimeout(() => {
                console.log('\n⏱️  15 seconds elapsed');
                console.log('If you saw NO lock-related events above,');
                console.log('server is silently rejecting (you\'re not owner)');

                socket.disconnect();
                process.exit(0);
            }, 15000);
        }, 3000);
    });
}

test();
