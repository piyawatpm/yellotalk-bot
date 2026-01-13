#!/usr/bin/env python3
"""
YelloTalk Chat Bot - Interactive Room Monitor
Fetches rooms, allows selection, and shows live chat feed
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
    def __init__(self, config_file='config.json'):
        """Initialize bot with config"""
        with open(config_file) as f:
            self.config = json.load(f)

        self.token = self.config['jwt_token']
        self.ws_url = self.config['websocket_url']
        self.api_url = self.config['api_base_url']
        self.uuid = self.config['user_uuid']
        self.pin_name = self.config['pin_name']
        self.avatar_id = self.config['avatar_id']

        self.headers = {
            'Authorization': f'Bearer {self.token}',
            'User-Agent': 'ios',
            'x-app-version': '4.4.9'
        }

        self.current_room = None
        self.message_count = 0

    def fetch_rooms(self):
        """Fetch list of active rooms"""
        try:
            resp = requests.get(
                f'{self.api_url}/v1/rooms/popular',
                headers=self.headers,
                verify=False,
                timeout=10
            )
            data = resp.json()
            return data.get('json', [])
        except Exception as e:
            print(f"❌ Error fetching rooms: {e}")
            return []

    def display_rooms(self, rooms):
        """Display rooms for selection"""
        print("\n" + "=" * 80)
        print("📋 AVAILABLE ROOMS")
        print("=" * 80)

        if not rooms:
            print("No active rooms found!")
            return

        for i, room in enumerate(rooms, 1):
            topic = room.get('topic', 'Untitled')[:50]
            room_id = room.get('id')
            gme_id = room.get('gme_id')
            participants = room.get('participants_count', 0)
            owner = room.get('owner', {}).get('pin_name', 'Unknown')[:20]
            category = room.get('category', {}).get('name', 'Unknown')

            print(f"\n{i:2d}. {topic}")
            print(f"    👥 {participants} participants | 👤 Owner: {owner}")
            print(f"    🏷️  {category} | ID: {room_id}")

    def select_room(self, rooms):
        """Interactive room selection"""
        while True:
            try:
                choice = input(f"\n➤ Select room (1-{len(rooms)}) or 'q' to quit: ").strip()

                if choice.lower() == 'q':
                    return None

                idx = int(choice) - 1
                if 0 <= idx < len(rooms):
                    return rooms[idx]
                else:
                    print(f"⚠️  Please enter a number between 1 and {len(rooms)}")
            except ValueError:
                print("⚠️  Please enter a valid number")
            except KeyboardInterrupt:
                return None

    async def join_room_and_monitor(self, room):
        """Join room and monitor chat messages"""
        self.current_room = room
        room_id = room.get('id')
        room_topic = room.get('topic', 'Untitled')[:50]

        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE

        print("\n" + "=" * 80)
        print(f"🔌 Connecting to: {room_topic}")
        print("=" * 80)

        try:
            async with websockets.connect(self.ws_url, ssl=ssl_context) as ws:
                # Handshake
                msg = await ws.recv()
                handshake = json.loads(msg[1:])
                session_id = handshake.get('sid')
                ping_interval = handshake.get('pingInterval', 25000) / 1000

                print(f"✅ Connected! Session: {session_id}")

                # Authenticate
                auth_msg = f'40{json.dumps({"token": self.token})}'
                await ws.send(auth_msg)

                auth_resp = await ws.recv()
                if "44" in auth_resp:
                    print(f"❌ Authentication failed: {auth_resp}")
                    return

                print(f"✅ Authenticated!")

                # Join room
                join_data = {
                    "room": room_id,
                    "uuid": self.uuid,
                    "avatar_id": self.avatar_id,
                    "pin_name": self.pin_name
                }
                await ws.send(f'42["join_room",{json.dumps(join_data)}]')
                print(f"✅ Joined room!")

                # Load message history
                await ws.send(f'42["load_message",{json.dumps({"room": room_id})}]')
                print(f"✅ Requested message history")

                print("\n" + "=" * 80)
                print(f"📺 LIVE CHAT FEED - {room_topic}")
                print("=" * 80)
                print("(Press Ctrl+C to stop)\n")

                # Monitor messages
                last_ping = asyncio.get_event_loop().time()

                while True:
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=ping_interval - 1)

                        # Handle ping/pong
                        if msg == "2":
                            await ws.send("3")
                            current_time = asyncio.get_event_loop().time()
                            last_ping = current_time
                            continue

                        # Handle events
                        if msg.startswith("42"):
                            await self.handle_event(msg)

                    except asyncio.TimeoutError:
                        # Send ping if needed
                        current_time = asyncio.get_event_loop().time()
                        if current_time - last_ping > ping_interval - 2:
                            await ws.send("2")
                            last_ping = current_time

        except KeyboardInterrupt:
            print("\n\n👋 Disconnected from room")
        except Exception as e:
            print(f"\n❌ Error: {type(e).__name__}: {e}")

    async def handle_event(self, msg):
        """Handle incoming WebSocket event"""
        try:
            data = json.loads(msg[2:])
            event_name = data[0]
            payload = data[1] if len(data) > 1 else {}

            timestamp = datetime.now().strftime("%H:%M:%S")

            # Chat messages
            if event_name == 'new_message' or event_name == 'message':
                self.message_count += 1
                sender = payload.get('pin_name', 'Unknown')
                message = payload.get('message', '')

                print(f"[{timestamp}] 💬 {sender}: {message}")

            # Message history
            elif event_name == 'load_message' or event_name == 'message_history':
                messages = payload if isinstance(payload, list) else payload.get('messages', [])

                if messages:
                    print(f"\n📚 Message History ({len(messages)} messages):")
                    print("-" * 80)
                    for m in messages[-15:]:  # Last 15 messages
                        sender = m.get('pin_name', '?')
                        text = m.get('message', '')
                        print(f"  {sender}: {text}")
                    print("-" * 80 + "\n")

            # User joined/left
            elif 'speaker' in event_name or 'participant' in event_name:
                action = event_name.replace('_', ' ').title()
                user = payload.get('pin_name', 'Someone')
                print(f"[{timestamp}] 👤 {user} - {action}")

            # Room info
            elif 'room_info' in event_name:
                print(f"[{timestamp}] ℹ️  Room info updated")

            # Gifts/reactions
            elif event_name == 'new_gift':
                sender = payload.get('pin_name', 'Someone')
                print(f"[{timestamp}] 🎁 {sender} sent a gift!")

            elif event_name == 'new_reaction':
                print(f"[{timestamp}] ❤️ Reaction received")

            # Other events
            else:
                print(f"[{timestamp}] 📡 [{event_name}]")

        except Exception as e:
            # Silently ignore parsing errors
            pass

    def run(self):
        """Main bot entry point"""
        print("=" * 80)
        print("🤖 YelloTalk Chat Bot")
        print("=" * 80)

        # Step 1: Fetch rooms
        print("\n🔍 Fetching active rooms...")
        rooms = self.fetch_rooms()

        if not rooms:
            print("❌ No rooms available!")
            return

        print(f"✅ Found {len(rooms)} rooms")

        # Step 2: Display and select
        self.display_rooms(rooms)
        room = self.select_room(rooms)

        if not room:
            print("\n👋 Goodbye!")
            return

        # Step 3: Join and monitor
        try:
            asyncio.run(self.join_room_and_monitor(room))
        except KeyboardInterrupt:
            print("\n\n👋 Bot stopped")

        # Show stats
        print("\n" + "=" * 80)
        print(f"📊 Session Stats")
        print("=" * 80)
        print(f"  Messages received: {self.message_count}")
        print(f"  Room: {room.get('topic', 'Unknown')[:50]}")
        print("=" * 80)


if __name__ == "__main__":
    bot = YelloTalkBot()
    bot.run()
