import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { AudioSync } from './webrct/audioSync';
import './styles.css';

declare global {
  interface HTMLAudioElement {
    playsInline?: boolean;
  }
}

const App: React.FC = () => {
  const [roomId, setRoomId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [connectionStatus, setConnectionStatus] = useState('');

  const audioSyncRef = useRef<AudioSync | null>(null);
  const originalConsoleLogRef = useRef<typeof console.log | null>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);

  const addDebugMessage = (message: string) => {
    if (originalConsoleLogRef.current) {
      originalConsoleLogRef.current(message);
    }
  };

  useEffect(() => {
    originalConsoleLogRef.current = console.log;
    const customLogger = (...args: any[]) => {
      if (originalConsoleLogRef.current) {
        originalConsoleLogRef.current(...args);
      }
    };
    console.log = customLogger;

    const signalingServer = 'http://localhost:3001';
    try {
      addDebugMessage('Initializing AudioSync');
      audioSyncRef.current = new AudioSync(signalingServer);

      audioSyncRef.current.onAudioAvailable(() => {
        addDebugMessage('New audio chunks available for playback');
        setConnectionStatus('Receiving audio stream');

        const audioElement = audioSyncRef.current?.getAudioElement();
        if (audioElement && audioContainerRef.current) {
          if (!audioContainerRef.current.contains(audioElement)) {
            while (audioContainerRef.current.firstChild) {
              audioContainerRef.current.removeChild(audioContainerRef.current.firstChild);
            }
            audioElement.className = 'audio-player';
            audioElement.controls = true;
            audioContainerRef.current.appendChild(audioElement);
            addDebugMessage('Added audio element to DOM');
          }
        }
      });

      return () => {
        if (originalConsoleLogRef.current) {
          console.log = originalConsoleLogRef.current;
        }
        audioSyncRef.current?.disconnect();
      };
    } catch (error) {
      addDebugMessage(`Error initializing AudioSync: ${(error as Error).message}`);
      setConnectionStatus('Failed to connect to signaling server');
    }
  }, []);

  const handleCreateRoom = async () => {
    if (!roomId || !audioSyncRef.current) return;
    try {
      setConnectionStatus('Creating room...');
      await audioSyncRef.current.joinRoom(roomId);
      setIsHost(true);
      setIsConnected(true);
      setConnectionStatus('Room created! Waiting for participants...');
      addDebugMessage(`Created and joined room: ${roomId}`);
    } catch (error) {
      addDebugMessage(`Error creating room: ${(error as Error).message}`);
      setConnectionStatus('Failed to create room');
    }
  };

  const handleJoinRoom = async () => {
    if (!roomId || !audioSyncRef.current) return;
    try {
      setConnectionStatus('Joining room...');
      await audioSyncRef.current.joinRoom(roomId);
      setIsConnected(true);
      setConnectionStatus('Joined room! Waiting for host to start streaming...');
      addDebugMessage(`Joined room: ${roomId}`);
    } catch (error) {
      addDebugMessage(`Error joining room: ${(error as Error).message}`);
      setConnectionStatus('Failed to join room');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files?.length) {
      if (!files[0].type.startsWith('audio/')) {
        addDebugMessage(`Selected file is not an audio file: ${files[0].type}`);
        setConnectionStatus('Please select a valid audio file');
        return;
      }

      setAudioFile(files[0]);
      setConnectionStatus(`Selected file: ${files[0].name}`);
      addDebugMessage(`Selected audio file: ${files[0].name}, size: ${files[0].size} bytes, type: ${files[0].type}`);
    }
  };

  const handleStartStreaming = async () => {
    if (audioFile && audioSyncRef.current) {
      try {
        setConnectionStatus('Starting streaming...');
        addDebugMessage(`Starting to stream audio file in chunks...`);
        await audioSyncRef.current.startStreamingAudioFile(audioFile);
        setConnectionStatus('Streaming audio to participants');
        addDebugMessage('Audio file streaming completed');
      } catch (error) {
        addDebugMessage(`Error streaming audio: ${(error as Error).message}`);
        setConnectionStatus('Failed to start streaming');
      }
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-100 to-white flex flex-col items-center px-4 py-10">
      <h1 className="text-4xl font-extrabold text-indigo-600 mb-6">🎵 Audio Sync</h1>

      {connectionStatus && (
        <div className="bg-white text-indigo-700 border-l-4 border-indigo-500 shadow px-4 py-3 mb-6 w-full max-w-md text-sm rounded-md">
          {connectionStatus}
        </div>
      )}

      {!isConnected ? (
        <div className="bg-white w-full max-w-md p-6 rounded-xl shadow-lg flex flex-col gap-4">
          <input
            type="text"
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
            placeholder="Enter Room ID"
            className="w-full px-4 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex gap-4 mt-2">
            <button
              onClick={handleCreateRoom}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-md transition-all"
            >
              Create Room
            </button>
            <button
              onClick={handleJoinRoom}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-md transition-all"
            >
              Join Room
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white w-full max-w-md p-6 rounded-xl shadow-lg flex flex-col gap-6">
          <h2 className="text-xl font-bold text-slate-800 text-center">Room: {roomId}</h2>

          {isHost ? (
            <>
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileSelect}
                className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-100 file:text-indigo-700 hover:file:bg-indigo-200"
              />
              {audioFile && (
                <button
                  onClick={handleStartStreaming}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-md transition-all"
                >
                  Start Streaming
                </button>
              )}
              <div ref={audioContainerRef} className="w-full rounded-lg bg-slate-50 p-2 min-h-[50px]" />
            </>
          ) : (
            <>
              <p className="text-slate-500 text-center">Waiting for host to start streaming...</p>
              <div ref={audioContainerRef} className="w-full rounded-lg bg-slate-50 p-2 min-h-[50px]" />
            </>
          )}
        </div>
      )}
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<App />);
}
