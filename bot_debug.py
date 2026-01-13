#!/usr/bin/env python3
"""
YelloTalk Bot - DEBUG VERSION
Shows ALL WebSocket traffic to debug message reception
"""

import asyncio
import websockets
import ssl
import json
import requests
import urllib3
from datetime import datetime

urllib3.disable_warnings()

class YelloTalkBotDebug:
    def __init__(self):
        with open('config.json') as f:
            config = json.load(f)

        self.token = config['jwt_token']
        self.ws_url = config['websocket_url']
        self.api_url = config['api_base_url']
        self.uuid = config['user_uuid']
        self.pin_name = config['pin_name']
        self.avatar_id = config['avatar_id']

        self.headers = {
            'Authorization': f'Bearer {self.token}',
            'User-Agent': 'ios',
            'x-app-version': '4.4.9'
        }

    def fetch_rooms(self):
        resp = requests.get(
            f'{self.api_url}/v1/rooms/popular',
            headers=self.headers,
            verify=False,
            timeout=10
        )
        return resp.json().get('json', [])

    async def monitor_room(self, room_id):
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

        print(f"\n🔌 Connecting...")

        async with websockets.connect(self.ws_url, ssl=ssl_ctx) as ws:
            # Handshake
            msg = await ws.recv()
            print(f"➤ RECV: {msg}")
            handshake = json.loads(msg[1:])

            # Auth
            auth_msg = f'40{json.dumps({"token": self.token})}'
            print(f"➤ SEND: {auth_msg[:80]}...")
            await ws.send(auth_msg)

            msg = await ws.recv()
            print(f"➤ RECV: {msg}")

            # Join room - try BOTH field name variants
            print(f"\n📥 Joining room...")

            # Variant 1: "room" field
            join_data_v1 = {
                "room": room_id,
                "uuid": self.uuid,
                "avatar_id": self.avatar_id,
                "pin_name": self.pin_name
            }
            join_msg = f'42["join_room",{json.dumps(join_data_v1)}]'
            print(f"➤ SEND: {join_msg}")
            await ws.send(join_msg)

            await asyncio.sleep(0.5)

            # Load messages - try multiple variants
            print(f"\n📜 Loading messages...")

            load_variants = [
                f'42["load_message",{json.dumps({"room": room_id})}]',
                f'42["load_message",{json.dumps({"room_id": room_id})}]',
                f'42["get_messages",{json.dumps({"room": room_id})}]',
                f'42["messages",{json.dumps({"room": room_id})}]',
            ]

            for variant in load_variants:
                print(f"➤ SEND: {variant}")
                await ws.send(variant)
                await asyncio.sleep(0.3)

            print(f"\n{'='*80}")
            print("🎧 LISTENING FOR ALL WEBSOCKET TRAFFIC")
            print("="*80)
            print()

            # Listen and show EVERYTHING
            timeout_count = 0
            max_timeout = 20

            while timeout_count < max_timeout:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=1)

                    timestamp = datetime.now().strftime("%H:%M:%S")

                    if msg == "2":
                        await ws.send("3")
                        print(f"[{timestamp}] ⏱️  PING/PONG")
                        continue

                    if msg == "3":
                        print(f"[{timestamp}] ⏱️  PONG from server")
                        continue

                    # Show raw message
                    print(f"\n[{timestamp}] 📩 RAW MESSAGE:")
                    print(f"  {msg}")

                    # Try to parse as Socket.IO event
                    if msg.startswith("42"):
                        try:
                            data = json.loads(msg[2:])
                            event_name = data[0]
                            payload = data[1] if len(data) > 1 else {}

                            print(f"  📡 EVENT: {event_name}")
                            print(f"  📦 PAYLOAD:")
                            print(json.dumps(payload, indent=4, ensure_ascii=False))
                        except:
                            print(f"  ⚠️  Could not parse as JSON")

                    timeout_count = 0  # Reset timeout counter on any message

                except asyncio.TimeoutError:
                    timeout_count += 1
                    if timeout_count % 5 == 0:
                        print(f"⏱️  Waiting for messages... ({timeout_count}s)")

            print(f"\n⏱️  No more messages after {max_timeout} seconds")

        print("\n✅ Debug session complete!")

if __name__ == "__main__":
    print("="*80)
    print("🐛 YelloTalk Bot - DEBUG MODE")
    print("="*80)

    bot = YelloTalkBotDebug()

    # Fetch rooms
    print("\n🔍 Fetching rooms...")
    rooms = bot.fetch_rooms()

    if not rooms:
        print("❌ No rooms found!")
        exit(1)

    # Show first 5
    print(f"✅ Found {len(rooms)} rooms:\n")
    for i, r in enumerate(rooms[:5], 1):
        print(f"{i}. {r.get('topic', 'Untitled')[:40]} ({r.get('participants_count', 0)} people)")
        print(f"   ID: {r.get('id')}\n")

    # Select
    try:
        choice = int(input("➤ Select room (1-5): ")) - 1
        if 0 <= choice < len(rooms):
            room = rooms[choice]
            print(f"\n✅ Selected: {room.get('topic', 'Untitled')[:50]}")
            asyncio.run(bot.monitor_room(room.get('id')))
        else:
            print("❌ Invalid choice")
    except (ValueError, KeyboardInterrupt):
        print("\n👋 Cancelled")
