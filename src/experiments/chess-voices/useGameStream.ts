import { useState, useRef, useCallback } from 'react';
import { apiUrl } from '../../platform/backendApi.js';
import type { ChessVoicesEvent, GameInfo, Thought } from './types.js';

export interface GameStream {
  game: GameInfo | null;
  /** thoughts by ply; an entry's array is replaced, never mutated */
  thoughts: Map<number, Thought[]>;
  /** highest ply whose thoughts are all in */
  readyPly: number;
  result: string | null;
  error: string | null;
  start: () => void;
  stop: () => void;
  reportProgress: (ply: number) => void;
}

/** One game's event stream. `start` supersedes any game already streaming. */
export function useGameStream(): GameStream {
  const [game, setGame] = useState<GameInfo | null>(null);
  const [thoughts, setThoughts] = useState<Map<number, Thought[]>>(() => new Map());
  const [readyPly, setReadyPly] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const session = useRef<string | null>(null);

  const stop = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  const start = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const isCurrent = () => inFlight.current === controller;

    session.current = null;
    setGame(null);
    setThoughts(new Map());
    setReadyPly(0);
    setResult(null);
    setError(null);

    let finished = false;
    const handle = (e: ChessVoicesEvent) => {
      switch (e.type) {
        case 'game': {
          const { type: _type, ...info } = e;
          session.current = info.session;
          setGame(info);
          break;
        }
        case 'thought': {
          const { type: _type, ...t } = e;
          setThoughts(prev => new Map(prev).set(t.ply, [...(prev.get(t.ply) ?? []), t]));
          break;
        }
        case 'ply-ready':
          setReadyPly(e.ply);
          break;
        case 'done':
          finished = true;
          setResult(e.result);
          break;
        case 'error':
          finished = true;
          setError(e.message);
          break;
      }
    };

    void (async () => {
      try {
        const res = await fetch(apiUrl('chess-voices', '/game'), { signal: controller.signal });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Couldn't start a game (${res.status})`);
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ') || !isCurrent()) continue;
            try {
              handle(JSON.parse(line.slice(6)) as ChessVoicesEvent);
            } catch {
              console.warn('Skipping unparseable SSE line:', line);
            }
          }
        }
        if (isCurrent() && !finished) setError('Lost the connection to the game.');
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    })();
  }, []);

  const reportProgress = useCallback((ply: number) => {
    if (!session.current) return;
    void fetch(apiUrl('chess-voices', '/progress'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: session.current, ply }),
    }).catch(() => {});
  }, []);

  return { game, thoughts, readyPly, result, error, start, stop, reportProgress };
}
