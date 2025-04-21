import { createRoot } from 'react-dom/client'
import React from 'react'
import './styles.css'

const App = () => {
  return (
    <div className="h-screen flex justify-center items-center">
      <h1 className="text-4xl font-semibold">Sync Sound App</h1>
    </div>
  )
}

const container = document.getElementById('root')
const root = createRoot(container!)
root.render(<App />)
