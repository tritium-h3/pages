import { useState, useEffect, useRef, useCallback } from 'react';
import Markdown from 'react-markdown';
import { getBackendOrigin, apiUrl } from './backendApi';

interface Message {
  speaker: string;
  text: string;
}

interface Character {
  name: string;
  personality: string;
}

export default function LLMDuoChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [character1, setCharacter1] = useState<Character | null>(null);
  const [character2, setCharacter2] = useState<Character | null>(null);
  const [situation, setSituation] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSpeaker, setCurrentSpeaker] = useState<string>('');
  const [activeConversations, setActiveConversations] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const hasAutoStartedRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const startNewConversation = useCallback(async (isManual = false) => {
    console.log(`startNewConversation called - isManual: ${isManual}, hasAutoStarted: ${hasAutoStartedRef.current}`);
    
    // Auto-start should only happen once (prevent StrictMode double-call)
    // But allow it if the WebSocket was closed (e.g., after cleanup)
    const wsIsClosed = !wsRef.current || wsRef.current.readyState === WebSocket.CLOSED || wsRef.current.readyState === WebSocket.CLOSING;
    if (!isManual && hasAutoStartedRef.current && !wsIsClosed) {
      console.log('Skipping auto-start (already started once and WebSocket is still active)');
      return;
    }
    
    if (!isManual) {
      console.log('Marking as auto-started');
      hasAutoStartedRef.current = true;
    }

    // Close existing WebSocket if any
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      console.log('Closing existing WebSocket');
      wsRef.current.close();
      wsRef.current = null;
    }

    setCharacter1(null);
    setCharacter2(null);
    setSituation('');
    setMessages([]);
    setError(null);
    setIsLoading(true);
    setCurrentSpeaker('');

    console.log('Creating new WebSocket connection');
    
    try {
      // Create WebSocket connection
      const backendOrigin = getBackendOrigin();
      const wsUrl = backendOrigin.replace('http://', 'ws://').replace('https://', 'wss://');
      const ws = new WebSocket(`${wsUrl}/ws/llm-duo-chat`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected, sending start message');
        setError(null); // Clear any previous errors
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'start' }));
        }
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data.type);
        
        if (data.type === 'setup') {
          setCharacter1(data.character1);
          setCharacter2(data.character2);
          setSituation(data.situation);
        } else if (data.type === 'chunk') {
          setCurrentSpeaker(data.speaker);
          setMessages(prev => {
            const newMessages = [...prev];
            if (newMessages.length > 0 && newMessages[newMessages.length - 1].speaker === data.speaker) {
              newMessages[newMessages.length - 1] = {
                ...newMessages[newMessages.length - 1],
                text: newMessages[newMessages.length - 1].text + data.chunk
              };
            } else {
              newMessages.push({ speaker: data.speaker, text: data.chunk });
            }
            return newMessages;
          });
        } else if (data.type === 'done') {
          console.log('Conversation completed');
          setIsLoading(false);
          setCurrentSpeaker('');
          ws.close();
        } else if (data.type === 'error') {
          console.error('Conversation error:', data.message);
          setError(data.message);
          setIsLoading(false);
          ws.close();
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        // Only set error if WebSocket was expected to be open
        // (not if we're intentionally closing it)
        if (ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED) {
          setError('Connection error occurred');
          setIsLoading(false);
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed', event.code, event.reason);
        if (isLoading) {
          setIsLoading(false);
        }
        // Only show error if it was an unexpected close (not normal closure)
        if (event.code !== 1000 && event.code !== 1001 && ws === wsRef.current) {
          // Don't set error if we're already showing one or if this is a clean close
          if (!error && event.code !== 1005) {
            console.log('Unexpected WebSocket close, code:', event.code);
          }
        }
      };
    } catch (err) {
      console.error('Error setting up WebSocket:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log('useEffect for auto-start running');
    // Auto-start conversation on component mount
    startNewConversation(false);
    
    // Cleanup: close WebSocket on unmount
    return () => {
      if (wsRef.current) {
        console.log('Component unmounting, closing WebSocket');
        wsRef.current.close();
        wsRef.current = null;
      }
      // Reset auto-start flag so it works after Strict Mode remount
      hasAutoStartedRef.current = false;
    };
  }, [startNewConversation]);

  useEffect(() => {
    // Poll for active conversation count
    const checkStatus = async () => {
      try {
        const response = await fetch(apiUrl('/llm-duo-chat/status'));
        const data = await response.json();
        setActiveConversations(data.activeConversations);
      } catch (err) {
        // Silently fail
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 2000); // Check every 2 seconds
    
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl p-6 mb-6">
          <h1 className="text-4xl font-bold text-center mb-2 text-purple-600">
            🎭 LLM Duo Chat Theatre 🎭
          </h1>
          <p className="text-center text-gray-600 mb-6">
            Watch two AI characters improvise a conversation!
          </p>

          {activeConversations > 1 && (
            <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded mb-4 text-center">
              ⚠️ Warning: {activeConversations} conversations running simultaneously! This may slow down responses.
            </div>
          )}

          {activeConversations === 1 && isLoading && (
            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 rounded mb-4 text-center text-sm">
              💬 1 active conversation
            </div>
          )}

          {character1 && character2 && (
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-gradient-to-br from-pink-50 to-pink-100 p-4 rounded-lg border-2 border-pink-300">
                <h3 className="font-bold text-lg text-pink-700">{character1.name}</h3>
                <p className="text-sm text-pink-600">{character1.personality}</p>
              </div>
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border-2 border-blue-300">
                <h3 className="font-bold text-lg text-blue-700">{character2.name}</h3>
                <p className="text-sm text-blue-600">{character2.personality}</p>
              </div>
            </div>
          )}

          {situation && (
            <div className="bg-gradient-to-r from-yellow-50 to-orange-50 p-4 rounded-lg border-2 border-orange-300 mb-6">
              <h3 className="font-bold text-orange-700 mb-2">💫 The Situation:</h3>
              <p className="text-orange-900">{situation}</p>
            </div>
          )}

          <div className="flex justify-center mb-4">
            <button
              onClick={() => startNewConversation(true)}
              disabled={isLoading}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-bold py-3 px-6 rounded-lg transition-colors shadow-md"
            >
              {isLoading ? '🎬 Chat in Progress...' : '🎲 New Random Chat'}
            </button>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              ❌ {error}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-xl p-6 min-h-[500px] max-h-[600px] overflow-y-auto">
          {messages.length === 0 && !isLoading && (
            <div className="text-center text-gray-400 py-20">
              Click "New Random Chat" to start a conversation!
            </div>
          )}

          {messages.map((message, index) => {
            const isChar1 = message.speaker === character1?.name;
            return (
              <div
                key={index}
                className={`mb-4 ${isChar1 ? 'text-left' : 'text-right'}`}
              >
                <div
                  className={`inline-block max-w-[80%] p-4 rounded-lg ${
                    isChar1
                      ? 'bg-pink-100 text-pink-900 rounded-tl-none'
                      : 'bg-blue-100 text-blue-900 rounded-tr-none'
                  }`}
                >
                  <div className="font-bold text-sm mb-1">
                    {message.speaker}
                    {currentSpeaker === message.speaker && (
                      <span className="ml-2 animate-pulse">✨</span>
                    )}
                  </div>
                  <div className="prose prose-sm max-w-none">
                    <Markdown>{message.text}</Markdown>
                  </div>
                </div>
              </div>
            );
          })}

          {isLoading && messages.length === 0 && (
            <div className="text-center text-gray-500 py-20">
              <div className="animate-pulse text-2xl mb-2">🎭</div>
              <div>Initializing conversation...</div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}
