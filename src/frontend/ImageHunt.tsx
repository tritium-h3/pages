import { useEffect, useRef, useState } from 'react';
import { apiUrl } from './backendApi';
import './ImageHunt.css';

interface Match {
  id: string;
  thumbUrl: string;
  pageUrl: string;
  title: string;
  reason: string;
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
  const esRef = useRef<EventSource | null>(null);

  // Load vision-capable models for the dropdown (once, on mount).
  useEffect(() => {
    fetch(apiUrl('/image-hunt/models'))
      .then((r) => r.json())
      .then((data: { models: string[]; default?: string }) => {
        setModels(data.models);
        setModel((prev) =>
          prev || (data.default && data.models.includes(data.default) ? data.default : data.models[0] ?? '')
        );
      })
      .catch(() => { /* leave empty; Start stays disabled until a model loads */ });
  }, []);

  const stop = () => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
  };

  const start = () => {
    const desc = description.trim();
    if (!desc) return;
    setMatches([]);
    setAttempts(0);
    setCurrentTitle('');
    setError(null);
    setRunning(true);

    const es = new EventSource(
      apiUrl(`/image-hunt?description=${encodeURIComponent(desc)}&model=${encodeURIComponent(model)}`)
    );
    esRef.current = es;

    es.addEventListener('checking', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setAttempts(data.attempts);
      setCurrentTitle(data.title);
    });
    es.addEventListener('match', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Match;
      setMatches((prev) => [data, ...prev]);
    });
    // Named server 'error' events carry a payload; native connection errors do not.
    es.addEventListener('error', (e) => {
      const msg = (e as MessageEvent).data;
      if (msg) {
        try { setError(JSON.parse(msg).message); } catch { /* ignore */ }
        stop(); // terminal server error: don't let EventSource auto-reconnect
      }
    });
  };

  // Close the stream when leaving the page (covers "browse away").
  useEffect(() => () => { esRef.current?.close(); }, []);

  return (
    <div className="image-hunt">
      <h1>Image Hunt</h1>

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
            Start
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
          </a>
        ))}
      </div>
    </div>
  );
}
