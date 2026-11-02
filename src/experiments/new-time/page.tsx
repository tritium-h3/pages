import { useEffect, useRef, type RefObject } from 'react';
import styles from './new-time.module.css';
import type { ExperimentPageProps } from '../../platform/manifest.js';

const COLOR_KEYS = ['enamel', 'enamel-2', 'panel', 'steel', 'muted', 'brass', 'brass-hi', 'oxblood', 'f-display'] as const;
type Colors = Record<(typeof COLOR_KEYS)[number], string>;

type HandKind = 'needle' | 'frame' | 'hour';

interface DialTime {
  /** fraction of the day, drives the hour hand */
  day: number;
  dimeF: number;
  minF: number;
  secF: number;
}

// Position on dial: f in [0,1), 0 at bottom, turning commonwise (counterclockwise on screen).
function pt(f: number, r: number): [number, number] {
  const t = f * Math.PI * 2;
  return [r * Math.sin(t), r * Math.cos(t)];
}

// Pointed cartouche outline centred at radius c along the hand.
function cartouche(ctx: CanvasRenderingContext2D, c: number, hw: number, hh: number) {
  ctx.beginPath();
  ctx.moveTo(0, c - hh);
  ctx.quadraticCurveTo(hw * 1.45, c - hh * 0.55, hw * 1.1, c);
  ctx.quadraticCurveTo(hw * 1.45, c + hh * 0.55, 0, c + hh);
  ctx.quadraticCurveTo(-hw * 1.45, c + hh * 0.55, -hw * 1.1, c);
  ctx.quadraticCurveTo(-hw * 1.45, c - hh * 0.55, 0, c - hh);
  ctx.closePath();
}

// A hand. For framed hands, the finial is an outline that surrounds the numeral at numR
// (box = numeral font size), so the number stays readable; the shaft stops at the frame.
function drawHand(
  ctx: CanvasRenderingContext2D,
  f: number, len: number, w: number, color: string,
  kind: HandKind, numR = 0, box = 0,
) {
  ctx.save();
  ctx.rotate(-f * Math.PI * 2);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (kind === 'needle') {
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, len); ctx.stroke();
    const c = len * 0.93, s = w * 2.6 + 1.5;
    ctx.beginPath();
    ctx.moveTo(0, c - s * 1.4); ctx.lineTo(s, c); ctx.lineTo(0, c + s * 1.4); ctx.lineTo(-s, c);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    return;
  }
  const hw = box * 0.55, hh = box * 0.72;
  const inner = numR - hh, outer = numR + hh;
  // shaft up to the frame (with a counterweight tail on the hour hand)
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(0, kind === 'hour' ? -len * 0.16 : 0); ctx.lineTo(0, inner); ctx.stroke();
  if (kind === 'hour') {
    ctx.beginPath(); ctx.arc(0, -len * 0.16, w * 1.3 + 1.5, 0, Math.PI * 2); ctx.fill();
  }
  // the frame
  ctx.lineWidth = Math.max(1.4, w * (kind === 'hour' ? 0.55 : 0.8));
  cartouche(ctx, numR, hw, hh);
  ctx.stroke();
  // small curls flanking the frame's waist
  ctx.lineWidth = Math.max(1, w * 0.45);
  const cr = hw * 0.28;
  ctx.beginPath(); ctx.arc(hw * 1.1 + cr, numR, cr, Math.PI * 0.6, Math.PI * 1.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(-hw * 1.1 - cr, numR, cr, -Math.PI * 0.9, Math.PI * 0.4); ctx.stroke();
  // tip beyond the frame, out to the scale's ticks
  ctx.lineWidth = Math.max(1, w * 0.6);
  ctx.beginPath(); ctx.moveTo(0, outer); ctx.lineTo(0, len); ctx.stroke();
  const s = Math.max(2, w * 0.9);
  ctx.beginPath(); ctx.moveTo(0, len + s * 0.6); ctx.lineTo(s, len - s); ctx.lineTo(-s, len - s); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function sun(ctx: CanvasRenderingContext2D, colors: Colors, x: number, y: number, r: number) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = colors.brass; ctx.strokeStyle = colors.brass;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.25);
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 1.4, Math.sin(a) * r * 1.4);
    ctx.lineTo(Math.cos(a) * r * 2, Math.sin(a) * r * 2); ctx.stroke();
  }
  ctx.restore();
}

function moon(ctx: CanvasRenderingContext2D, colors: Colors, x: number, y: number, r: number) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = colors.brass;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(r * 0.5, -r * 0.25, r * 0.85, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function disc(ctx: CanvasRenderingContext2D, colors: Colors, r: number, fill: string) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = r * 0.06; ctx.shadowOffsetY = r * 0.015;
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = colors.brass; ctx.lineWidth = 1.25;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
}

// Ten-mark scale on a disc's outer band: ticks at the rim, numerals just inside.
function scale10(ctx: CanvasRenderingContext2D, colors: Colors, rim: number, numR: number, fontPx: number) {
  ctx.strokeStyle = colors.steel;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 10; i++) {
    const [x1, y1] = pt(i / 10, rim * 0.985);
    const [x2, y2] = pt(i / 10, rim * 0.93);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.fillStyle = colors.steel;
  ctx.font = `${Math.round(fontPx)}px ${colors['f-display'] || 'serif'}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 10; i++) {
    const [x, y] = pt(i / 10, numR);
    ctx.fillText(String(i), x, y + fontPx * 0.05);
  }
}

function drawDial(ctx: CanvasRenderingContext2D, colors: Colors, size: number, dpr: number, t: DialTime) {
  const R = size / 2 * 0.96;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);

  // Layer radii: each disc hides the shaft of the hand beneath it, leaving only its finial.
  const rA = R * 0.83, rB = R * 0.67, rC = R * 0.51;

  // Base plate: brass bezel, enamel, 100-second ring with moments marked
  ctx.fillStyle = colors.brass;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = colors.enamel;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.965, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = colors.steel;
  for (let i = 0; i < 100; i++) {
    const major = i % 10 === 0, mid = i % 5 === 0;
    const [x1, y1] = pt(i / 100, R * 0.945);
    const [x2, y2] = pt(i / 100, R * (major ? 0.87 : mid ? 0.895 : 0.915));
    ctx.lineWidth = major ? 2 : 1;
    ctx.globalAlpha = major ? 1 : 0.55;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Second hand, then the disc that covers it
  drawHand(ctx, t.secF, R * 0.95, R * 0.007, colors.brass, 'needle');
  disc(ctx, colors, rA, colors['enamel-2']);
  scale10(ctx, colors, rA, R * 0.74, R * 0.065);

  // Minute hand, then its covering disc
  drawHand(ctx, t.minF, R * 0.815, R * 0.012, colors.oxblood, 'frame', R * 0.74, R * 0.065);
  disc(ctx, colors, rB, colors.panel);
  scale10(ctx, colors, rB, R * 0.585, R * 0.065);

  // Dime hand, then the hour disc
  drawHand(ctx, t.dimeF, R * 0.655, R * 0.014, colors.steel, 'frame', R * 0.585, R * 0.065);
  disc(ctx, colors, rC, colors.enamel);
  scale10(ctx, colors, rC, R * 0.4, R * 0.12);

  sun(ctx, colors, 0, -R * 0.2, R * 0.03);
  moon(ctx, colors, 0, R * 0.2, R * 0.038);

  // Hour hand on top, fully visible
  drawHand(ctx, t.day, R * 0.5, R * 0.026, colors.steel, 'hour', R * 0.4, R * 0.12);

  ctx.fillStyle = colors.brass;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.045, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = colors['brass-hi'];
  ctx.beginPath(); ctx.arc(0, 0, R * 0.02, 0, Math.PI * 2); ctx.fill();
}

// One extra cell at the end repeats the first, so the roll from 9 back to 0 is seamless.
function stripCells(n: number, pad: boolean): string[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const v = i % n;
    return pad ? String(v).padStart(2, '0') : String(v);
  });
}

const TEN = stripCells(10, false);
const HUNDRED = stripCells(100, true);

function setDrum(strip: HTMLDivElement, pos: number) {
  const first = strip.firstElementChild as HTMLElement | null;
  const parent = strip.parentElement;
  if (!first || !parent) return;
  const h = first.offsetHeight;
  strip.style.transform = `translateY(${parent.clientHeight / 2 - (pos + 0.5) * h}px)`;
}

export default function NewTimePage(_props: ExperimentPageProps) {
  const appRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hRef = useRef<HTMLDivElement>(null);
  const dRef = useRef<HTMLDivElement>(null);
  const mRef = useRef<HTMLDivElement>(null);
  const sRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const app = appRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!app || !canvas || !ctx) return;

    // The palette lives on .app, so read it there rather than on :root.
    let colors = {} as Colors;
    const readColors = () => {
      const cs = getComputedStyle(app);
      colors = Object.fromEntries(COLOR_KEYS.map(k => [k, cs.getPropertyValue('--' + k).trim()])) as Colors;
    };
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', readColors);

    let size = 0, dpr = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      size = r.width;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.width * dpr);
    };
    window.addEventListener('resize', resize);

    let raf = 0;
    let lastLabel = '';
    const frame = () => {
      const now = new Date();
      const secs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
      const day = secs / 86400;                // fraction of the day
      const hF = day * 10;                     // hours 0–10
      const dF = (day * 100) % 10;             // dimes 0–10
      const mF = (day * 1000) % 10;            // minutes 0–10
      const sF = (day * 100000) % 100;         // seconds 0–100

      drawDial(ctx, colors, size, dpr, { day, dimeF: hF % 1, minF: dF % 1, secF: mF % 1 });

      // Directly geared drums: every drum turns continuously, 10:1 down the train (100:1 for seconds)
      if (sRef.current) setDrum(sRef.current, sF);
      if (mRef.current) setDrum(mRef.current, mF);
      if (dRef.current) setDrum(dRef.current, dF);
      if (hRef.current) setDrum(hRef.current, hF);

      const label = `Clock reading ${Math.floor(hF)}:${Math.floor(dF)}:${Math.floor(mF)}:${String(Math.floor(sF)).padStart(2, '0')}`;
      if (label !== lastLabel) {
        canvas.setAttribute('aria-label', label);
        lastLabel = label;
      }

      raf = requestAnimationFrame(frame);
    };

    let cancelled = false;
    // Wait for fonts so the canvas numerals don't paint in a fallback face.
    document.fonts.ready.then(() => {
      if (cancelled) return;
      resize();
      readColors();
      raf = requestAnimationFrame(frame);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      scheme.removeEventListener('change', readColors);
    };
  }, []);

  return (
    <div ref={appRef} className={styles.app}>
      <main className={styles.main}>
        <div className={styles.dialWrap}>
          <canvas ref={canvasRef} aria-label="Clock dial showing the current local time" />
        </div>

        <div className={styles.drumStage} aria-hidden="true">
          <div className={styles.housing}>
            <div className={styles.drums}>
              <Drum stripRef={hRef} cells={TEN} />
              <span className={styles.sep}>:</span>
              <Drum stripRef={dRef} cells={TEN} />
              <span className={styles.sep}>:</span>
              <Drum stripRef={mRef} cells={TEN} />
              <span className={styles.sep}>:</span>
              <Drum stripRef={sRef} cells={HUNDRED} wide />
            </div>
            <div className={styles.labels}>
              <span>Hour</span><i /><span>Dime</span><i /><span>Min</span><i /><span className={styles.w}>Sec</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Drum({ stripRef, cells, wide }: {
  stripRef: RefObject<HTMLDivElement | null>;
  cells: string[];
  wide?: boolean;
}) {
  return (
    <div className={wide ? `${styles.drum} ${styles.wide}` : styles.drum}>
      <span className={styles.index} />
      <div ref={stripRef} className={styles.strip}>
        {cells.map((c, i) => <div key={i}>{c}</div>)}
      </div>
    </div>
  );
}
