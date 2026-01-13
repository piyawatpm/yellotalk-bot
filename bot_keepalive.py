#!/usr/bin/env python3
"""
YelloTalk Bot - Keep Alive Version
Maintains connection and shows ALL messages
"""

import asyncio
import websockets
import ssl
import json
import requests
import urllib3
from datetime import datetime

urllib3.disable_warnings()

class YelloTalkBot:
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

        self.message_count = 0
        self.running = True

    def fetch_rooms(self):
        resp = requests.get(
            f'{self.api_url}/v1/rooms/popular',
            headers=self.headers,
            verify=False,
            timeout=10
        )
        return resp.json().get('json', [])

    async def keep_alive_pinger(self, ws, interval):
        """Background task to keep connection alive"""
        while self.running:
            try:
                await asyncio.sleep(interval - 1)
                if self.running:
                    await ws.send("2")  # Ping
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] 🏓 Ping sent")
            except Exception as e:
                print(f"Pinger error: {e}")
                break

    async def message_listener(self, ws):
        """Listen for messages indefinitely"""
        while self.running:
            try:
                msg = await ws.recv()
                timestamp = datetime.now().strftime("%H:%M:%S")

                # Ping response
                if msg == "2":
                    await ws.send("3")
                    continue
                elif msg == "3":
                    continue

                # Show raw message
                print(f"\n[{timestamp}] 📥 RECEIVED:")
                print(f"  Raw: {msg[:200]}")

                # Parse Socket.IO event
                if msg.startswith("42"):
                    try:
                        data = json.loads(msg[2:])
                        event_name = data[0]
                        payload = data[1] if len(data) > 1 else {}

                        print(f"  Event: {event_name}")
                        print(f"  Payload: {json.dumps(payload, indent=2, ensure_ascii=False)[:500]}")

                        # Count messages
                        if 'message' in event_name or event_name == 'new_message':
                            self.message_count += 1

                            # Pretty print chat message
                            if isinstance(payload, dict):
                                sender = payload.get('pin_name', '?')
                                text = payload.get('message', '')
                                print(f"\n  💬 {sender}: {text}")

                        # Message history
                        elif 'load' in event_name or 'history' in event_name:
                            msgs = payload if isinstance(payload, list) else payload.get('messages', [])
                            if msgs:
                                print(f"\n  📚 {len(msgs)} messages in history")
                                for m in msgs[-5:]:
                                    if isinstance(m, dict):
                                        print(f"    {m.get('pin_name', '?')}: {m.get('message', '')[:50]}")

                    except Exception as e:
                        print(f"  ⚠️  Parse error: {e}")

            except websockets.exceptions.ConnectionClosed as e:
                print(f"\n❌ Connection closed: {e}")
                self.running = False
                break
            except Exception as e:
                print(f"\n❌ Error: {e}")
                continue

    async def monitor_room(self, room_id, room_topic):
        """Connect and monitor room with keep-alive"""
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

        print(f"\n{'='*80}")
        print(f"🔌 Connecting to: {room_topic}")
        print("="*80)

        try:
            async with websockets.connect(
                self.ws_url,
                ssl=ssl_ctx,
                ping_interval=None,  # Disable auto ping
                close_timeout=10
            ) as ws:
                # Handshake
                msg = await ws.recv()
                handshake = json.loads(msg[1:])
                ping_interval = handshake.get('pingInterval', 25000) / 1000

                print(f"✅ Connected! Session: {handshake.get('sid')}")
                print(f"⏱️  Ping interval: {ping_interval}s")

                # Auth
                auth_msg = f'40{json.dumps({"token": self.token})}'
                await ws.send(auth_msg)
                print(f"➤ Sent auth")

                auth_resp = await ws.recv()
                print(f"✅ Auth response: {auth_resp}")

                # Join room
                join_data = {
                    "room": room_id,
                    "uuid": self.uuid,
                    "avatar_id": self.avatar_id,
                    "pin_name": self.pin_name
                }
                join_msg = f'42["join_room",{json.dumps(join_data)}]'
                print(f"➤ Sending: join_room")
                await ws.send(join_msg)

                # Load messages
                load_msg = f'42["load_message",{json.dumps({"room": room_id})}]'
                print(f"➤ Sending: load_message")
                await ws.send(load_msg)

                # Also try getting room participants
                get_part = f'42["get_participant",{json.dumps({"room": room_id})}]'
                print(f"➤ Sending: get_participant")
                await ws.send(get_part)

                print(f"\n{'='*80}")
                print("📺 MONITORING (Press Ctrl+C to stop)")
                print("="*80)

                # Start background pinger
                pinger_task = asyncio.create_task(self.keep_alive_pinger(ws, ping_interval))

                # Start listening
                listener_task = asyncio.create_task(self.message_listener(ws))

                # Wait for listener to finish
                await listener_task

                # Cancel pinger
                pinger_task.cancel()
                try:
                    await pinger_task
                except asyncio.CancelledError:
                    pass

        except websockets.exceptions.ConnectionClosed as e:
            print(f"\n❌ Connection closed: {e.code} - {e.reason}")
        except Exception as e:
            print(f"\n❌ Error: {type(e).__name__}: {e}")

    def run(self):
        print("="*80)
        print("🐛 YelloTalk Bot - Debug & Keep Alive")
        print("="*80)

        # Fetch rooms
        print("\n🔍 Fetching rooms...")
        rooms = self.fetch_rooms()

        if not rooms:
            print("❌ No rooms!")
            return

        # Show rooms
        print(f"\n📋 {len(rooms)} Active Rooms:\n")
        for i, r in enumerate(rooms[:8], 1):
            print(f"{i}. {r.get('topic', 'Untitled')[:40]} ({r.get('participants_count', 0)} 👥)")

        # Select
        try:
            choice = int(input(f"\n➤ Select (1-{min(len(rooms), 8)}): ")) - 1
            if 0 <= choice < len(rooms):
                room = rooms[choice]
                asyncio.run(self.monitor_room(room.get('id'), room.get('topic', 'Untitled')))
            else:
                print("❌ Invalid")
        except (ValueError, KeyboardInterrupt):
            print("\n👋 Cancelled")

        print(f"\n{'='*80}")
        print(f"📊 Stats: {self.message_count} messages received")
        print("="*80)

if __name__ == "__main__":
    bot = YelloTalkBot()
    bot.run()
