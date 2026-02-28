import { useState, useEffect } from 'react'
import ColonyGame from './ColonyGame'
import WeatherApp from './WeatherApp'
import WikiStory from './WikiStory'
import TodoList from './TodoList'
import LLMDuoChat from './LLMDuoChat'
import SpriteEditor from './SpriteEditor'
import { getBackendOrigin, apiUrl } from './backendApi'
import './App.css'

function App() {
  const [pathname, setPathname] = useState(window.location.pathname)
  const [backendHealth, setBackendHealth] = useState({ status: 'checking', timestamp: null })
  const backendUrl = getBackendOrigin()

  const navigateTo = (path) => {
    if (window.location.pathname === path) return
    window.history.pushState({}, '', path)
    setPathname(path)
  }

  useEffect(() => {
    console.log('Backend URL:', backendUrl)
    
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
  }, [backendUrl])

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', handlePopState)

    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  if (pathname === '/weather') {
    return (
      <div>
        <button className="back-btn" onClick={() => navigateTo('/')}>
          ← Back to Menu
        </button>
        <WeatherApp />
      </div>
    )
  }

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

  if (pathname === '/wikistory') {
    return (
      <div>
        <button className="back-btn--wikistory" onClick={() => navigateTo('/')}>
          ← Back to Menu
        </button>
        <WikiStory />
      </div>
    )
  }

  if (pathname === '/todo') {
    return (
      <div>
        <button className="back-btn--todo" onClick={() => navigateTo('/')}>
          ← Back to Menu
        </button>
        <TodoList />
      </div>
    )
  }

  if (pathname === '/llmduochat') {
    return (
      <div>
        <button className="back-btn--llmduochat" onClick={() => navigateTo('/')}>
          ← Back to Menu
        </button>
        <LLMDuoChat />
      </div>
    )
  }

  if (pathname === '/sprite-editor') {
    return <SpriteEditor />
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
      <button className="menu-btn" onClick={() => navigateTo('/weather')}>
        Weather App
      </button>
      <button className="menu-btn" onClick={() => navigateTo('/colony')}>
        Colony Builder Game
      </button>
      <button className="menu-btn" onClick={() => navigateTo('/wikistory')}>
        WikiStory Generator
      </button>
      <button className="menu-btn" onClick={() => navigateTo('/todo')}>
        Todo List
      </button>
      <button className="menu-btn menu-btn--purple" onClick={() => navigateTo('/llmduochat')}>
        🎭 LLM Duo Chat
      </button>
      <button className="menu-btn" onClick={() => navigateTo('/sprite-editor')}>
        🖼 Sprite Group Editor
      </button>
    </div>
  )
}

export default App
