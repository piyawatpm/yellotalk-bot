#!/usr/bin/env node
/**
 * Test: Try undocumented REST API endpoints for speaker control
 */

const axios = require('axios');
const https = require('https');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const TOKEN = config.jwt_token;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function test() {
    // Get a room
    const rooms = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
        headers: { 'Authorization': `Bearer ${TOKEN}` },
        httpsAgent
    });

    const room = rooms.data.json[0];
    const roomId = room.id;

    console.log('Testing undocumented REST API endpoints...');
    console.log('Room:', room.topic);
    console.log();

    // Try various REST endpoints
    const tests = [
        // PATCH speakers
        { method: 'PATCH', url: `https://live.yellotalk.co/v1/rooms/${roomId}/speakers`, data: { position: 3, action: 'lock' } },
        { method: 'PATCH', url: `https://live.yellotalk.co/v1/rooms/${roomId}/speakers/3`, data: { locked: true } },

        // PUT speakers
        { method: 'PUT', url: `https://live.yellotalk.co/v1/rooms/${roomId}/speakers/3/lock`, data: {} },
        { method: 'PUT', url: `https://live.yellotalk.co/v1/rooms/${roomId}/speakers/3/unlock`, data: {} },

        // POST actions
        { method: 'POST', url: `https://live.yellotalk.co/v1/rooms/${roomId}/speakers/lock`, data: { position: 3 } },
        { method: 'POST', url: `https://live.yellotalk.co/v1/rooms/${roomId}/speakers/unlock`, data: { position: 3 } },
        { method: 'POST', url: `https://live.yellotalk.co/v1/rooms/${roomId}/speakers/3/lock`, data: {} },

        // Different paths
        { method: 'POST', url: `https://api.yellotalk.co/v1/rooms/${roomId}/lock-speaker`, data: { position: 3 } },
        { method: 'PATCH', url: `https://api.yellotalk.co/v1/live/rooms/${roomId}`, data: { speakers: [{ position: 3, locked: true }] } },
    ];

    for (const test of tests) {
        try {
            const result = await axios({
                method: test.method,
                url: test.url,
                data: test.data,
                headers: {
                    'Authorization': `Bearer ${TOKEN}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'ios'
                },
                httpsAgent,
                timeout: 3000
            });

            if (result.status === 200) {
                console.log(`✅ FOUND: ${test.method} ${test.url}`);
                console.log('   Response:', result.data);
            }
        } catch (err) {
            const status = err.response?.status;
            if (status && status !== 404) {
                console.log(`${status}: ${test.method} ${test.url}`);
                if (status === 200 || status === 201) {
                    console.log('   Response:', err.response.data);
                }
            }
        }
    }

    console.log('\nTest complete');
}

test().catch(err => console.log('Error:', err.message));
