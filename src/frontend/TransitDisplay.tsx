import { useEffect, useRef, useState } from 'react';
import './TransitDisplay.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface JourneyOption {
  olDepartsInMins: number;
  olDirection: 'N' | 'S';
  transferStop: string;
  arriveTransferInMins: number;
  waitMins: number;
  connectDepartsInMins: number;
  isEstimated?: boolean;
}

interface RouteCard {
  id: string;
  routeName: string;
  direction: string;
  shortCode: string;
  lineColor: string;
  lineTextColor: string;
  isDirect: boolean;
  directDeps: Array<{ mins: number; headsign: string | null }>;
  journeys: JourneyOption[];
}

interface ServiceAlert {
  id: string;
  effect: string;
  severity: number;
  header: string;
}

interface TransitBoardData {
  routes: RouteCard[];
  alerts: ServiceAlert[];
  timestamp: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EFFECT_LABELS: Record<string, string> = {
  SHUTTLE:          'SHUTTLE BUS',
  SUSPENSION:       'SUSPENDED',
  CANCELLATION:     'CANCELLED',
  DETOUR:           'DETOUR',
  DELAY:            'DELAYS',
  SEVERE_DELAY:     'SEVERE DELAYS',
  STOP_MOVED:       'STOP CHANGE',
  STATION_ISSUE:    'STATION NOTICE',
  ACCESS_ISSUE:     'ACCESS ISSUE',
  MODIFIED_SERVICE: 'MODIFIED SERVICE',
  EXTRA_SERVICE:    'EXTRA SERVICE',
};

function effectLabel(effect: string): string {
  return EFFECT_LABELS[effect] ?? effect.replace(/_/g, ' ');
}

function depClass(mins: number): string {
  if (mins <= 8) return 'rc-dep-imminent'; // 3–8 min: blink — leave now window
  if (mins <= 12) return 'rc-dep-soon';
  return '';
}

// ── Route card components ─────────────────────────────────────────────────────

function DirectCard({ card }: { card: RouteCard }) {
  return (
    <div className="rc-card rc-direct">
      <div className="rc-header">
        <span className="rc-badge" style={{ background: card.lineColor, color: card.lineTextColor }}>
          {card.shortCode}
        </span>
        <div className="rc-names">
          <span className="rc-route-name">{card.routeName}</span>
          <span className="rc-direction">{card.direction}</span>
        </div>
        <div className="rc-deps">
          {card.directDeps.length === 0
            ? <span className="rc-no-service">NO SERVICE</span>
            : card.directDeps.map((d, i) => (
                <span key={i} className={`rc-dep-pill ${depClass(d.mins)}`}>
                  {d.mins}m
                </span>
              ))
          }
        </div>
      </div>
    </div>
  );
}

function ConnectingCard({ card }: { card: RouteCard }) {
  const first = card.journeys[0];
  return (
    <div className="rc-card rc-connecting">
      <div className="rc-header">
        <span className="rc-badge" style={{ background: card.lineColor, color: card.lineTextColor }}>
          {card.shortCode}
        </span>
        <div className="rc-names">
          <span className="rc-route-name">{card.routeName}</span>
          <span className="rc-direction">{card.direction}</span>
        </div>
        {first && (
          <span className={`rc-board-clock ${depClass(first.connectDepartsInMins)}`}>
            {first.isEstimated && '~'}{first.connectDepartsInMins}m
          </span>
        )}
      </div>
      <div className="rc-journeys">
        {card.journeys.map((j, i) => (
          <div key={i} className={`rc-journey ${i > 0 ? 'rc-journey-alt' : ''} ${j.isEstimated ? 'rc-journey-estimated' : ''}`}>
            <span className="rc-seg rc-seg-ol">
              OL&nbsp;{j.olDirection === 'N' ? '▲' : '▼'}&nbsp;<strong>{j.olDepartsInMins}m</strong>
            </span>
            <span className="rc-arrow">→</span>
            <span className="rc-seg rc-seg-transfer">{j.transferStop}</span>
            {j.waitMins > 0 && (
              <>
                <span className="rc-arrow">→</span>
                <span className="rc-seg rc-seg-wait">wait&nbsp;{j.isEstimated ? '~' : ''}{j.waitMins}m</span>
              </>
            )}
            <span className="rc-arrow">→</span>
            <span className="rc-seg rc-seg-board">board&nbsp;<strong>{j.isEstimated ? '~' : ''}{j.connectDepartsInMins}m</strong></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TransitDisplay() {
  const [data, setData]                 = useState<TransitBoardData | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [staleSeconds, setStaleSeconds] = useState(0);
  const [now, setNow]                   = useState(new Date());
  const lastFetchRef                    = useRef<Date | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
      if (lastFetchRef.current) {
        setStaleSeconds(Math.floor((Date.now() - lastFetchRef.current.getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const doFetch = async () => {
      try {
        const res = await fetch('/api/mbta/transit-board');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: TransitBoardData = await res.json();
        setData(json);
        lastFetchRef.current = new Date();
        setStaleSeconds(0);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Fetch error');
      }
    };
    doFetch();
    const interval = setInterval(doFetch, 30_000);
    return () => clearInterval(interval);
  }, []);

  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  const isStale     = staleSeconds > 60;
  const noData      = !data && !error;
  const majorAlerts = data?.alerts.filter(a => a.severity >= 5) ?? [];

  return (
    <div className="td-outer">

      {/* ── Header ── */}
      <header className="td-header">
        <div className="td-header-left">
          <span className="td-station-name">GREEN STREET</span>
          <span className="td-line-label">
            <span className="td-ol-dot" />
            ORANGE LINE
          </span>
        </div>
        <div className="td-header-right">
          <div className="td-clock">{timeStr}</div>
          <div className="td-date">{dateStr}</div>
        </div>
      </header>

      {/* ── Alert Banner ── */}
      {majorAlerts.length > 0 && (
        <div className="td-alerts-bar">
          {majorAlerts.map(alert => (
            <div key={alert.id} className="td-alert-row">
              <span className="td-alert-effect">{effectLabel(alert.effect)}</span>
              <span className="td-alert-text">{alert.header}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Body ── */}
      <main className="td-body">
        {noData && (
          <div className="rc-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rc-card rc-skeleton" />
            ))}
          </div>
        )}

        {error && (
          <div className="td-error">
            <span className="td-error-title">⚠ COULD NOT LOAD DATA</span>
            <span className="td-error-msg">{error}</span>
          </div>
        )}

        {data && (
          <>
            {/* OL direct cards always at top, full-width 2-up row */}
            <div className="rc-ol-row">
              {data.routes.filter(c => c.isDirect).map(card =>
                <DirectCard key={card.id} card={card} />
              )}
            </div>
            {/* All connecting cards below */}
            <div className="rc-grid">
              {data.routes.filter(c => !c.isDirect).map(card =>
                <ConnectingCard key={card.id} card={card} />,
              )}
              {data.routes.filter(c => !c.isDirect).length === 0 && (
                <div className="td-error">
                  <span className="td-error-title">NO SERVICE DATA</span>
                  <span className="td-error-msg">
                    {majorAlerts[0]?.header ?? 'No predictions available at this time.'}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="td-footer">
        <span className={`td-update ${isStale ? 'td-update-stale' : 'td-update-ok'}`}>
          {isStale ? `⚠ STALE — ${staleSeconds}s` : `● LIVE — ${staleSeconds}s ago`}
        </span>
        <span className="td-attr">MBTA V3 API</span>
      </footer>

      {/* Scanline overlay */}
      <div className="td-scanlines" aria-hidden="true" />
    </div>
  );
}

