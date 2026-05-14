import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './global.css'

// Clear all localStorage on app load to force fresh state
for (let i = localStorage.length - 1; i >= 0; i--) {
  const key = localStorage.key(i)
  if (key?.includes('zustand') || key?.includes('agent')) {
    localStorage.removeItem(key)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
