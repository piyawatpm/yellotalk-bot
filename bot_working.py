#!/usr/bin/env python3
"""
YelloTalk Bot - Socket.IO Version with ACK Support
This version properly handles server acknowledgments
"""

import socketio
import requests
import json
import urllib3
import time
from datetime import datetime

urllib3.disable_warnings()

class YelloTalkBot:
    def __init__(self):
        with open('config.json') as f:
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
        self.current_room = None

        # Create Socket.IO client
        self.sio = socketio.Client(
            ssl_verify=False,
            logger=False,
            engineio_logger=False
        )

        self.setup_events()

    def setup_events(self):
        """Setup Socket.IO event handlers"""

        @self.sio.event
        def connect():
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] ✅ Connected to server!")

        @self.sio.event
        def disconnect():
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"\n[{timestamp}] ⚠️  Disconnected from server")

        @self.sio.event
        def connect_error(data):
            print(f"❌ Connection error: {data}")

        @self.sio.on('authen_success')
        def on_authen(data):
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] ✅ Authentication successful!")
            if isinstance(data, dict):
                sid = data.get('sid', '')
                print(f"[{timestamp}] 📋 Session ID: {sid}")

        @self.sio.on('new_message')
        def on_message(data):
            self.message_count += 1
            timestamp = datetime.now().strftime("%H:%M:%S")

            sender = data.get('pin_name', 'Unknown')
            message = data.get('message', '')

            print(f"[{timestamp}] 💬 {sender}: {message}")

        @self.sio.on('load_message')
        def on_load_message(data):
            timestamp = datetime.now().strftime("%H:%M:%S")

            # Data might be a list of messages or dict with messages key
            messages = data if isinstance(data, list) else data.get('messages', [])

            if messages:
                print(f"\n[{timestamp}] 📚 Message History ({len(messages)} messages):")
                print("-" * 80)
                for msg in messages[-10:]:  # Show last 10
                    sender = msg.get('pin_name', '?')
                    text = msg.get('message', '')
                    print(f"  {sender}: {text}")
                print("-" * 80 + "\n")

        @self.sio.on('speaker_changed')
        def on_speaker_change(data):
            timestamp = datetime.now().strftime("%H:%M:%S")
            user = data.get('pin_name', 'Someone')
            print(f"[{timestamp}] 🎤 {user} joined as speaker")

        @self.sio.on('participant_changed')
        def on_participant_change(data):
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] 👥 Participants updated")

        @self.sio.on('user_changed')
        def on_user_change(data):
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] 👤 User state changed")

        @self.sio.on('new_gift')
        def on_gift(data):
            timestamp = datetime.now().strftime("%H:%M:%S")
            sender = data.get('pin_name', 'Someone')
            print(f"[{timestamp}] 🎁 {sender} sent a gift!")

        @self.sio.on('new_reaction')
        def on_reaction(data):
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] ❤️  Reaction")

        @self.sio.on('*')
        def catch_all(event, data):
            """Catch any other events"""
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] 📡 [{event}] {str(data)[:100]}")

    def fetch_rooms(self):
        resp = requests.get(
            f'{self.api_url}/v1/rooms/popular',
            headers=self.headers,
            verify=False,
            timeout=10
        )
        return resp.json().get('json', [])

    def join_room(self, room):
        """Join a room and listen for messages"""
        room_id = room.get('id')
        gme_id = str(room.get('gme_id', ''))
        topic = room.get('topic', 'Untitled')[:50]
        owner = room.get('owner', {})
        campus = owner.get('group_shortname', 'No Group')

        self.current_room = room

        print(f"\n{'='*80}")
        print(f"📺 Joining: {topic}")
        print(f"   Room ID: {room_id}")
        print(f"   GME ID: {gme_id}")
        print("="*80)

        # Connect to Socket.IO server
        try:
            # Connect with token in auth
            self.sio.connect(
                'https://live.yellotalk.co:8443',
                auth={'token': self.token},
                transports=['websocket'],
                wait_timeout=10
            )

            print("✅ Connected!")

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

            # Emit with callback to see server response
            def join_callback(response):
                print(f"✅ Join response: {response}")

            self.sio.emit('join_room', join_data, callback=join_callback)

            # Load messages
            print(f"📜 Loading messages...")

            def load_callback(response):
                print(f"✅ Load response: {response}")

            self.sio.emit('load_message', {"room": room_id}, callback=load_callback)

            print(f"\n{'='*80}")
            print("📺 LIVE FEED - Listening for messages...")
            print("="*80)
            print("(Press Ctrl+C to stop)\n")

            # Keep connection alive
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                print("\n\n👋 Stopping...")

        except Exception as e:
            print(f"❌ Error: {e}")
        finally:
            if self.sio.connected:
                self.sio.disconnect()

    def run(self):
        print("="*80)
        print("🤖 YelloTalk Bot - Socket.IO Version")
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
                self.join_room(room)
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
