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
  const [connectionState, setConnectionState] = useState('disconnected')
  
  const webrtcRef = useRef<WebRTCClient | null>(null)
  const audioSyncRef = useRef<AudioSync | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('darkMode', darkMode.toString())
  }, [darkMode])
  
  useEffect(() => {
    if (audioRef.current && currentTrack >= 0 && playlist[currentTrack]) {
      const url = URL.createObjectURL(playlist[currentTrack])
      audioRef.current.src = url
      audioRef.current.load()
      
      if (isHost) {
        audioRef.current.play()
      }
    }
  }, [currentTrack, playlist])
  
  const toggleDarkMode = () => {
    setDarkMode(!darkMode)
  }
  
  const handleWebRtcMessage = (data: any) => {
    console.log('Received WebRTC message:', data);
    
    if (audioSyncRef.current) {
      audioSyncRef.current.handlePeerMessage(data);
    }
    
    switch (data.type) {
      case 'file-received':
        console.log('File received in component:', data.file.name, 'size:', data.file.size);
        // Add the received file to the playlist
        setPlaylist(prev => [...prev, data.file])
        setLoadingMessage('')
        setIsLoading(false)
        
        // If it's the first track, play it
        if (playlist.length === 0) {
          setCurrentTrack(0)
        }
        break;
    }
  }
  
  const handleRoomEvent = (data: any) => {
    console.log('Room event:', data);
    
    switch (data.type) {
      case 'connected':
        setClientId(data.clientId);
        break;
        
      case 'room-created':
        setRoomCode(data.roomCode);
        setIsHost(true);
        setConnectedUsers([clientId]);
        setConnectionState('hosting');
        setIsConnected(true);
        
        if (audioSyncRef.current) {
          audioSyncRef.current.setIsHost(true);
        }
        break;
        
      case 'room-joined':
        setRoomCode(data.roomCode);
        setConnectedUsers(data.members);
        setIsHost(data.members[0] === clientId);
        setConnectionState('joined');
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
    
    console.log('Creating room as host');
    
    // Initialize WebRTC and AudioSync if not done already
    if (!webrtcRef.current) {
      webrtcRef.current = new WebRTCClient(handleWebRtcMessage, handleRoomEvent);
      webrtcRef.current.connect();
      
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
    
    console.log('Joining room:', roomCode);
    
    // Initialize WebRTC and AudioSync if not done already
    if (!webrtcRef.current) {
      webrtcRef.current = new WebRTCClient(handleWebRtcMessage, handleRoomEvent);
      webrtcRef.current.connect();
      
      audioSyncRef.current = new AudioSync(webrtcRef.current);
    }
    
    // Join room after a short delay to ensure connection is established
    setTimeout(() => {
      webrtcRef.current?.joinRoom(roomCode);
    }, 1000);
  }
  
  const addToPlaylist = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files)
      console.log('Adding files to playlist:', newFiles.map(f => f.name));
      
      setPlaylist(prev => [...prev, ...newFiles])
      
      // If this is the first track added, select it
      if (playlist.length === 0 && newFiles.length > 0) {
        setCurrentTrack(0)
      }
      
      // Send files to other peers if we're the host
      if (isHost && webrtcRef.current) {
        console.log('Broadcasting files to peers:', newFiles.map(f => f.name));
        
        newFiles.forEach((file, idx) => {
          const fileIndex = playlist.length + idx
          setIsLoading(true)
          setLoadingMessage(`Sending ${file.name}...`)
          webrtcRef.current?.broadcastFile(file, fileIndex)
        })
      }
    }
  }
  
  const playTrack = (index: number) => {
    setCurrentTrack(index)
    
    if (audioSyncRef.current) {
      audioSyncRef.current.loadLocalAudio(playlist[index]);
    }
  }
  
  useEffect(() => {
    // Initialize WebRTC client on component mount
    webrtcRef.current = new WebRTCClient(handleWebRtcMessage, handleRoomEvent);
    webrtcRef.current.connect();
    
    audioSyncRef.current = new AudioSync(webrtcRef.current);
    
    return () => {
      // Clean up on unmount
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
      </div>

      {/* Main content */}
      {!isConnected ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="bg-purple-800/50 backdrop-blur-sm dark:bg-purple-900/50 p-8 rounded-xl shadow-2xl w-full max-w-md border border-purple-700/50">
            <h2 className="text-2xl mb-6 font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Create or Join a Room
            </h2>
            
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
                <div className="space-y-3">
                  <div className="font-medium truncate">{playlist[currentTrack].name}</div>
                  <audio 
                    ref={audioRef}
                    controls
                    className="w-full audio-player"
                    controlsList={isHost ? undefined : "noplaybackrate"}
                  />
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
  )
}

const container = document.getElementById('root')
const root = createRoot(container!)
root.render(<App />)
