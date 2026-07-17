import { useEffect, useRef, useState } from 'react';
import { apiUrl } from './backendApi';
import './ImageHunt.css';

interface Match {
  id: string;
  thumbUrl: string;
  pageUrl: string;
  title: string;
  reason: string;
  description: string;
  model: string;
}

interface SessionSummary {
  id: string;
  label: string;
  attempts: number;
  matchCount: number;
  createdAt: string;
  updatedAt: string;
}

interface FullSession extends SessionSummary {
  matches: Match[];
}

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ImageHunt() {
  const [description, setDescription] = useState('');
  const [running, setRunning] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [currentTitle, setCurrentTitle] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const esRef = useRef<EventSource | null>(null);
  const cancelRenameRef = useRef(false);

  const loadSessions = () => {
    fetch(apiUrl('/image-hunt/sessions'))
      .then((r) => r.json())
      .then((data: { sessions: SessionSummary[] }) => setSessions(data.sessions ?? []))
      .catch(() => { /* leave list as-is */ });
  };

  // Load vision models + session list on mount.
  useEffect(() => {
    fetch(apiUrl('/image-hunt/models'))
      .then((r) => r.json())
      .then((data: { models: string[]; default?: string }) => {
        setModels(data.models);
        const def = data.default && data.models.includes(data.default) ? data.default : data.models[0] ?? '';
        setDefaultModel(def);
        setModel((prev) => prev || def);
      })
      .catch(() => { /* Start stays disabled until a model loads */ });
    loadSessions();
  }, []);

  const stop = () => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
    loadSessions(); // refresh counts/order after a run ends
  };

  // Clear everything back to a fresh hunt: default fields, empty gallery.
  const newHunt = () => {
    if (running) stop();
    setActiveSessionId(null);
    setMatches([]);
    setAttempts(0);
    setCurrentTitle('');
    setError(null);
    setDescription('');
    setModel(defaultModel);
  };

  // Load a saved session: gallery from storage, fields pre-filled from its last run.
  const selectSession = (id: string) => {
    if (running) stop();
    setError(null);
    fetch(apiUrl(`/image-hunt/sessions/${id}`))
      .then((r) => { if (!r.ok) throw new Error('load failed'); return r.json(); })
      .then((s: FullSession) => {
        setActiveSessionId(s.id);
        setAttempts(s.attempts);
        setCurrentTitle('');
        const newestFirst = [...s.matches].reverse();
        setMatches(newestFirst);
        const last = s.matches[s.matches.length - 1];
        setDescription(last?.description ?? '');
        setModel(last && models.includes(last.model) ? last.model : defaultModel);
      })
      .catch(() => setError('Could not load that session.'));
  };

  const removeSession = (id: string) => {
    if (id === activeSessionId && running) stop();
    fetch(apiUrl(`/image-hunt/sessions/${id}`), { method: 'DELETE' })
      .then(() => {
        if (id === activeSessionId) newHunt();
        loadSessions();
      })
      .catch(() => setError('Could not delete that session.'));
  };

  const submitRename = (id: string) => {
    const label = editLabel.trim();
    setEditingId(null);
    if (!label) return;
    fetch(apiUrl(`/image-hunt/sessions/${id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    })
      .then(() => loadSessions())
      .catch(() => setError('Could not rename that session.'));
  };

  const start = () => {
    const desc = description.trim();
    if (!desc) return;
    // Continuing an active session keeps its already-loaded gallery and lets the
    // cumulative attempt counter climb; a fresh hunt clears the view first.
    const continuing = activeSessionId !== null;
    if (!continuing) {
      setMatches([]);
      setAttempts(0);
    }
    setCurrentTitle('');
    setError(null);
    setRunning(true);

    const params = new URLSearchParams({ description: desc, model });
    if (continuing) params.set('sessionId', activeSessionId as string);

    const es = new EventSource(apiUrl(`/image-hunt?${params.toString()}`));
    esRef.current = es;

    es.addEventListener('session', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { id: string; label: string };
      setActiveSessionId(data.id);
      loadSessions();
    });
    es.addEventListener('checking', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setAttempts(data.attempts);
      setCurrentTitle(data.title);
    });
    es.addEventListener('match', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Match;
      setMatches((prev) => [data, ...prev]);
    });
    es.addEventListener('error', (e) => {
      const msg = (e as MessageEvent).data;
      if (msg) {
        try { setError(JSON.parse(msg).message); } catch { /* ignore */ }
        stop();
      }
    });
  };

  useEffect(() => () => { esRef.current?.close(); }, []);

  return (
    <div className="image-hunt">
      <aside className={`image-hunt__sidebar${sidebarOpen ? '' : ' is-collapsed'}`}>
        <div className="image-hunt__sidebar-header">
          <span>Hunts</span>
          <button
            className="image-hunt__collapse"
            onClick={() => setSidebarOpen(false)}
            title="Collapse sidebar"
          >«</button>
        </div>
        <button className="image-hunt__newbtn" onClick={newHunt}>+ New hunt</button>
          <ul className="image-hunt__sessions">
            {sessions.length === 0 && <li className="image-hunt__empty">No saved hunts yet</li>}
            {sessions.map((s) => (
              <li
                key={s.id}
                className={`image-hunt__session${s.id === activeSessionId ? ' is-active' : ''}`}
              >
                {editingId === s.id ? (
                  <input
                    className="image-hunt__rename"
                    autoFocus
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onBlur={() => { if (cancelRenameRef.current) { cancelRenameRef.current = false; return; } submitRename(s.id); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename(s.id);
                      if (e.key === 'Escape') { cancelRenameRef.current = true; setEditingId(null); }
                    }}
                  />
                ) : (
                  <button className="image-hunt__session-main" onClick={() => selectSession(s.id)}>
                    <span className="image-hunt__session-label">{s.label}</span>
                    <span className="image-hunt__session-meta">
                      {s.matchCount} match{s.matchCount === 1 ? '' : 'es'} · {relativeDate(s.updatedAt)}
                    </span>
                  </button>
                )}
                <div className="image-hunt__session-actions">
                  <button
                    title="Rename"
                    onClick={() => { setEditingId(s.id); setEditLabel(s.label); }}
                  >✎</button>
                  <button title="Delete" onClick={() => removeSession(s.id)}>🗑</button>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        {!sidebarOpen && (
          <button
            className="image-hunt__opener"
            onClick={() => setSidebarOpen(true)}
            title="Show sidebar"
          >☰ Hunts</button>
        )}

        <h1>Image Hunt</h1>

        <div className="image-hunt__main">
          <div className="image-hunt__controls">
            <input
              type="text"
              className="image-hunt__input"
              placeholder="Describe what to look for (e.g. happy person)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={running}
              onKeyDown={(e) => { if (e.key === 'Enter' && !running && model) start(); }}
            />
            <select
              className="image-hunt__select"
              value={model}
              disabled={running || models.length === 0}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.length === 0 && <option value="">loading models…</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {running ? (
              <button className="image-hunt__btn" onClick={stop}>Stop</button>
            ) : (
              <button className="image-hunt__btn" onClick={start} disabled={!description.trim() || !model}>
                {activeSessionId ? 'Continue' : 'Start'}
              </button>
            )}
          </div>

          <div className="image-hunt__meter">
            Checked: {attempts} · Matches: {matches.length}
            {model && <span> · model: {model}</span>}
            {running && <span className="image-hunt__checking"> · checking… {currentTitle}</span>}
          </div>

          {error && <div className="image-hunt__error">{error}</div>}

          <div className="image-hunt__gallery">
            {matches.map((m) => (
              <a
                key={m.id}
                href={m.pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="image-hunt__tile"
                title={m.reason}
              >
                <img src={m.thumbUrl} alt={m.title} loading="lazy" />
                <span className="image-hunt__reason">{m.reason}</span>
                <span className="image-hunt__tag">
                  {m.model}
                  {m.description.trim() !== description.trim() && ` · “${m.description}”`}
                </span>
              </a>
            ))}
          </div>
        </div>
    </div>
  );
}
