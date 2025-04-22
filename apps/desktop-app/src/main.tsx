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
    <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-white transition-colors duration-300">
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-semibold">Sync Sound</h1>
          <button 
            onClick={toggleDarkMode}
            className="p-2 rounded-md bg-gray-200 dark:bg-gray-700"
          >
            {darkMode ? '🌞 Light' : '🌙 Dark'}
          </button>
        </div>
        
        {!isConnected ? (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
            <h2 className="text-2xl mb-4">Create or Join a Room</h2>
            
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
                <h3 className="text-xl mb-2">Create a New Room</h3>
                <button 
                  onClick={createRoom}
                  disabled={!clientId}
                  className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white py-2 rounded"
                >
                  Create Room
                </button>
              </div>
              
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h3 className="text-xl mb-2">Join Existing Room</h3>
                <div className="mb-2">
                  <input 
                    type="text" 
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    placeholder="Enter 6-digit room code"
                    className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                    maxLength={6}
                  />
                </div>
                <button 
                  onClick={joinRoom}
                  disabled={!clientId || roomCode.length !== 6}
                  className="w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white py-2 rounded"
                >
                  Join Room
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl">
                {isHost ? 'Hosting Room' : 'Connected to Room'}
              </h2>
              <div className="bg-blue-100 dark:bg-blue-900 px-3 py-1 rounded">
                Room: <span className="font-mono font-bold">{roomCode}</span>
              </div>
            </div>
            
            <div className="mb-4 p-3 bg-gray-100 dark:bg-gray-700 rounded">
              <h3 className="font-semibold mb-1">Connected Users:</h3>
              <ul className="list-disc list-inside">
                {connectedUsers.map((user, index) => (
                  <li key={user} className="font-mono">
                    {user} {user === clientId ? '(You)' : ''} {index === 0 ? '(Host)' : ''}
                  </li>
                ))}
              </ul>
            </div>
            
            {isLoading && (
              <div className="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900 rounded">
                <p>{loadingMessage}</p>
              </div>
            )}
            
            {isHost && (
              <div className="mb-4">
                <label className="block mb-1">Add to Playlist</label>
                <input 
                  type="file" 
                  accept="audio/*" 
                  multiple
                  onChange={addToPlaylist}
                  className="block w-full text-sm text-gray-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-full file:border-0
                    file:text-sm file:font-semibold
                    file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100
                    dark:file:bg-gray-700 dark:file:text-gray-100"
                />
              </div>
            )}
            
            <div className="mb-6">
              <h3 className="text-xl mb-2">Playlist</h3>
              {playlist.length > 0 ? (
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {playlist.map((file, index) => (
                    <li 
                      key={index}
                      className={`py-2 px-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 
                        ${currentTrack === index ? 'bg-blue-100 dark:bg-blue-900' : ''}`}
                      onClick={() => isHost && playTrack(index)}
                    >
                      {file.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500">
                  {isHost ? "No tracks added yet" : "Waiting for host to add tracks..."}
                </p>
              )}
            </div>
            
            <div>
              <h3 className="text-xl mb-2">Now Playing</h3>
              {currentTrack >= 0 && playlist[currentTrack] ? (
                <div>
                  <p className="mb-2">{playlist[currentTrack].name}</p>
                  <audio 
                    ref={audioRef}
                    controls
                    className="w-full"
                    controlsList={isHost ? undefined : "noplaybackrate"}
                  />
                </div>
              ) : (
                <p className="text-gray-500">No track selected</p>
              )}
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
