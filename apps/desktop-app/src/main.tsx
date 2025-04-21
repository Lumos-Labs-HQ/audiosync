import { createRoot } from 'react-dom/client'
import React, { useState, useEffect } from 'react'
import './styles.css'

const App = () => {
  const [darkMode, setDarkMode] = useState(
    localStorage.getItem('darkMode') === 'true' || 
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  
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

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-white transition-colors duration-300">
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center">
          <h1 className="text-4xl font-semibold">Sync Sound App</h1>
          <button 
            onClick={toggleDarkMode}
            className="p-2 rounded-md bg-gray-200 dark:bg-gray-700"
          >
            {darkMode ? '🌞 Light' : '🌙 Dark'}
          </button>
        </div>
      </div>
    </div>
  )
}

const container = document.getElementById('root')
const root = createRoot(container!)
root.render(<App />)
