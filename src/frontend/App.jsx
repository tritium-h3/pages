import { useState, useEffect } from 'react'
import ColonyGame from './ColonyGame'
import { apiUrl } from './backendApi'
import './App.css'

function App() {
  const [pathname, setPathname] = useState(window.location.pathname)
  const [backendHealth, setBackendHealth] = useState({ status: 'checking', timestamp: null })

  const navigateTo = (path) => {
    if (window.location.pathname === path) return
    window.history.pushState({}, '', path)
    setPathname(path)
  }

  useEffect(() => {
    const checkBackendHealth = async () => {
      try {
        console.log('Checking backend health at:', apiUrl('/health'))
        const response = await fetch(apiUrl('/health'))
        const data = await response.json()
        console.log('Backend health response:', data)
        setBackendHealth({ status: 'online', timestamp: data.timestamp })
      } catch (error) {
        console.error('Backend health check failed:', error)
        setBackendHealth({ status: 'offline', timestamp: null })
      }
    }

    checkBackendHealth()
    const interval = setInterval(checkBackendHealth, 10000) // Check every 10 seconds
    
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', handlePopState)

    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  if (pathname === '/colony') {
    return (
      <div>
        <button className="back-btn" onClick={() => navigateTo('/')}>
          ← Back to Menu
        </button>
        <ColonyGame />
      </div>
    )
  }

  return (
    <div className="app-menu">
      <div className="backend-status">
        <div className={`status-dot status-dot--${backendHealth.status}`}></div>
        <span>
          Backend: {backendHealth.status === 'online' ? 'Online' : 
                    backendHealth.status === 'offline' ? 'Offline' : 'Checking...'}
        </span>
      </div>
      <h1>Select an App</h1>
      <button className="menu-btn" onClick={() => navigateTo('/colony')}>
        Colony Builder Game
      </button>
    </div>
  )
}

export default App
