#!/usr/bin/env python3
"""
YelloTalk Bot - FIXED VERSION
Based on exact Android implementation
"""

import asyncio
import websockets
import ssl
import json
import requests
import urllib3
from datetime import datetime
from urllib.parse import quote

urllib3.disable_warnings()

class YelloTalkBot:
    def __init__(self):
        with open('config.json') as f:
            config = json.load(f)

        self.token = config['jwt_token']
        # Remove "Bearer " prefix if present
        self.auth_token = self.token.replace('Bearer ', '').strip()
        self.api_url = config['api_base_url']
        self.uuid = config['user_uuid']
        self.pin_name = config['pin_name']
        self.avatar_id = config['avatar_id']

        self.headers = {
            'Authorization': f'Bearer {self.token}',
            'User-Agent': 'ios',
            'x-app-version': '4.4.9'
        }

        self.message_count = 0
        self.session_id = ""
        self.running = True

    def fetch_rooms(self):
        resp = requests.get(
            f'{self.api_url}/v1/rooms/popular',
            headers=self.headers,
            verify=False,
            timeout=10
        )
        return resp.json().get('json', [])

    async def monitor_room(self, room):
        room_id = room.get('id')
        gme_id = str(room.get('gme_id', ''))
        topic = room.get('topic', 'Untitled')[:50]
        owner = room.get('owner', {})
        campus = owner.get('group_shortname', 'No Group')

        # Build WebSocket URL with auth_token (like Android app)
        ws_url = f"wss://live.yellotalk.co:8443/socket.io/?EIO=4&transport=websocket&auth_token={quote(self.auth_token)}"

        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

        print(f"\n{'='*80}")
        print(f"🔌 Connecting to: {topic}")
        print("="*80)

        try:
            async with websockets.connect(ws_url, ssl=ssl_ctx) as ws:
                # Handshake
                msg = await ws.recv()
                print(f"✅ Handshake: {msg[:80]}...")
                handshake = json.loads(msg[1:])
                ping_interval = handshake.get('pingInterval', 25000) / 1000

                # Wait for authen_success or connect to namespace
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                print(f"✅ Auth response: {msg}")

                # Check for session_id in response
                if msg.startswith("42"):
                    try:
                        data = json.loads(msg[2:])
                        if data[0] == "authen_success":
                            payload = data[1] if len(data) > 1 else {}
                            self.session_id = payload.get('sid', '')
                            print(f"✅ Session ID: {self.session_id}")
                    except:
                        pass

                # If not already connected to namespace, do it now
                if not msg.startswith("40"):
                    await ws.send('40')  # Connect to default namespace
                    msg = await ws.recv()
                    print(f"✅ Namespace: {msg}")

                print(f"\n📥 Joining room...")

                # Join with ALL required fields (from Android app)
                join_data = {
                    "room": room_id,
                    "uuid": self.uuid,
                    "position": None,
                    "avatar_id": self.avatar_id,
                    "gme_id": gme_id,  # IMPORTANT!
                    "campus": campus,  # IMPORTANT!
                    "pin_name": self.pin_name,
                    "message": None,
                    "reaction": None,
                    "reason_id": None,
                    "reason_text": None,
                    "target_user": None,
                    "target_uuid": None,
                    "limit_speaker": None
                }

                join_msg = f'42["join_room",{json.dumps(join_data)}]'
                await ws.send(join_msg)
                print(f"➤ Sent join_room")

                # Wait for join acknowledgment
                try:
                    for _ in range(3):
                        resp = await asyncio.wait_for(ws.recv(), timeout=2)
                        print(f"➤ Response: {resp[:200]}")
                        if "42" in resp:
                            break
                except asyncio.TimeoutError:
                    print("⏱️  No immediate response")

                # Load messages
                load_msg = f'42["load_message",{json.dumps({"room": room_id})}]'
                await ws.send(load_msg)
                print(f"➤ Sent load_message")

                print(f"\n{'='*80}")
                print(f"📺 LIVE CHAT FEED")
                print("="*80)
                print("Listening for messages... (Press Ctrl+C to stop)\n")

                # Start keep-alive pinger
                async def pinger():
                    while self.running:
                        await asyncio.sleep(ping_interval - 1)
                        if self.running:
                            try:
                                await ws.send("2")
                            except:
                                break

                pinger_task = asyncio.create_task(pinger())

                # Listen for messages
                while self.running:
                    try:
                        msg = await ws.recv()
                        timestamp = datetime.now().strftime("%H:%M:%S")

                        if msg == "2":
                            await ws.send("3")
                            continue
                        elif msg == "3":
                            continue

                        # Show ALL messages
                        print(f"\n[{timestamp}] 📩 {msg[:300]}")

                        # Parse events
                        if msg.startswith("42"):
                            try:
                                data = json.loads(msg[2:])
                                event = data[0]
                                payload = data[1] if len(data) > 1 else {}

                                print(f"  📡 Event: {event}")

                                # Chat message
                                if 'message' in event:
                                    if isinstance(payload, dict):
                                        sender = payload.get('pin_name', '?')
                                        text = payload.get('message', '')
                                        print(f"  💬 {sender}: {text}")
                                        self.message_count += 1

                                # Message list/history
                                if isinstance(payload, list):
                                    print(f"  📋 List with {len(payload)} items")
                                    for item in payload[:3]:
                                        if isinstance(item, dict) and 'message' in item:
                                            print(f"    - {item.get('pin_name')}: {item.get('message', '')[:40]}")
                                elif isinstance(payload, dict) and 'messages' in payload:
                                    msgs = payload['messages']
                                    print(f"  📋 {len(msgs)} messages")
                                    for m in msgs[-3:]:
                                        print(f"    - {m.get('pin_name')}: {m.get('message', '')[:40]}")

                            except Exception as e:
                                print(f"  ⚠️  Parse error: {e}")

                    except websockets.exceptions.ConnectionClosed:
                        print(f"\n❌ Connection closed by server")
                        self.running = False
                        break
                    except Exception as e:
                        print(f"\n❌ Error: {e}")
                        continue

                pinger_task.cancel()

        except Exception as e:
            print(f"\n❌ Connection error: {type(e).__name__}: {e}")

    def run(self):
        print("="*80)
        print("🤖 YelloTalk Bot - FIXED VERSION")
        print("="*80)

        # Fetch rooms
        print("\n🔍 Fetching rooms...")
        rooms = self.fetch_rooms()

        if not rooms:
            print("❌ No rooms!")
            return

        # Show rooms
        print(f"\n📋 {len(rooms)} Active Rooms:\n")
        for i, r in enumerate(rooms[:10], 1):
            topic = r.get('topic', 'Untitled')[:45]
            participants = r.get('participants_count', 0)
            print(f"{i:2d}. {topic} ({participants} 👥)")

        # Select
        try:
            choice = int(input(f"\n➤ Select (1-{min(len(rooms), 10)}): ")) - 1
            if 0 <= choice < len(rooms):
                room = rooms[choice]
                asyncio.run(self.monitor_room(room))
            else:
                print("❌ Invalid")
        except (ValueError, KeyboardInterrupt):
            print("\n👋 Cancelled")

        print(f"\n{'='*80}")
        print(f"📊 Total messages: {self.message_count}")
        print("="*80)

if __name__ == "__main__":
    bot = YelloTalkBot()
    bot.run()
