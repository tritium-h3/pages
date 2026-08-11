import { useEffect, useRef, useState } from 'react';
import styles from './image-hunt.module.css';
import { apiUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../platform/manifest.js';
import type { HuntSession, SessionMatch, SessionSummary } from './types.js';

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

export default function ImageHuntPage(_props: ExperimentPageProps) {
  const [description, setDescription] = useState('');
  const [running, setRunning] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [currentTitle, setCurrentTitle] = useState('');
  const [matches, setMatches] = useState<SessionMatch[]>([]);
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
    fetch(apiUrl('image-hunt', '/sessions'))
      .then((r) => r.json())
      .then((data: { sessions: SessionSummary[] }) => setSessions(data.sessions ?? []))
      .catch(() => { /* leave list as-is */ });
  };

  // Load vision models + session list on mount.
  useEffect(() => {
    fetch(apiUrl('image-hunt', '/models'))
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
    fetch(apiUrl('image-hunt', `/sessions/${id}`))
      .then((r) => { if (!r.ok) throw new Error('load failed'); return r.json(); })
      .then((s: HuntSession) => {
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
    fetch(apiUrl('image-hunt', `/sessions/${id}`), { method: 'DELETE' })
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
    fetch(apiUrl('image-hunt', `/sessions/${id}`), {
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

    const es = new EventSource(apiUrl('image-hunt', `/?${params.toString()}`));
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
      const data = JSON.parse((e as MessageEvent).data) as SessionMatch;
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
    <div className={styles.imageHunt}>
      <aside className={`${styles.imageHuntSidebar}${sidebarOpen ? '' : ` ${styles.isCollapsed}`}`}>
        <div className={styles.imageHuntSidebarHeader}>
          <span>Hunts</span>
          <button
            className={styles.imageHuntCollapse}
            onClick={() => setSidebarOpen(false)}
            title="Collapse sidebar"
          >«</button>
        </div>
        <button className={styles.imageHuntNewbtn} onClick={newHunt}>+ New hunt</button>
          <ul className={styles.imageHuntSessions}>
            {sessions.length === 0 && <li className={styles.imageHuntEmpty}>No saved hunts yet</li>}
            {sessions.map((s) => (
              <li
                key={s.id}
                className={`${styles.imageHuntSession}${s.id === activeSessionId ? ` ${styles.isActive}` : ''}`}
              >
                {editingId === s.id ? (
                  <input
                    className={styles.imageHuntRename}
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
                  <button className={styles.imageHuntSessionMain} onClick={() => selectSession(s.id)}>
                    <span className={styles.imageHuntSessionLabel}>{s.label}</span>
                    <span className={styles.imageHuntSessionMeta}>
                      {s.matchCount} match{s.matchCount === 1 ? '' : 'es'} · {relativeDate(s.updatedAt)}
                    </span>
                  </button>
                )}
                <div className={styles.imageHuntSessionActions}>
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
            className={styles.imageHuntOpener}
            onClick={() => setSidebarOpen(true)}
            title="Show sidebar"
          >☰ Hunts</button>
        )}

        <h1>Image Hunt</h1>

        <div className={styles.imageHuntMain}>
          <div className={styles.imageHuntControls}>
            <input
              type="text"
              className={styles.imageHuntInput}
              placeholder="Describe what to look for (e.g. happy person)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={running}
              onKeyDown={(e) => { if (e.key === 'Enter' && !running && model) start(); }}
            />
            <select
              className={styles.imageHuntSelect}
              value={model}
              disabled={running || models.length === 0}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.length === 0 && <option value="">loading models…</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {running ? (
              <button className={styles.imageHuntBtn} onClick={stop}>Stop</button>
            ) : (
              <button className={styles.imageHuntBtn} onClick={start} disabled={!description.trim() || !model}>
                {activeSessionId ? 'Continue' : 'Start'}
              </button>
            )}
          </div>

          <div className={styles.imageHuntMeter}>
            Checked: {attempts} · Matches: {matches.length}
            {model && <span> · model: {model}</span>}
            {running && <span className={styles.imageHuntChecking}> · checking… {currentTitle}</span>}
          </div>

          {error && <div className={styles.imageHuntError}>{error}</div>}

          <div className={styles.imageHuntGallery}>
            {matches.map((m) => (
              <a
                key={m.id}
                href={m.pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.imageHuntTile}
                title={m.reason}
              >
                <img src={m.thumbUrl} alt={m.title} loading="lazy" />
                <span className={styles.imageHuntReason}>{m.reason}</span>
                <span className={styles.imageHuntTag}>
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
