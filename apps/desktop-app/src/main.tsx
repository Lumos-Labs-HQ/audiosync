import { createRoot } from 'react-dom/client'
import React, { useState, useEffect, useRef } from 'react'
import './styles.css'
import { WebRTCClient } from './webrct/indexRtc'

const App = () => {
  const [darkMode, setDarkMode] = useState(
    localStorage.getItem('darkMode') === 'true' || 
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const [clientId, setClientId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [playlist, setPlaylist] = useState<File[]>([])
  const [currentTrack, setCurrentTrack] = useState<number>(-1)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  
  const webrtcRef = useRef<WebRTCClient | null>(null)
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

  const handleConnect = () => {
    if (!clientId || !targetId) {
      alert('Please enter both IDs')
      return
    }
    
    // Create WebRTC client
    webrtcRef.current = new WebRTCClient(clientId, handleWebRtcMessage)
    webrtcRef.current.connect()
    
    // If host, initiate connection
    if (isHost) {
      setTimeout(() => {
        webrtcRef.current?.createOffer(targetId)
      }, 1000)
    }
    
    setIsConnected(true)
  }
  
  const handleWebRtcMessage = (data: any) => {
    switch (data.type) {
      case 'play':
        if (audioRef.current) {
          audioRef.current.currentTime = data.currentTime
          audioRef.current.play()
        }
        break
      case 'pause':
        if (audioRef.current) audioRef.current.pause()
        break
      case 'seek':
        if (audioRef.current) audioRef.current.currentTime = data.currentTime
        break
      case 'track':
        setCurrentTrack(data.index)
        break
      case 'sync':
        if (audioRef.current && Math.abs(audioRef.current.currentTime - data.currentTime) > 0.5) {
          audioRef.current.currentTime = data.currentTime
        }
        break
      case 'file-received':
        // Add the received file to the playlist
        setPlaylist(prev => [...prev, data.file])
        setLoadingMessage('')
        setIsLoading(false)
        
        // If it's the first track, play it
        if (playlist.length === 0) {
          setCurrentTrack(0)
        }
        break
    }
  }
  
  const addToPlaylist = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files)
      setPlaylist(prev => [...prev, ...newFiles])
      
      // If this is the first track added, select it
      if (playlist.length === 0 && newFiles.length > 0) {
        setCurrentTrack(0)
      }
      
      // Send files to the other peer if we're the host
      if (isHost && webrtcRef.current) {
        newFiles.forEach((file, idx) => {
          const fileIndex = playlist.length + idx
          setIsLoading(true)
          setLoadingMessage(`Sending ${file.name}...`)
          webrtcRef.current?.sendFile(file, fileIndex)
        })
      }
    }
  }
  
  const playTrack = (index: number) => {
    setCurrentTrack(index)
    
    if (isHost && webrtcRef.current) {
      webrtcRef.current.sendMessage({
        type: 'track',
        index: index
      })
    }
  }
  
  useEffect(() => {
    // Set up audio element event listeners for sync
    if (audioRef.current && isHost) {
      const syncInterval = setInterval(() => {
        if (audioRef.current && !audioRef.current.paused && webrtcRef.current) {
          webrtcRef.current.sendMessage({
            type: 'sync',
            currentTime: audioRef.current.currentTime
          })
        }
      }, 1000)
      
      // Handle play events
      audioRef.current.onplay = () => {
        if (webrtcRef.current) {
          webrtcRef.current.sendMessage({
            type: 'play',
            currentTime: audioRef.current?.currentTime || 0
          })
        }
      }
      
      // Handle pause events
      audioRef.current.onpause = () => {
        if (webrtcRef.current) {
          webrtcRef.current.sendMessage({
            type: 'pause'
          })
        }
      }
      
      // Handle seeking events
      audioRef.current.onseeked = () => {
        if (webrtcRef.current) {
          webrtcRef.current.sendMessage({
            type: 'seek',
            currentTime: audioRef.current?.currentTime || 0
          })
        }
      }
      
      return () => clearInterval(syncInterval)
    }
  }, [isHost, isConnected])

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
            <h2 className="text-2xl mb-4">Connect with a friend</h2>
            <div className="space-y-4">
              <div>
                <label className="block mb-1">Your ID</label>
                <input 
                  type="text" 
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                  placeholder="Enter a unique ID"
                />
              </div>
              
              <div>
                <label className="block mb-1">Friend's ID</label>
                <input 
                  type="text" 
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                  placeholder="Enter your friend's ID"
                />
              </div>
              
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="host" 
                  checked={isHost}
                  onChange={() => setIsHost(!isHost)}
                  className="mr-2"
                />
                <label htmlFor="host">I'm the host (controls playback)</label>
              </div>
              
              <button 
                onClick={handleConnect}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded"
              >
                Connect
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
            <h2 className="text-2xl mb-4">
              {isHost ? 'Hosting Session' : 'Connected to Host'}
            </h2>
            
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
