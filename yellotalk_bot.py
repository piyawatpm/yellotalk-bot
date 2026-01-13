#!/usr/bin/env python3
"""
YelloTalk Chat Bot - Complete Working Version
Monitors room chat with proper Socket.IO client
"""

import socketio
import requests
import json
import urllib3
import time
from datetime import datetime

urllib3.disable_warnings()

class YelloTalkChatBot:
    def __init__(self, config_file='config.json'):
        # Load config
        with open(config_file) as f:
            config = json.load(f)

        self.token = config['jwt_token']
        self.api_url = config['api_base_url']
        self.uuid = config['user_uuid']
        self.pin_name = config['pin_name']
        self.avatar_id = config['avatar_id']

        self.headers = {
            'Authorization': f'Bearer {self.token}',
            'User-Agent': 'ios'
        }

        self.message_count = 0
        self.current_room_id = None

        # Create Socket.IO client
        self.sio = socketio.Client(ssl_verify=False)
        self.setup_handlers()

    def setup_handlers(self):
        """Setup all Socket.IO event handlers"""

        @self.sio.event
        def connect():
            print(f"✅ WebSocket connected!")

        @self.sio.event
        def disconnect():
            print(f"\n⚠️  Disconnected")

        @self.sio.on('*')
        def catch_all(event, data):
            """Debug: Show all events"""
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] 📡 Event: {event}")
            print(f"           Data: {str(data)[:200]}")

        @self.sio.on('new_message')
        def on_new_message(data):
            self.message_count += 1
            timestamp = datetime.now().strftime("%H:%M:%S")
            sender = data.get('pin_name', 'Unknown')
            message = data.get('message', '')
            print(f"\n[{timestamp}] 💬 {sender}:")
            print(f"           {message}")

        @self.sio.on('load_message')
        def on_load_message(data):
            timestamp = datetime.now().strftime("%H:%M:%S")
            messages = data if isinstance(data, list) else data.get('messages', [])

            if messages:
                print(f"\n[{timestamp}] 📚 Message History ({len(messages)} total):")
                print("-" * 80)
                for msg in messages[-15:]:  # Show last 15
                    sender = msg.get('pin_name', '?')
                    text = msg.get('message', '')
                    msg_time = msg.get('created_at', '')
                    print(f"  {sender}: {text}")
                print("-" * 80)

        @self.sio.on('speaker_changed')
        def on_speaker(data):
            timestamp = datetime.now().strftime("%H:%M:%S")
            user = data.get('pin_name', 'User')
            print(f"[{timestamp}] 🎤 {user} speaker status changed")

        @self.sio.on('participant_changed')
        def on_participant(data):
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] 👥 Participants updated")

        @self.sio.on('new_gift')
        def on_gift(data):
            timestamp = datetime.now().strftime("%H:%M:%S")
            sender = data.get('pin_name', 'Someone')
            print(f"[{timestamp}] 🎁 {sender} sent a gift")

        @self.sio.on('new_reaction')
        def on_reaction(data):
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] ❤️  Reaction")

    def fetch_rooms(self):
        """Get list of active rooms"""
        try:
            resp = requests.get(
                f'{self.api_url}/v1/rooms/popular',
                headers=self.headers,
                verify=False,
                timeout=10
            )
            return resp.json().get('json', [])
        except Exception as e:
            print(f"❌ Error fetching rooms: {e}")
            return []

    def display_rooms(self, rooms):
        """Display room list"""
        print(f"\n{'='*80}")
        print("📋 ACTIVE ROOMS")
        print("="*80 + "\n")

        for i, room in enumerate(rooms[:15], 1):
            topic = room.get('topic', 'Untitled')[:50]
            participants = room.get('participants_count', 0)
            owner = room.get('owner', {}).get('pin_name', 'Unknown')[:20]
            category = room.get('category', {}).get('name', '')

            print(f"{i:2d}. {topic}")
            print(f"    👥 {participants} people | 👤 {owner} | 🏷️  {category}")
            print()

    def connect_and_join(self, room):
        """Connect to WebSocket and join room"""
        room_id = room.get('id')
        gme_id = str(room.get('gme_id', ''))
        topic = room.get('topic', 'Untitled')[:60]
        owner = room.get('owner', {})
        campus = owner.get('group_shortname', 'No Group')

        self.current_room_id = room_id

        print(f"\n{'='*80}")
        print(f"🔌 Connecting to: {topic}")
        print("="*80)

        try:
            # Connect with auth token
            self.sio.connect(
                'https://live.yellotalk.co:8443',
                auth={'token': self.token},
                transports=['websocket'],
                wait_timeout=10
            )

            print("✅ Connected to WebSocket!")
            time.sleep(0.5)

            # Join room with callback
            join_data = {
                "room": room_id,
                "uuid": self.uuid,
                "avatar_id": self.avatar_id,
                "gme_id": gme_id,
                "campus": campus,
                "pin_name": self.pin_name
            }

            print(f"📥 Joining room...")

            def join_ack(response):
                print(f"✅ Join acknowledged: {response}")

            self.sio.emit('join_room', join_data, callback=join_ack)
            time.sleep(0.5)

            # Load message history
            print(f"📜 Requesting message history...")

            def load_ack(response):
                print(f"✅ Load acknowledged: {response}")

            self.sio.emit('load_message', {"room": room_id}, callback=load_ack)

            print(f"\n{'='*80}")
            print(f"📺 LIVE CHAT FEED")
            print("="*80)
            print("Monitoring messages... (Press Ctrl+C to stop)\n")

            # Keep alive
            try:
                while self.sio.connected:
                    time.sleep(1)
            except KeyboardInterrupt:
                print("\n\n👋 Stopping bot...")

        except Exception as e:
            print(f"❌ Connection error: {e}")
        finally:
            if self.sio.connected:
                self.sio.disconnect()

    def run(self):
        """Main bot entry point"""
        print("="*80)
        print("🤖 YelloTalk Chat Bot")
        print("="*80)

        # Step 1: Fetch rooms
        print("\n🔍 Fetching active rooms...")
        rooms = self.fetch_rooms()

        if not rooms:
            print("❌ No active rooms found!")
            return

        print(f"✅ Found {len(rooms)} rooms")

        # Step 2: Display rooms
        self.display_rooms(rooms)

        # Step 3: Select room
        try:
            choice = input(f"➤ Select room (1-{min(len(rooms), 15)}) or 'q' to quit: ").strip()

            if choice.lower() == 'q':
                print("👋 Goodbye!")
                return

            idx = int(choice) - 1
            if 0 <= idx < len(rooms):
                room = rooms[idx]
                self.connect_and_join(room)
            else:
                print(f"❌ Please select 1-{len(rooms)}")

        except ValueError:
            print("❌ Invalid input")
        except KeyboardInterrupt:
            print("\n👋 Cancelled")

        # Show stats
        print(f"\n{'='*80}")
        print("📊 Session Summary")
        print("="*80)
        print(f"Messages received: {self.message_count}")
        if self.current_room_id:
            print(f"Room ID: {self.current_room_id}")
        print("="*80)


if __name__ == "__main__":
    bot = YelloTalkChatBot()
    bot.run()
