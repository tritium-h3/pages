import { useEffect, useRef, useState } from 'react';
import styles from './transit.module.css';
import { apiUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../platform/manifest.js';
import type { RouteCard, TransitBoardData } from './types.js';

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
  if (mins <= 8) return styles.rcDepImminent; // 3–8 min: blink — leave now window
  if (mins <= 12) return styles.rcDepSoon;
  return '';
}

// ── Route card components ─────────────────────────────────────────────────────

function DirectCard({ card }: { card: RouteCard }) {
  return (
    <div className={`${styles.rcCard} ${styles.rcDirect}`}>
      <div className={styles.rcHeader}>
        <span className={styles.rcBadge} style={{ background: card.lineColor, color: card.lineTextColor }}>
          {card.shortCode}
        </span>
        <div className={styles.rcNames}>
          <span className={styles.rcRouteName}>{card.routeName}</span>
          <span className={styles.rcDirection}>{card.direction}</span>
        </div>
        <div className={styles.rcDeps}>
          {card.directDeps.length === 0
            ? <span className={styles.rcNoService}>NO SERVICE</span>
            : card.directDeps.map((d, i) => (
                <span key={i} className={`${styles.rcDepPill} ${i === 0 ? depClass(d.mins) : (d.mins <= 12 ? styles.rcDepSoon : '')}`}>
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
    <div className={`${styles.rcCard} ${styles.rcConnecting}`}>
      <div className={styles.rcHeader}>
        <span className={styles.rcBadge} style={{ background: card.lineColor, color: card.lineTextColor }}>
          {card.shortCode}
        </span>
        <div className={styles.rcNames}>
          <span className={styles.rcRouteName}>{card.routeName}</span>
          <span className={styles.rcDirection}>{card.direction}</span>
        </div>
        {first && (
          <span className={`${styles.rcBoardClock} ${depClass(first.connectDepartsInMins)}`}>
            {first.isEstimated && '~'}{first.connectDepartsInMins}m
          </span>
        )}
      </div>
      <div className={styles.rcJourneys}>
        {card.journeys.map((j, i) => (
          <div key={i} className={`${styles.rcJourney} ${i > 0 ? styles.rcJourneyAlt : ''} ${j.isEstimated ? styles.rcJourneyEstimated : ''}`}>
            <span className={`${styles.rcSeg} ${styles.rcSegOl}`}>
              OL&nbsp;{j.olDirection === 'N' ? '▲' : '▼'}&nbsp;<strong>{j.olDepartsInMins}m</strong>
            </span>
            <span className={styles.rcArrow}>→</span>
            <span className={`${styles.rcSeg} ${styles.rcSegTransfer}`}>{j.transferStop}</span>
            {j.waitMins > 0 && (
              <>
                <span className={styles.rcArrow}>→</span>
                <span className={`${styles.rcSeg} ${styles.rcSegWait}`}>wait&nbsp;{j.isEstimated ? '~' : ''}{j.waitMins}m</span>
              </>
            )}
            <span className={styles.rcArrow}>→</span>
            <span className={`${styles.rcSeg} ${styles.rcSegBoard}`}>board&nbsp;<strong>{j.isEstimated ? '~' : ''}{j.connectDepartsInMins}m</strong></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TransitPage(_props: ExperimentPageProps) {
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
        const res = await fetch(apiUrl('transit', '/board'));
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
    <div className={styles.tdOuter}>

      {/* ── Header ── */}
      <header className={styles.tdHeader}>
        <div className={styles.tdHeaderLeft}>
          <span className={styles.tdStationName}>GREEN STREET</span>
          <span className={styles.tdLineLabel}>
            <span className={styles.tdOlDot} />
            ORANGE LINE
          </span>
        </div>
        <div className={styles.tdHeaderRight}>
          <div className={styles.tdClock}>{timeStr}</div>
          <div className={styles.tdDate}>{dateStr}</div>
        </div>
      </header>

      {/* ── Alert Banner ── */}
      {majorAlerts.length > 0 && (
        <div className={styles.tdAlertsBar}>
          {majorAlerts.map(alert => (
            <div key={alert.id} className={styles.tdAlertRow}>
              <span className={styles.tdAlertEffect}>{effectLabel(alert.effect)}</span>
              <span className={styles.tdAlertText}>{alert.header}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Body ── */}
      <main className={styles.tdBody}>
        {noData && (
          <div className={styles.rcGrid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`${styles.rcCard} ${styles.rcSkeleton}`} />
            ))}
          </div>
        )}

        {error && (
          <div className={styles.tdError}>
            <span className={styles.tdErrorTitle}>⚠ COULD NOT LOAD DATA</span>
            <span className={styles.tdErrorMsg}>{error}</span>
          </div>
        )}

        {data && (
          <>
            {/* OL direct cards always at top, full-width 2-up row */}
            <div className={styles.rcOlRow}>
              {data.routes.filter(c => c.isDirect).map(card =>
                <DirectCard key={card.id} card={card} />
              )}
            </div>
            {/* All connecting cards below */}
            <div className={styles.rcGrid}>
              {data.routes.filter(c => !c.isDirect).map(card =>
                <ConnectingCard key={card.id} card={card} />,
              )}
              {data.routes.filter(c => !c.isDirect).length === 0 && (
                <div className={styles.tdError}>
                  <span className={styles.tdErrorTitle}>NO SERVICE DATA</span>
                  <span className={styles.tdErrorMsg}>
                    {majorAlerts[0]?.header ?? 'No predictions available at this time.'}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className={styles.tdFooter}>
        <span className={`${styles.tdUpdate} ${isStale ? styles.tdUpdateStale : styles.tdUpdateOk}`}>
          {isStale ? `⚠ STALE — ${staleSeconds}s` : `● LIVE — ${staleSeconds}s ago`}
        </span>
        <span className={styles.tdAttr}>MBTA V3 API</span>
      </footer>

      {/* Scanline overlay */}
      <div className={styles.tdScanlines} aria-hidden="true" />
    </div>
  );
}

