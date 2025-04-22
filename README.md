# Audio Sync

A desktop application that allows you to play audio files in perfect synchronization between two devices. Share your music with friends remotely and listen together with precise timing.

![Audio Sync](https://i.imgur.com/placeholder.png)

## Features

- **Real-time Audio Synchronization**: Play audio files with millisecond-level synchronization across devices
- **Direct File Transfer**: Share audio files directly between peers without a central server
- **Playlist Management**: Create and manage playlists that sync between connected peers
- **Host/Client Architecture**: One user controls playback while others stay perfectly in sync
- **Robust Connectivity**: Automatic reconnection and recovery from network issues
- **Dark Mode Support**: Toggle between light and dark themes
- **Offline Operation**: No internet required once peers are connected on the same network

## Technology Stack

- **Electron**: Cross-platform desktop application framework
- **WebRTC**: Peer-to-peer communication for direct data transfer and synchronization
- **React**: UI component library
- **TypeScript**: Type-safe JavaScript
- **Tailwind CSS**: Utility-first CSS framework
- **Vite**: Next-generation frontend build tool
- **Turborepo**: Monorepo build system

## Project Structure
```
audio-sync/
├── apps/
│ ├── desktop-app/ # Electron application
│ │ ├── main.js # Electron main process
│ │ ├── src/ # Application source
│ │ │ ├── main.tsx # React entry point
│ │ │ ├── webrct/ # WebRTC implementation
│ │ │ │ ├── indexRtc.ts # WebRTC client
│ │ │ ├── styles.css # Tailwind styles
│ │ ├── index.html # HTML template
│ ├── signaling-server/ # WebRTC signaling server
│ │ ├── index.js # WebSocket server implementation
├── package.json # Root package configuration
├── turbo.json # Turborepo configuration
```
## How It Works

1. **Connection Setup**:
   - The signaling server facilitates the initial connection between peers
   - WebRTC establishes a direct peer-to-peer connection for low-latency communication

2. **File Sharing**:
   - The host can add audio files to the playlist
   - Files are chunked and transferred directly to connected peers
   - Both parties have identical files for perfect playback

3. **Playback Synchronization**:
   - When the host plays, pauses, or seeks, these actions are mirrored on the client
   - Timing information is continuously shared to maintain sync
   - Playback rate is dynamically adjusted to correct for any timing drift

## Getting Started

### Prerequisites

- Node.js 18 or higher
- Bun package manager (`npm install -g bun`)

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/audio-sync.git
   cd audio-sync
   ```

2. Install dependencies:
   ```
   bun install
   ```

3. Start the signaling server:
   ```
   cd apps/signaling-server
   bun run start
   ```

4. In a new terminal, start the desktop app:
   ```
   cd apps/desktop-app
   bun run start
   ```

### Usage

1. **Connecting Devices**:
   - On the first device, enter a unique ID and check "I'm the host"
   - On the second device, enter a different unique ID and the host's ID

2. **Sharing Audio**:
   - The host can add audio files to the playlist
   - Files are automatically transferred to connected peers
   - All connected devices can see the shared playlist

3. **Synchronized Playback**:
   - The host controls playback (play, pause, seek)
   - Client devices automatically stay in sync with the host

## Development

- Build the application: `bun run build`
- Run in development mode: `bun run dev`
- Run the desktop app with Electron: `bun run desktop`

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- This project was built with [Electron](https://www.electronjs.org/), [React](https://reactjs.org/), and [WebRTC](https://webrtc.org/)
- Inspired by the need for synchronized audio playback across devices

