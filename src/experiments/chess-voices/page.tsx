import { useEffect, useMemo, useState, useCallback, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RefreshCw } from 'lucide-react';
import type { ExperimentPageProps } from '../../platform/manifest.js';
import type { Thought } from './types.js';
import { trackGame } from './track.js';
import { BOARD_ONLY, type Bounds } from './placement.js';
import { waitingSquare } from './playback.js';
import { useGameStream } from './useGameStream.js';
import { Board } from './Board.js';
import { Bubbles, WaitingBubble } from './Bubbles.js';
import styles from './chess-voices.module.css';

/** let the piece finish sliding before the first bubble */
const MOVE_MS = 450;
/** pause after the last bubble before the next move */
const BEAT_MS = 700;
const readingMs = (text: string) => 1500 + 40 * text.length;

/** Side margins (in squares) bubbles may use when the screen is wide enough;
 *  must match the .stageWide sizing in chess-voices.module.css. */
const WIDE_BOUNDS: Bounds = { left: -3.5, top: 0, right: 11.5, bottom: 8 };
const WIDE_QUERY = '(min-width: 760px)';
const NO_THOUGHTS: Thought[] = [];

const RESULTS: Record<string, string> = { '1-0': 'White wins', '0-1': 'Black wins', '1/2-1/2': 'Draw' };

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    cb => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
  );
}

export default function ChessVoicesPage(_props: ExperimentPageProps) {
  const stream = useGameStream();
  const { game, readyPly, reportProgress, start, stop } = stream;
  const track = useMemo(() => (game ? trackGame(game.moves) : null), [game]);
  const total = track?.moves.length ?? 0;
  const wide = useMediaQuery(WIDE_QUERY);

  const [ply, setPly] = useState(0);
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(true);
  const thoughts = stream.thoughts.get(ply) ?? NO_THOUGHTS;

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  useEffect(() => {
    setPly(0);
    setShown(0);
  }, [game]);

  const goTo = useCallback(
    (p: number) => {
      setPly(p);
      setShown(0);
      reportProgress(p);
    },
    [reportProgress],
  );

  // Reveal this ply's bubbles one at a time: the first after the move lands,
  // each next one after the previous has had time to be read.
  useEffect(() => {
    if (shown >= thoughts.length) return;
    const delay = shown === 0 ? MOVE_MS : readingMs(thoughts[shown - 1].text);
    const t = setTimeout(() => setShown(s => s + 1), delay);
    return () => clearTimeout(t);
  }, [shown, thoughts]);

  const revealed = shown >= thoughts.length;
  const nextReady = readyPly >= ply + 1;

  // Advance once everything is read and the next ply has arrived.
  useEffect(() => {
    if (!playing || !track || !revealed || ply >= total || !nextReady) return;
    const last = thoughts.at(-1);
    const t = setTimeout(() => goTo(ply + 1), (last ? readingMs(last.text) : 0) + BEAT_MS);
    return () => clearTimeout(t);
  }, [playing, track, revealed, ply, total, nextReady, thoughts, goTo]);

  const waitingOn = track
    ? waitingSquare(track, ply, { playing, revealed, nextReady, failed: stream.error !== null })
    : undefined;
  const lastMove = track && ply > 0 ? track.moves[ply - 1] : undefined;
  const finished = stream.result !== null && ply === total;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Chess Voices</h1>
        {game ? (
          <p className={styles.players}>
            {game.white} ({game.whiteElo}) vs {game.black} ({game.blackElo})
            {game.opening && <span className={styles.opening}> · {game.opening}</span>}
            {' · '}
            <a href={`https://lichess.org/${game.id}`} target="_blank" rel="noreferrer">
              lichess
            </a>
          </p>
        ) : (
          !stream.error && <p className={styles.players}>Finding a game…</p>
        )}
      </header>

      {stream.error && <div className={styles.errorBanner}>{stream.error}</div>}

      <div className={wide ? styles.stageWide : styles.stage}>
        {track && (
          <Board pieces={track.positions[ply]} lastMove={lastMove}>
            <Bubbles thoughts={thoughts} shown={shown} bounds={wide ? WIDE_BOUNDS : BOARD_ONLY} />
            {waitingOn && <WaitingBubble square={waitingOn} />}
          </Board>
        )}
      </div>

      <div className={styles.controls}>
        <button className={styles.iconButton} onClick={() => goTo(Math.max(0, ply - 1))} disabled={ply === 0} aria-label="Previous move">
          <ChevronLeft />
        </button>
        <button className={styles.iconButton} onClick={() => setPlaying(p => !p)} disabled={!track} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause /> : <Play />}
        </button>
        <button className={styles.iconButton} onClick={() => goTo(ply + 1)} disabled={!nextReady || ply >= total} aria-label="Next move">
          <ChevronRight />
        </button>
        <span className={styles.moveCounter}>
          {track ? `Move ${Math.ceil(ply / 2)} of ${Math.ceil(total / 2)}` : ''}
        </span>
        <button className={styles.newGame} onClick={start}>
          <RefreshCw className={styles.buttonIcon} /> New game
        </button>
      </div>

      {finished && <p className={styles.result}>{RESULTS[stream.result!] ?? stream.result}</p>}

      <p className={styles.credit}>
        Games from the <a href="https://database.lichess.org/" target="_blank" rel="noreferrer">Lichess open database</a> (CC0).
        Pieces by Colin M.L. Burnett (CC BY-SA 3.0).
      </p>
    </div>
  );
}
