import socket
import pyaudio
import time

CHUNK = 1024
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 44100
PORT = 5005

# Get local IP address
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.connect(("8.8.8.8", 80))
local_ip = s.getsockname()[0]
s.close()
print(f"[Sender] Local IP: {local_ip} — send this to receiver to connect.")
print(f"[Sender] Streaming on udp://{local_ip}:{PORT}")

# Setup audio
audio = pyaudio.PyAudio()
stream = audio.open(format=FORMAT, channels=CHANNELS, rate=RATE, input=True, frames_per_buffer=CHUNK)

# Setup UDP
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
broadcast_ip = "<broadcast>"

print("[Sender] Sending audio...")

while True:
    data = stream.read(CHUNK, exception_on_overflow=False)
    timestamp = time.time()
    packet = f"{timestamp}".encode() + b"||" + data
    sock.sendto(packet, (broadcast_ip, PORT))
