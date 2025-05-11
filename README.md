# Audio Sync

A real-time audio streaming desktop application built with Electron, React, and WebRTC. This app allows users to create rooms and stream audio files to other participants in real-time.

## Features

- Create and join audio streaming rooms
- Real-time audio streaming using WebRTC
- No server-side storage of audio files
- Cross-platform desktop application
- Modern and clean user interface

## Prerequisites

- Node.js 18 or higher
- npm or yarn package manager

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd audio-sync
```

2. Install dependencies:
```bash
npm install
```

## Running the Application

1. Start both the signaling server and desktop app:
```bash
npm start
```

This will start:
- Signaling server on port 3001
- Desktop app development server on port 5173

The Electron app will automatically launch and display your local IP address in the window title.

## Usage

1. **Creating a Room**
   - Launch the application
   - Enter a room ID in the input field
   - Click "Create Room"
   - You are now the host of the room

2. **Joining a Room**
   - Launch the application
   - Enter the room ID provided by the host
   - Click "Join Room"
   - Wait for the host to start streaming audio

3. **Streaming Audio (Host Only)**
   - After creating a room, click "Choose File" to select an audio file
   - Click "Start Streaming" to begin broadcasting to all participants
   - The audio will play in real-time for all connected users

## Technical Details

- Uses WebRTC for peer-to-peer audio streaming
- Socket.IO for signaling and room management
- Audio is streamed directly between peers without server storage
- Built with React and TypeScript for type safety
- Electron for cross-platform desktop support

## Development

- `npm run build` - Build the application
- `npm run preview` - Preview the built application

## License

MIT

