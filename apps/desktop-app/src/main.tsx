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
  const [targetId, setTargetId] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isInitiator, setIsInitiator] = useState(false)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  
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
    
    // Create AudioSync instance
    audioSyncRef.current = new AudioSync(webrtcRef.current, isInitiator)
    
    // Connect to peer
    if (isInitiator) {
      setTimeout(() => {
        webrtcRef.current?.createOffer(targetId)
      }, 1000)
    }
    
    setIsConnected(true)
  }
  
  const handleWebRtcMessage = (data: any) => {
    if (audioSyncRef.current) {
      audioSyncRef.current.handlePeerMessage(data)
    }
  }
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0]
      setAudioFile(file)
      
      if (audioSyncRef.current) {
        audioSyncRef.current.loadLocalAudio(file)
      }
    }
  }
  
  const handlePlay = () => {
    if (audioSyncRef.current) {
      audioSyncRef.current.play()
    }
  }
  
  const handlePause = () => {
    if (audioSyncRef.current) {
      audioSyncRef.current.pause()
    }
  }

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
                  id="initiator" 
                  checked={isInitiator}
                  onChange={() => setIsInitiator(!isInitiator)}
                  className="mr-2"
                />
                <label htmlFor="initiator">I'm creating the room</label>
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
              Connected to {targetId}
            </h2>
            
            <div className="mb-4">
              <label className="block mb-1">Select Audio File</label>
              <input 
                type="file" 
                accept="audio/*" 
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-full file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100
                  dark:file:bg-gray-700 dark:file:text-gray-100"
              />
            </div>
            
            {audioFile && (
              <div className="space-y-4">
                <p>Playing: {audioFile.name}</p>
                
                <div className="flex space-x-2">
                  <button 
                    onClick={handlePlay}
                    className="bg-green-500 hover:bg-green-600 text-white py-2 px-4 rounded"
                  >
                    Play
                  </button>
                  <button 
                    onClick={handlePause}
                    className="bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded"
                  >
                    Pause
                  </button>
                </div>
                
                <div>
                  <audio 
                    ref={(el) => {
                      if (el && audioSyncRef.current) {
                        // This links the audio element from AudioSync
                        const audioEl = audioSyncRef.current.getAudioElement();
                        if (audioEl) {
                          el.srcObject = (audioEl as any).srcObject;
                        }
                      }
                    }}
                    controls
                    className="w-full mt-4"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const container = document.getElementById('root')
const root = createRoot(container!)
root.render(<App />)
