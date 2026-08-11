import { useState, useEffect, useRef, useCallback } from 'react';
import Markdown from 'react-markdown';
import { apiUrl, wsUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../platform/manifest.js';
import type { Character, LLMDuoChatServerMessage } from './types.js';
import styles from './llm-duo-chat.module.css';

interface Message {
  speaker: string;
  text: string;
}

export default function LLMDuoChatPage(_props: ExperimentPageProps) {
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
      // Create WebSocket connection (same-origin, via the Vite /ws proxy)
      const ws = new WebSocket(wsUrl('/ws/llm-duo-chat'));
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected, sending start message');
        setError(null); // Clear any previous errors
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'start' }));
        }
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data) as LLMDuoChatServerMessage;
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
        const response = await fetch(apiUrl('llm-duo-chat', '/status'));
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
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <h1 className={styles.title}>
          🎭 LLM Duo Chat Theatre 🎭
        </h1>
        <p className={styles.subtitle}>
          Watch two AI characters improvise a conversation!
        </p>

        {activeConversations > 1 && (
          <div className={styles.warningBanner}>
            ⚠️ Warning: {activeConversations} conversations running simultaneously! This may slow down responses.
          </div>
        )}

        {activeConversations === 1 && isLoading && (
          <div className={styles.statusBanner}>
            💬 1 active conversation
          </div>
        )}

        {character1 && character2 && (
          <div className={styles.characterGrid}>
            <div className={`${styles.characterCard} ${styles.characterA}`}>
              <h3 className={styles.characterName}>{character1.name}</h3>
              <p className={styles.characterPersonality}>{character1.personality}</p>
            </div>
            <div className={`${styles.characterCard} ${styles.characterB}`}>
              <h3 className={styles.characterName}>{character2.name}</h3>
              <p className={styles.characterPersonality}>{character2.personality}</p>
            </div>
          </div>
        )}

        {situation && (
          <div className={styles.situation}>
            <h3 className={styles.situationTitle}>💫 The Situation:</h3>
            <p className={styles.situationText}>{situation}</p>
          </div>
        )}

        <div className={styles.controls}>
          <button
            onClick={() => startNewConversation(true)}
            disabled={isLoading}
            className={styles.startButton}
          >
            {isLoading ? '🎬 Chat in Progress...' : '🎲 New Random Chat'}
          </button>
        </div>

        {error && (
          <div className={styles.errorBanner}>
            ❌ {error}
          </div>
        )}
      </div>

      <div className={styles.transcript}>
        {messages.length === 0 && !isLoading && (
          <div className={styles.emptyState}>
            Click "New Random Chat" to start a conversation!
          </div>
        )}

        {messages.map((message, index) => {
          const isChar1 = message.speaker === character1?.name;
          return (
            <div
              key={index}
              className={`${styles.turn} ${isChar1 ? styles.turnA : styles.turnB}`}
            >
              <div className={styles.speaker}>
                {message.speaker}
                {currentSpeaker === message.speaker && (
                  <span className={styles.typingIndicator}>✨</span>
                )}
              </div>
              <div className={styles.body}>
                <Markdown>{message.text}</Markdown>
              </div>
            </div>
          );
        })}

        {isLoading && messages.length === 0 && (
          <div className={styles.loadingState}>
            <div className={styles.loadingIcon}>🎭</div>
            <div>Initializing conversation...</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
