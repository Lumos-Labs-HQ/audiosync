import { createRoot } from 'react-dom/client'
import React, { useState, useEffect, useRef } from 'react'
import './styles.css'
import { WebRTCClient } from './webrct/indexRtc'
import { AudioSync } from './webrct/audioSync'

const App = () => {
  const [darkMode, setDarkMode] = useState(
    localStorage.getItem('darkMode') === 'true' ||
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const [clientId, setClientId] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [connectedUsers, setConnectedUsers] = useState<string[]>([])
  const [playlist, setPlaylist] = useState<File[]>([])
  const [currentTrack, setCurrentTrack] = useState<number>(-1)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [permissionRequested, setPermissionRequested] = useState(false)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [bufferingStatus, setBufferingStatus] = useState('');

  const webrtcRef = useRef<WebRTCClient | null>(null)
  const audioSyncRef = useRef<AudioSync | null>(null)

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('darkMode', darkMode.toString())
  }, [darkMode])

  useEffect(() => {
    const requestPermission = async () => {
      try {
        setPermissionRequested(true);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        setPermissionGranted(true);
      } catch (err) {
        console.error('Error requesting audio permission:', err);
        setPermissionGranted(false);
      }
    };

    if (!permissionRequested) {
      requestPermission();
    }
  }, [permissionRequested]);

  useEffect(() => {
    if (currentTrack >= 0 && playlist[currentTrack] && audioSyncRef.current) {
      audioSyncRef.current.loadLocalAudio(playlist[currentTrack]);

      // If host, automatically start playing
      if (isHost) {
        setTimeout(() => {
          audioSyncRef.current?.play();
          setIsAudioPlaying(true);
        }, 500); // Give a little time for audio to load
      }
    }
  }, [currentTrack, playlist, isHost]);

  const toggleDarkMode = () => {
    setDarkMode(!darkMode)
  }

  const handleWebRtcMessage = (data: any) => {
    // Always pass message to AudioSync first
    if (audioSyncRef.current) {
      audioSyncRef.current.handlePeerMessage(data);
    }

    // Then handle UI updates
    switch (data.type) {
      case 'file-received':
        if (data.file) {
          setPlaylist(prev => [...prev, data.file]);
          setLoadingMessage('');
          setIsLoading(false);

          // If it's the first track, automatically select it
          if (playlist.length === 0) {
            setCurrentTrack(0);
          }
        }
        break;

      case 'control':
        if (data.action === 'play') {
          setIsAudioPlaying(true);
          setLoadingMessage('');
        } else if (data.action === 'pause') {
          setIsAudioPlaying(false);
        } else if (data.action === 'sync') {
          setBufferingStatus('Syncing...');
          setTimeout(() => setBufferingStatus(''), 1000);
        }
        break;

      case 'stream-info':
        if (!isHost) {
          setLoadingMessage(`Preparing to stream: ${data.name}`);
          setIsLoading(true);
          setCurrentTrack(0);
        }
        break;

      case 'stream-end':
        if (!isHost) {
          setIsAudioPlaying(false);
          setLoadingMessage('');
          setIsLoading(false);
        }
        break;

      case 'audio-chunk':
        if (!isHost) {
          if (data.sequence < 5 || data.sequence % 20 === 0) {
            setBufferingStatus(`Received chunk ${data.sequence}`);
          }
          setIsLoading(false);
        }
        break;
    }
  }

  const handleRoomEvent = (data: any) => {
    switch (data.type) {
      case 'connected':
        setClientId(data.clientId);
        break;

      case 'room-created':
        setRoomCode(data.roomCode);
        setIsHost(true);
        setConnectedUsers([clientId]);
        setIsConnected(true);

        if (audioSyncRef.current) {
          audioSyncRef.current.setIsHost(true);
        }
        break;

      case 'room-joined':
        setRoomCode(data.roomCode);
        setConnectedUsers(data.members);
        setIsHost(data.members[0] === clientId);
        setIsConnected(true);

        if (audioSyncRef.current) {
          audioSyncRef.current.setIsHost(data.members[0] === clientId);
        }
        break;

      case 'user-joined':
        setConnectedUsers(prev => [...prev, data.clientId]);
        break;

      case 'user-left':
        setConnectedUsers(prev => prev.filter(id => id !== data.clientId));
        break;

      case 'error':
        alert(`Error: ${data.message}`);
        break;
    }
  }

  const createRoom = () => {
    if (!clientId) {
      alert('Please wait to receive a client ID');
      return;
    }

    if (!permissionGranted) {
      alert('Audio permission is required. Please allow microphone access.');
      return;
    }

    // Initialize WebRTC and AudioSync if not done already
    if (!webrtcRef.current) {
      webrtcRef.current = new WebRTCClient(handleWebRtcMessage, handleRoomEvent);
      webrtcRef.current.connect('ws://' + window.location.hostname + ':3001');

      audioSyncRef.current = new AudioSync(webrtcRef.current);
    }

    // Create room after a short delay to ensure connection is established
    setTimeout(() => {
      webrtcRef.current?.createRoom();
    }, 1000);
  }

  const joinRoom = () => {
    if (!clientId || !roomCode) {
      alert('Please wait to receive a client ID and enter a room code');
      return;
    }

    if (!permissionGranted) {
      alert('Audio permission is required. Please allow microphone access.');
      return;
    }

    // Initialize WebRTC and AudioSync if not done already
    if (!webrtcRef.current) {
      webrtcRef.current = new WebRTCClient(handleWebRtcMessage, handleRoomEvent);
      webrtcRef.current.connect('ws://' + window.location.hostname + ':3001');

      audioSyncRef.current = new AudioSync(webrtcRef.current);
    }

    // Join room after a short delay to ensure connection is established
    setTimeout(() => {
      webrtcRef.current?.joinRoom(roomCode);
    }, 1000);
  }

  const addToPlaylist = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      setPlaylist(prev => [...prev, ...newFiles]);

      // If this is the first file added and we're the host,
      // select it automatically for playback
      if (playlist.length === 0) {
        setCurrentTrack(0);
      }

      // If we're host, broadcast the file to all peers
      if (webrtcRef.current && isHost) {
        newFiles.forEach((file, index) => {
          webrtcRef.current?.broadcastFile(file, playlist.length + index);
        });
      }
    }
  }

  const playTrack = (index: number) => {
    if (index >= 0 && index < playlist.length) {
      setCurrentTrack(index);
      // Play will be triggered in the useEffect
    }
  }

  const togglePlayPause = () => {
    if (!audioSyncRef.current) return;

    if (isAudioPlaying) {
      audioSyncRef.current.pause();
      setIsAudioPlaying(false);
    } else {
      // Ensure audio context is resumed before playing
      const audioCtx = (window as any).audioContext;
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
          audioSyncRef.current?.play();
          setIsAudioPlaying(true);
        }).catch((err: Error) => {
          console.error("Error resuming audio context:", err);
        });
      } else {
        audioSyncRef.current.play();
        setIsAudioPlaying(true);
      }
    }
  };

  useEffect(() => {
    // Initialize WebRTC client on component mount
    webrtcRef.current = new WebRTCClient(handleWebRtcMessage, handleRoomEvent);
    webrtcRef.current.connect('ws://' + window.location.hostname + ':3001');

    audioSyncRef.current = new AudioSync(webrtcRef.current);

    // Add a click handler to the document to ensure audio context activation
    const handleUserInteraction = () => {
      if (audioSyncRef.current) {
        const audioCtx = (audioSyncRef.current as any).audioContext;
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume().catch((err: Error) => {
            console.error("Failed to resume audio context:", err);
          });
        }
      }
    };

    document.addEventListener('click', handleUserInteraction);
    document.addEventListener('touchstart', handleUserInteraction);
    document.addEventListener('keydown', handleUserInteraction);

    return () => {
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('touchstart', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);

      if (webrtcRef.current) {
        webrtcRef.current.disconnect();
      }

      if (audioSyncRef.current) {
        audioSyncRef.current.dispose();
      }
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-purple-900 dark:bg-purple-950 text-gray-100">
      {/* Native-style titlebar */}
      <div className="bg-purple-950 dark:bg-black flex items-center justify-between px-4 py-2 select-none app-drag">
        <div className="flex items-center space-x-3">
          <img src="/app-icon.png" className="w-5 h-5" alt="logo" />
          <h1 className="text-sm font-medium">Sync Sound</h1>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={toggleDarkMode}
            className="p-1 hover:bg-purple-800 rounded-md text-sm"
          >
            {darkMode ? '🌞' : '🌙'}
          </button>
          {/* Add window controls if needed */}
        </div>

        {!permissionGranted && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 rounded">
            <p className="font-bold">Microphone Access Required</p>
            <p>This app needs access to your microphone for audio synchronization.</p>
            <button
              onClick={() => setPermissionRequested(false)}
              className="mt-2 px-3 py-1 bg-blue-500 text-white rounded"
            >
              Request Permission
            </button>
          </div>
        )}

        {!isConnected ? (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
            <h2 className="text-2xl mb-4">Create or Join a Room</h2>

            {clientId ? (
              <div className="mb-6 p-3 bg-green-500/20 border border-green-500/30 rounded-lg">
                <p className="text-sm">Your ID: <span className="font-mono font-medium">{clientId}</span></p>
              </div>
            ) : (
              <div className="mb-6 p-3 bg-yellow-500/20 border border-yellow-500/30 rounded-lg">
                <p className="text-sm flex items-center gap-2">
                  <span className="animate-spin">⌛</span>
                  Connecting to server...
                </p>
              </div>
            )}

            <div className="space-y-6">
              <div className="border-t border-purple-700/50 pt-6">
                <h3 className="text-lg font-medium mb-3">Create a New Room</h3>
                <button
                  onClick={createRoom}
                  disabled={!clientId}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 disabled:from-gray-600 disabled:to-gray-700 text-white py-2.5 rounded-lg transition-all shadow-lg hover:shadow-xl disabled:shadow-none"
                >
                  Create Room
                </button>
              </div>

              <div className="border-t border-purple-700/50 pt-6">
                <h3 className="text-lg font-medium mb-3">Join Existing Room</h3>
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="Enter 6-digit room code"
                  className="w-full p-2.5 mb-3 rounded-lg bg-purple-950/50 border border-purple-700/50 focus:ring-2 focus:ring-purple-400 focus:border-transparent transition-all"
                  maxLength={6}
                />
                <button
                  onClick={joinRoom}
                  disabled={!clientId || roomCode.length !== 6}
                  className="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:from-gray-600 disabled:to-gray-700 text-white py-2.5 rounded-lg transition-all shadow-lg hover:shadow-xl disabled:shadow-none"
                >
                  Join Room
                </button>
              </div>
            </div>
          </div>

        ) : (
          <div className="flex-1 flex">
            {/* Sidebar */}
            <div className="w-72 bg-purple-800/30 backdrop-blur-sm border-r border-purple-700/50">
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium">Room Members</h3>
                  <span className="text-xs bg-purple-700/50 px-2 py-1 rounded">
                    {roomCode}
                  </span>
                </div>
                <ul className="space-y-1">
                  {connectedUsers.map((user, index) => (
                    <li key={user} className="flex items-center space-x-2 text-sm py-2 px-3 rounded-lg bg-purple-950/30 border border-purple-700/30">
                      <span className="w-2 h-2 bg-green-500 rounded-full shadow-lg shadow-green-500/50"></span>
                      <span className="font-medium">
                        {user === clientId ? 'You' : `User ${index + 1}`}
                        {index === 0 && ' (Host)'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col">
              {isLoading && (
                <div className="bg-yellow-500/20 border-b border-yellow-500/30 px-4 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="animate-spin">⌛</span>
                    {loadingMessage}
                  </div>
                </div>
              )}

              {/* Playlist Section */}
              <div className="flex-1 p-6 overflow-auto">
                {isHost && (
                  <div className="mb-6">
                    <button
                      onClick={() => document.getElementById('file-input')?.click()}
                      className="flex items-center space-x-2 px-6 py-2.5 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-lg shadow-lg hover:shadow-xl transition-all"
                    >
                      <span>Add Audio Files</span>
                    </button>
                    <input
                      id="file-input"
                      type="file"
                      accept="audio/*"
                      multiple
                      onChange={addToPlaylist}
                      className="hidden"
                    />
                  </div>
                )}

                <div className="bg-purple-800/30 backdrop-blur-sm rounded-xl border border-purple-700/50">
                  <div className="px-4 py-3 border-b border-purple-700/50">
                    <h3 className="font-medium">Playlist</h3>
                  </div>
                  {playlist.length > 0 ? (
                    <ul className="divide-y divide-purple-700/30">
                      {playlist.map((file, index) => (
                        <li
                          key={index}
                          className={`flex items-center px-4 py-3 hover:bg-purple-700/20 cursor-pointer transition-colors
                          ${currentTrack === index ? 'bg-blue-500/20 border-l-4 border-blue-500' : ''}`}
                          onClick={() => isHost && playTrack(index)}
                        >
                          <span className="mr-3 w-6 text-center">
                            {currentTrack === index ? '▶️' : `${index + 1}`}
                          </span>
                          <span className="flex-1 truncate">{file.name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="p-8 text-center text-gray-400">
                      {isHost ? (
                        <div className="space-y-2">
                          <p>No tracks in playlist</p>
                          <p className="text-sm">Click "Add Audio Files" to get started</p>
                        </div>
                      ) : (
                        "Waiting for host to add tracks..."
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Audio Player */}
              <div className="border-t border-purple-700/50 bg-purple-800/30 backdrop-blur-sm p-6">
                {currentTrack >= 0 && playlist[currentTrack] ? (
                  <div>
                    <p className="mb-2">{playlist[currentTrack].name}</p>

                    {bufferingStatus && (
                      <div className="my-2 p-1 text-xs text-center bg-blue-100 dark:bg-blue-900 rounded">
                        {bufferingStatus}
                      </div>
                    )}

                    {/* Controls */}
                    <div className="flex items-center justify-center space-x-4 my-4">
                      <button
                        onClick={togglePlayPause}
                        className="p-3 rounded-full bg-blue-500 text-white hover:bg-blue-600"
                        disabled={!permissionGranted || (!isHost && !isAudioPlaying)}
                      >
                        {isAudioPlaying ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="4" width="4" height="16" />
                            <rect x="14" y="4" width="4" height="16" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* Connection info */}
                    <div className="mt-4 p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm">
                      <p>Role: <span className="font-semibold">{isHost ? 'Host' : 'Client'}</span></p>
                      <p>Status: <span className="font-semibold">{isAudioPlaying ? 'Playing' : 'Paused'}</span></p>
                      {!isHost && <p className="text-yellow-600">Only the host can select tracks and control playback</p>}
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-400">
                    No track selected
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const container = document.getElementById('root')
const root = createRoot(container!)
root.render(<App />)

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
