#!/usr/bin/env node
/**
 * Test: Listen for ALL events after sending lock
 * Maybe server broadcasts instead of sending ack
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

    console.log('Testing lock with FULL event monitoring...');
    console.log('Room:', room.topic);
    console.log('Owner:', room.owner.pin_name);
    console.log('You are owner?', room.owner.uuid === UUID ? 'YES' : 'NO');
    console.log();

    const socket = io('https://live.yellotalk.co:8443', {
        auth: { token: TOKEN },
        transports: ['websocket'],
        rejectUnauthorized: false
    });

    // Listen to EVERY event
    socket.onAny((eventName, data) => {
        const timestamp = new Date().toLocaleTimeString();
        const dataStr = typeof data === 'object' ? JSON.stringify(data).substring(0, 200) : data;
        console.log(`[${timestamp}] 📡 [${eventName}] ${dataStr}`);
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
            console.log('\n🔒 SENDING LOCK REQUEST FOR SLOT 2...\n');

            socket.emit('lock_speaker', {
                room: roomId,
                position: 1
            }, (ackResponse) => {
                console.log('\n✅ ACK CALLBACK RECEIVED:', ackResponse);
            });

            // Wait 10 seconds and watch for ANY event
            setTimeout(() => {
                console.log('\n⏱️  10 seconds elapsed');
                console.log('\n🎯 Results:');
                console.log('   If you saw an ACK → Server responded');
                console.log('   If you saw speaker/room events → Server broadcasts lock status');
                console.log('   If nothing → Server silently rejects (you\'re not owner)');

                socket.disconnect();
                process.exit(0);
            }, 10000);
        }, 3000);
    });
}

test();
