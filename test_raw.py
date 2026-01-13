import asyncio
import websockets
import ssl
import json

TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1dWlkIjoiOTU3RUU1MTgtMDRBNy00QTAzLTk0N0YtQTEwRjk1RDBGMjg1IiwiaWF0IjoxNzY4MDM5NjAyfQ.GM0mVLxILLra4GH8m_3zeYCTgrBHoCqjvlfJofagdfM"
ROOM = "6965a05c9f268d0013cde203"
GME_ID = "7868145"

async def test():
    # Try with auth_token in URL (Android way)
    url = f"wss://live.yellotalk.co:8443/socket.io/?EIO=4&transport=websocket&auth_token={TOKEN}&session_id="
    
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE
    
    print("Connecting with auth_token in URL...")
    async with websockets.connect(url, ssl=ssl_ctx) as ws:
        # Get all initial messages
        print("\n=== INITIAL MESSAGES ===")
        for i in range(5):
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=1)
                print(f"{i+1}. {msg}")
            except asyncio.TimeoutError:
                break
        
        # Now try join
        join = {
            "room": ROOM,
            "uuid": "957EE518-04A7-4A03-947F-A10F95D0F285",
            "avatar_id": 0,
            "gme_id": GME_ID,
            "campus": "No Group",
            "pin_name": "test"
        }
        
        print(f"\n=== SENDING JOIN ===")
        await ws.send(f'42["join_room",{json.dumps(join)}]')
        print("Sent join_room")
        
        # Get responses
        print("\n=== RESPONSES ===")
        for i in range(10):
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=2)
                print(f"{i+1}. {msg[:300]}")
            except asyncio.TimeoutError:
                print(f"{i+1}. (timeout)")
        
        # Try load_message
        print(f"\n=== SENDING LOAD_MESSAGE ===")
        await ws.send(f'42["load_message",{json.dumps({"room": ROOM})}]')
        
        # Listen more
        for i in range(10):
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=2)
                print(f"MSG: {msg[:300]}")
            except asyncio.TimeoutError:
                print(".")

asyncio.run(test())
