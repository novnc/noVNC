#!/usr/bin/env python3
"""
VNC Recording Server

A WebSocket server that receives VNC recording frames from noVNC
and saves them to a file.

Usage:
    python recording_server.py [--port PORT] [--output FILE]

    --port PORT     Port to listen on (default: 6090)
    --output FILE   Output file path (default: recording.bin)
    --js            Also convert to JS playback format when done

Example:
    python recording_server.py --port 6090 --output demo.bin --js

Then in noVNC, use:
    vnc.html?host=...&autoconnect=1&autorecord=1&record_url=ws://localhost:6090
"""

import argparse
import asyncio
import base64
import signal
import struct
import sys
from datetime import datetime
from pathlib import Path

try:
    import websockets
except ImportError:
    print("Error: websockets library not found. Install with: pip install websockets")
    sys.exit(1)


class RecordingServer:
    def __init__(self, output_path: str, convert_to_js: bool = False):
        self.output_path = Path(output_path)
        self.convert_to_js = convert_to_js
        self.file = None
        self.frame_count = 0
        self.bytes_written = 0
        self.client_connected = False
        self.start_time = None

    async def handle_client(self, websocket):
        """Handle a single WebSocket client connection."""
        if self.client_connected:
            print("Warning: Another client is already connected, rejecting new connection")
            await websocket.close(1008, "Another client already connected")
            return

        self.client_connected = True
        self.frame_count = 0
        self.bytes_written = 0
        self.start_time = datetime.now()

        # Open output file
        self.file = open(self.output_path, 'wb')

        client_addr = websocket.remote_address
        print(f"[{self.start_time.strftime('%H:%M:%S')}] Client connected from {client_addr}")
        print(f"Recording to: {self.output_path}")

        try:
            async for message in websocket:
                if isinstance(message, bytes):
                    self.file.write(message)
                    self.frame_count += 1
                    self.bytes_written += len(message)

                    # Progress update every 1000 frames
                    if self.frame_count % 1000 == 0:
                        mb = self.bytes_written / (1024 * 1024)
                        print(f"  Received {self.frame_count} frames ({mb:.2f} MB)")

        except websockets.exceptions.ConnectionClosed as e:
            print(f"Connection closed: {e.code} {e.reason}")
        finally:
            self.file.close()
            self.client_connected = False

            duration = (datetime.now() - self.start_time).total_seconds()
            mb = self.bytes_written / (1024 * 1024)
            print(f"Recording complete: {self.frame_count} frames, {mb:.2f} MB in {duration:.1f}s")

            if self.convert_to_js:
                await self.convert_to_js_format()

    async def convert_to_js_format(self):
        """Convert binary recording to JS playback format."""
        js_path = self.output_path.with_suffix('.js')
        print(f"Converting to JS format: {js_path}")

        frames = []
        with open(self.output_path, 'rb') as f:
            while True:
                header = f.read(9)
                if len(header) < 9:
                    break

                from_client = header[0] == 1
                timestamp = struct.unpack('>I', header[1:5])[0]  # big endian
                data_len = struct.unpack('>I', header[5:9])[0]   # big endian

                data = f.read(data_len)
                if len(data) < data_len:
                    print(f"Warning: Truncated frame, expected {data_len} bytes, got {len(data)}")
                    break

                # Convert to base64
                b64_data = base64.b64encode(data).decode('ascii')

                # Format: "{timestamp{base64data" for server, "}timestamp{base64data" for client
                prefix = '}' if from_client else '{'
                frame_str = f'{prefix}{timestamp}{{{b64_data}'
                frames.append(f'"{frame_str}"')

        frames.append('"EOF"')

        # Write JS file
        with open(js_path, 'w') as f:
            f.write(f'/* Recorded VNC session - {datetime.now().isoformat()} */\n')
            f.write(f'/* {len(frames) - 1} frames */\n')
            f.write('var VNC_frame_data = [\n')
            f.write(',\n'.join(frames))
            f.write('\n];\n')

        print(f"JS conversion complete: {js_path}")


async def main():
    parser = argparse.ArgumentParser(description='VNC Recording Server')
    parser.add_argument('--port', type=int, default=6090, help='Port to listen on (default: 6090)')
    parser.add_argument('--output', type=str, default='recording.bin', help='Output file path')
    parser.add_argument('--js', action='store_true', help='Convert to JS format when recording ends')
    parser.add_argument('--host', type=str, default='0.0.0.0', help='Host to bind to (default: 0.0.0.0)')
    args = parser.parse_args()

    server = RecordingServer(args.output, convert_to_js=args.js)

    # Handle graceful shutdown
    stop_event = asyncio.Event()

    def signal_handler():
        print("\nShutting down...")
        stop_event.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)

    print(f"VNC Recording Server")
    print(f"====================")
    print(f"Listening on ws://{args.host}:{args.port}")
    print(f"Output file: {args.output}")
    print(f"JS conversion: {'enabled' if args.js else 'disabled'}")
    print()
    print("Use in noVNC with URL parameter:")
    print(f"  record_url=ws://localhost:{args.port}")
    print()
    print("Press Ctrl+C to stop")
    print()

    async with websockets.serve(server.handle_client, args.host, args.port):
        await stop_event.wait()


if __name__ == '__main__':
    asyncio.run(main())
