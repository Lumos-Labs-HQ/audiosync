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
      {/* App Header - update header background */}
      <header className="bg-purple-800 dark:bg-purple-900 border-b border-purple-700">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-semibold">Sync Sound</h1>
            {isConnected && (
              <span className="bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded text-sm">
                Room: <span className="font-mono font-bold">{roomCode}</span>
              </span>
            )}
          </div>
          <button 
            onClick={toggleDarkMode}
            className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            {darkMode ? '🌞' : '🌙'}
          </button>
        </div>
      </header>

      {/* Update the login/connection card background */}
      {!isConnected ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-purple-800 dark:bg-purple-900 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-2xl mb-4 font-bold">Create or Join a Room</h2>
            
            {clientId ? (
              <div className="mb-4 p-2 bg-green-100 dark:bg-green-900 rounded">
                <p>Your ID: <span className="font-mono">{clientId}</span></p>
              </div>
            ) : (
              <div className="mb-4 p-2 bg-yellow-100 dark:bg-yellow-900 rounded">
                <p>Connecting to server...</p>
              </div>
            )}
            
            <div className="space-y-4">
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h3 className="text-lg font-medium mb-2">Create a New Room</h3>
                <button 
                  onClick={createRoom}
                  disabled={!clientId}
                  className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white py-2 rounded-md transition-colors"
                >
                  Create Room
                </button>
              </div>
              
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h3 className="text-lg font-medium mb-2">Join Existing Room</h3>
                <input 
                  type="text" 
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="Enter 6-digit room code"
                  className="w-full p-2 mb-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  maxLength={6}
                />
                <button 
                  onClick={joinRoom}
                  disabled={!clientId || roomCode.length !== 6}
                  className="w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white py-2 rounded-md transition-colors"
                >
                  Join Room
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex">
          {/* Sidebar - update background */}
          <div className="w-64 bg-purple-800 dark:bg-purple-900 border-r border-purple-700">
            <div className="p-4">
              <h3 className="font-medium mb-2">Connected Users</h3>
              <ul className="space-y-1">
                {connectedUsers.map((user, index) => (
                  <li key={user} className="flex items-center space-x-2 text-sm py-1 px-2 rounded">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    <span className="font-mono">
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
              <div className="bg-yellow-100 dark:bg-yellow-900 px-4 py-2 text-sm">
                {loadingMessage}
              </div>
            )}

            {/* Playlist Section */}
            <div className="flex-1 p-4 overflow-auto">
              {isHost && (
                <div className="mb-4">
                  <button
                    onClick={() => document.getElementById('file-input')?.click()}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md"
                  >
                    <span>Add Files</span>
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

              <div className="bg-purple-800 dark:bg-purple-900 rounded-lg shadow">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="font-medium">Playlist</h3>
                </div>
                {playlist.length > 0 ? (
                  <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                    {playlist.map((file, index) => (
                      <li 
                        key={index}
                        className={`flex items-center px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer
                          ${currentTrack === index ? 'bg-blue-50 dark:bg-blue-900' : ''}`}
                        onClick={() => isHost && playTrack(index)}
                      >
                        <span className="mr-3">
                          {currentTrack === index ? '▶️' : `${index + 1}.`}
                        </span>
                        <span className="flex-1 truncate">{file.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="p-4 text-center text-gray-500">
                    {isHost ? "No tracks added yet" : "Waiting for host to add tracks..."}
                  </div>
                )}
              </div>
            </div>

            {/* Update audio player background */}
            <div className="border-t border-purple-700 bg-purple-800 dark:bg-purple-900 p-4">
              {currentTrack >= 0 && playlist[currentTrack] ? (
                <div>
                  <div className="mb-2 font-medium">{playlist[currentTrack].name}</div>
                  <audio 
                    ref={audioRef}
                    controls
                    className="w-full"
                    controlsList={isHost ? undefined : "noplaybackrate"}
                  />
                </div>
              ) : (
                <div className="text-center text-gray-500">
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
