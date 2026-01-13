// Test if lock/unlock uses REST API instead of WebSocket
const axios = require('axios');
const https = require('https');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const TOKEN = config.jwt_token;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function testRestAPI() {
    // Get a room
    const rooms = await axios.get('https://live.yellotalk.co/v1/rooms/popular', {
        headers: { 'Authorization': `Bearer ${TOKEN}` },
        httpsAgent
    });

    const room = rooms.data.json[0];
    const roomId = room.id;

    console.log('Testing REST API for lock/unlock');
    console.log('Room:', room.topic);
    console.log();

    // Try different REST endpoints
    const endpoints = [
        { method: 'POST', url: `https://live.yellotalk.co/v1/rooms/${roomId}/lock_speaker`, data: {position: 4} },
        { method: 'POST', url: `https://live.yellotalk.co/v1/rooms/${roomId}/speakers/lock`, data: {position: 4} },
        { method: 'PUT', url: `https://live.yellotalk.co/v1/rooms/${roomId}/speakers/4/lock`, data: {} },
        { method: 'PATCH', url: `https://live.yellotalk.co/v1/rooms/${roomId}/speakers`, data: {position: 4, action: 'lock'} },
        { method: 'POST', url: `https://api.yellotalk.co/v1/rooms/${roomId}/lock`, data: {position: 4} },
    ];

    for (const endpoint of endpoints) {
        try {
            const result = await axios({
                method: endpoint.method,
                url: endpoint.url,
                data: endpoint.data,
                headers: {
                    'Authorization': `Bearer ${TOKEN}`,
                    'Content-Type': 'application/json'
                },
                httpsAgent,
                timeout: 3000
            });

            if (result.status === 200) {
                console.log(`✅ FOUND: ${endpoint.method} ${endpoint.url}`);
                console.log('   Response:', result.data);
            }
        } catch (err) {
            const status = err.response?.status;
            if (status === 403 || status === 401) {
                console.log(`🔒 ${endpoint.method} ${endpoint.url} → ${status} (exists but unauthorized)`);
            } else if (status !== 404) {
                console.log(`⚠️  ${endpoint.method} ${endpoint.url} → ${status}`);
            }
        }
    }

    console.log('\n✅ Test complete');
}

testRestAPI().catch(err => console.log('Error:', err.message));
