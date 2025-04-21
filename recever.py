import socket
import pyaudio
import threading
import time
import queue

CHUNK = 1024
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 44100
PORT = 5005
BUFFER_DURATION = 0.2  # seconds to buffer

# Setup UDP socket
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(("", PORT))

# Setup PyAudio
audio = pyaudio.PyAudio()
stream = audio.open(format=FORMAT, channels=CHANNELS, rate=RATE, output=True, frames_per_buffer=CHUNK)

# Queue for audio buffer
buffer_q = queue.Queue()

def listener():
    print(f"[Receiver] Listening on udp://0.0.0.0:{PORT}")
    while True:
        packet, addr = sock.recvfrom(4096)
        try:
            timestamp_str, data = packet.split(b"||", 1)
            sender_time = float(timestamp_str.decode())
            now = time.time()
            latency = now - sender_time
            print(f"[Receiver] Packet from {addr[0]} | Latency: {latency*1000:.2f} ms")
            buffer_q.put(data)
        except Exception as e:
            print(f"[Receiver] Error decoding packet: {e}")

# Start listener thread
threading.Thread(target=listener, daemon=True).start()

# Buffer before starting playback
print("[Receiver] Buffering...")
time.sleep(BUFFER_DURATION)

print("[Receiver] Playing audio...")
while True:
    if not buffer_q.empty():
        stream.write(buffer_q.get())
