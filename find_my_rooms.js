#!/usr/bin/env node
// Find rooms YOU own (where you can lock/unlock)

const axios = require('axios');
const https = require('https');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const TOKEN = config.jwt_token;
const UUID = config.user_uuid;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

axios.get('https://live.yellotalk.co/v1/rooms?limit=100&offset=0', {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
    httpsAgent
}).then(resp => {
    const allRooms = resp.data.json || [];
    const myRooms = allRooms.filter(r => r.owner && r.owner.uuid === UUID);

    console.log('='.repeat(60));
    console.log(`Found ${myRooms.length} rooms YOU own:`);
    console.log('='.repeat(60));

    if (myRooms.length > 0) {
        myRooms.forEach((r, i) => {
            console.log(`\n${i + 1}. ${r.topic}`);
            console.log(`   ID: ${r.id}`);
            console.log(`   Participants: ${r.participants_count}`);
        });

        console.log('\n' + '='.repeat(60));
        console.log('✅ You CAN lock/unlock slots in these rooms!');
        console.log('='.repeat(60));
        console.log('\nTo test:');
        console.log(`  node test_lock.js ${myRooms[0].id}`);
    } else {
        console.log('\n⚠️  You don\'t own any active rooms');
        console.log('\nTo test lock/unlock:');
        console.log('1. Create a room in the YelloTalk app');
        console.log('2. Run this script again');
        console.log('3. Lock/unlock will work on YOUR room');
    }
}).catch(err => {
    console.log('Error:', err.message);
});
