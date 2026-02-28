import { useState, useEffect, useRef } from 'react';
import {
  loadSpriteManifest,
  loadSpriteGroups,
  SpriteManifest,
  SpriteGroup,
  SpriteGroupsFile,
} from './sprites';
import { apiUrl } from './backendApi';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TILE_SIZE = 16;
const DEFAULT_ZOOM = 2;
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

/** Human-readable tab labels for known sheet names */
const SHEET_LABELS: Record<string, string> = {
  'colony-db32-other-ready': 'Other',
  'colony-db32-grounds-ready': 'Grounds',
  'colony-db32-buildings-ready': 'Buildings',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DragSelection = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

function selectionToGroup(
  sel: DragSelection,
  sheetName: string,
  name: string,
): SpriteGroup {
  const minRow = Math.min(sel.startRow, sel.endRow);
  const maxRow = Math.max(sel.startRow, sel.endRow);
  const minCol = Math.min(sel.startCol, sel.endCol);
  const maxCol = Math.max(sel.startCol, sel.endCol);
  return {
    name,
    sheet: sheetName,
    startRow: minRow,
    startCol: minCol,
    widthTiles: maxCol - minCol + 1,
    heightTiles: maxRow - minRow + 1,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SpriteEditor() {
  const [manifest, setManifest] = useState<SpriteManifest | null>(null);
  const [groups, setGroups] = useState<SpriteGroup[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [dragSel, setDragSel] = useState<DragSelection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [namingMode, setNamingMode] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped after tile images finish loading for the active sheet, triggering a redraw
  const [tilesLoaded, setTilesLoaded] = useState(0);

  const baseTilesCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  // Cache of loaded HTMLImageElements keyed by tile URL — persists across sheet switches
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());

  const activeSheet = manifest ? manifest.sheets[activeSheetIndex] : null;
  const tileRenderSize = TILE_SIZE * zoom;
  const canvasWidth = activeSheet ? activeSheet.columns * tileRenderSize : 0;
  const canvasHeight = activeSheet ? activeSheet.rows * tileRenderSize : 0;

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  useEffect(() => {
    Promise.all([
      loadSpriteManifest(),
      loadSpriteGroups().catch((): SpriteGroupsFile => ({ groups: [] })),
    ])
      .then(([m, g]) => {
        setManifest(m);
        setGroups(g.groups);
      })
      .catch((err) => setLoadError(String(err)));
  }, []);

  // Load tile images whenever the active sheet changes, redrawing via rAF
  // so concurrent loads are coalesced into single frames automatically.
  useEffect(() => {
    if (!activeSheet) return;
    let cancelled = false;

    // Redraw whatever is already in the cache immediately (fast on repeat visits).
    setTilesLoaded((n) => n + 1);

    const toLoad = activeSheet.sprites
      .map((s) => s.url)
      .filter((url) => !imageCache.current.has(url));

    if (toLoad.length === 0) return;

    // Debounce redraws: schedule at most one setState per animation frame.
    let rafId: number | null = null;
    const scheduleRedraw = () => {
      if (cancelled || rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!cancelled) setTilesLoaded((n) => n + 1);
      });
    };

    for (const url of toLoad) {
      const img = new Image();
      img.onload = () => {
        imageCache.current.set(url, img);
        scheduleRedraw();
      };
      img.onerror = () => scheduleRedraw();
      img.src = url;
    }

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [activeSheet]);

  // ---------------------------------------------------------------------------
  // Global keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't steal keys while the user is typing in the name input
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      switch (e.key) {
        case 'Escape':
          cancelNaming();
          break;
        case 'Enter':
          if (!inInput && namingMode) {
            e.preventDefault();
            confirmGroup();
          }
          break;
        case '+':
        case '=': // = is the unshifted + key on most keyboards
          if (!inInput) {
            e.preventDefault();
            setZoom((z) => Math.min(MAX_ZOOM, z + 1));
          }
          break;
        case '-':
          if (!inInput) {
            e.preventDefault();
            setZoom((z) => Math.max(MIN_ZOOM, z - 1));
          }
          break;
        case '1':
        case '2':
        case '3':
          if (!inInput && manifest) {
            const idx = Number(e.key) - 1;
            if (idx < manifest.sheets.length) setActiveSheetIndex(idx);
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namingMode, nameInput, manifest]);

  // ---------------------------------------------------------------------------
  // Canvas: base tiles (redrawn after images load or zoom changes)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = baseTilesCanvasRef.current;
    if (!canvas || !activeSheet) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const sprite of activeSheet.sprites) {
      const img = imageCache.current.get(sprite.url);
      if (img) {
        ctx.drawImage(
          img,
          sprite.column * tileRenderSize,
          sprite.row * tileRenderSize,
          tileRenderSize,
          tileRenderSize,
        );
      }
    }
  }, [tilesLoaded, activeSheet, tileRenderSize]);

  // ---------------------------------------------------------------------------
  // Canvas: overlay (redrawn on group changes, drag, zoom)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !activeSheet) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw saved groups for the active sheet
    for (const group of groups) {
      if (group.sheet !== activeSheet.name) continue;
      const x = group.startCol * tileRenderSize;
      const y = group.startRow * tileRenderSize;
      const w = group.widthTiles * tileRenderSize;
      const h = group.heightTiles * tileRenderSize;

      ctx.fillStyle = 'rgba(80, 150, 255, 0.2)';
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = 'rgba(80, 180, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      const fontSize = Math.max(10, Math.min(14, tileRenderSize * 0.7));
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.fillStyle = 'rgba(200, 230, 255, 0.95)';
      ctx.fillText(group.name, x + 3, y + fontSize + 2);
    }

    // Draw the pending drag selection
    if (dragSel) {
      const minRow = Math.min(dragSel.startRow, dragSel.endRow);
      const maxRow = Math.max(dragSel.startRow, dragSel.endRow);
      const minCol = Math.min(dragSel.startCol, dragSel.endCol);
      const maxCol = Math.max(dragSel.startCol, dragSel.endCol);
      const x = minCol * tileRenderSize;
      const y = minRow * tileRenderSize;
      const w = (maxCol - minCol + 1) * tileRenderSize;
      const h = (maxRow - minRow + 1) * tileRenderSize;

      ctx.fillStyle = 'rgba(255, 200, 80, 0.2)';
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = 'rgba(255, 200, 80, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      const wTiles = maxCol - minCol + 1;
      const hTiles = maxRow - minRow + 1;
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = 'rgba(255, 230, 150, 0.95)';
      ctx.fillText(`${wTiles}×${hTiles}`, x + 3, y + 13);
    }
  }, [groups, dragSel, activeSheet, tileRenderSize]);

  // ---------------------------------------------------------------------------
  // Mouse interaction
  // ---------------------------------------------------------------------------

  const getTile = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !activeSheet) return null;
    const rect = canvas.getBoundingClientRect();
    // Scale from CSS pixels to canvas pixels
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const col = Math.floor(((e.clientX - rect.left) * scaleX) / tileRenderSize);
    const row = Math.floor(((e.clientY - rect.top) * scaleY) / tileRenderSize);
    if (col < 0 || row < 0 || col >= activeSheet.columns || row >= activeSheet.rows) return null;
    return { row, col };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (namingMode) return;
    const tile = getTile(e);
    if (!tile) return;
    setIsDragging(true);
    setDragSel({ startRow: tile.row, startCol: tile.col, endRow: tile.row, endCol: tile.col });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const tile = getTile(e);
    if (!tile) return;
    setDragSel((prev) => (prev ? { ...prev, endRow: tile.row, endCol: tile.col } : prev));
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragSel) {
      setNamingMode(true);
      setNameInput('');
    }
  };

  // ---------------------------------------------------------------------------
  // Group management
  // ---------------------------------------------------------------------------

  const confirmGroup = () => {
    if (!dragSel || !activeSheet || !nameInput.trim()) return;
    const newGroup = selectionToGroup(dragSel, activeSheet.name, nameInput.trim().toUpperCase());
    setGroups((prev) => [...prev, newGroup]);
    setNamingMode(false);
    setDragSel(null);
    setNameInput('');
  };

  const cancelNaming = () => {
    setNamingMode(false);
    setDragSel(null);
    setNameInput('');
  };

  const deleteGroup = (index: number) => {
    setGroups((prev) => prev.filter((_, i) => i !== index));
  };

  const saveGroups = async () => {
    try {
      const res = await fetch(apiUrl('/sprite-groups'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(`Saved ${groups.length} group${groups.length !== 1 ? 's' : ''}`);
    } catch (err) {
      showToast(`Save failed: ${err}`);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  if (loadError) {
    return (
      <div style={{ color: '#e94560', padding: 24, fontFamily: 'monospace' }}>
        Error loading: {loadError}
      </div>
    );
  }

  if (!manifest) {
    return (
      <div style={{ color: '#888', padding: 24, fontFamily: 'monospace' }}>
        Loading manifest...
      </div>
    );
  }

  const groupsOnActiveSheet = groups.filter(
    (g) => activeSheet && g.sheet === activeSheet.name,
  );

  return (
    <div style={styles.root}>
      {/* ------------------------------------------------------------------ */}
      {/* Toolbar                                                             */}
      {/* ------------------------------------------------------------------ */}
      <div style={styles.toolbar}>
        <button
          onClick={() => {
            window.history.pushState({}, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          style={{ ...styles.zoomBtn, width: 'auto', padding: '0 10px', fontSize: 13, color: '#aaa' }}
        >
          ← Menu
        </button>
        <strong style={{ fontSize: 15, color: '#e0e0e0', marginRight: 8 }}>
          Sprite Group Editor
        </strong>

        {/* Sheet tabs */}
        {manifest.sheets.map((sheet, i) => (
          <button
            key={sheet.name}
            onClick={() => setActiveSheetIndex(i)}
            style={{
              ...styles.tabBtn,
              background: i === activeSheetIndex ? '#0f3460' : 'transparent',
              color: i === activeSheetIndex ? '#e94560' : '#9aa',
              borderColor: i === activeSheetIndex ? '#e94560' : '#444',
            }}
          >
            {SHEET_LABELS[sheet.name] ?? sheet.name}
            {i === activeSheetIndex && groupsOnActiveSheet.length > 0 && (
              <span style={{ marginLeft: 5, fontSize: 11, color: '#aaa' }}>
                ({groupsOnActiveSheet.length})
              </span>
            )}
          </button>
        ))}

        {/* Zoom controls */}
        <span style={{ marginLeft: 'auto', color: '#666', fontSize: 13 }}>zoom</span>
        <button
          style={styles.zoomBtn}
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 1))}
        >
          −
        </button>
        <span style={{ minWidth: 28, textAlign: 'center', fontSize: 13, color: '#ccc' }}>
          {zoom}×
        </span>
        <button
          style={styles.zoomBtn}
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 1))}
        >
          +
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Main area                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div style={styles.body}>
        {/* Canvas scroll area */}
        <div style={styles.canvasArea}>
          <div style={{ position: 'relative', width: canvasWidth, height: canvasHeight }}>
            {/* Base layer: tile images */}
            <canvas
              ref={baseTilesCanvasRef}
              width={canvasWidth}
              height={canvasHeight}
              style={{ position: 'absolute', top: 0, left: 0, imageRendering: 'pixelated' }}
            />
            {/* Overlay layer: selection + group rectangles */}
            <canvas
              ref={overlayCanvasRef}
              width={canvasWidth}
              height={canvasHeight}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                cursor: namingMode ? 'default' : 'crosshair',
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
          </div>

          {/* Naming dialog — sticky at the bottom of the scroll area */}
          {namingMode && dragSel && (
            <div style={styles.namingDialog}>
              <span style={{ fontSize: 13 }}>Name this group:</span>
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmGroup();
                  if (e.key === 'Escape') cancelNaming();
                }}
                placeholder="e.g. MINE"
                style={styles.nameInput}
              />
              <button
                onClick={confirmGroup}
                disabled={!nameInput.trim()}
                style={{ ...styles.actionBtn, opacity: nameInput.trim() ? 1 : 0.4 }}
              >
                Add
              </button>
              <button
                onClick={cancelNaming}
                style={{ ...styles.actionBtn, background: '#444', marginLeft: 0 }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Sidebar: groups list                                             */}
        {/* ---------------------------------------------------------------- */}
        <div style={styles.sidebar}>
          <div style={styles.sidebarHeader}>
            <strong style={{ fontSize: 14 }}>Groups ({groups.length})</strong>
            <button onClick={saveGroups} style={styles.actionBtn}>
              Save
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {groups.length === 0 && (
              <div style={{ color: '#555', fontSize: 12, padding: '8px 10px' }}>
                No groups yet. Drag on the canvas to define one.
              </div>
            )}
            {groups.map((g, i) => (
              <div key={i} style={styles.groupRow}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 'bold', color: '#e0e0e0' }}>
                  {g.name}
                </span>
                <span style={{ fontSize: 11, color: '#7aa' }}>
                  {SHEET_LABELS[g.sheet] ?? g.sheet}
                </span>
                <span style={{ fontSize: 11, color: '#666', minWidth: 36, textAlign: 'right' }}>
                  {g.widthTiles}×{g.heightTiles}
                </span>
                <button
                  onClick={() => deleteGroup(i)}
                  title="Delete group"
                  style={styles.deleteBtn}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* Active sheet info */}
          {activeSheet && (
            <div style={styles.sheetInfo}>
              <div style={{ color: '#666', fontSize: 11 }}>
                {SHEET_LABELS[activeSheet.name] ?? activeSheet.name}
              </div>
              <div style={{ color: '#555', fontSize: 11 }}>
                {activeSheet.columns}c × {activeSheet.rows}r · {activeSheet.sprites.length} tiles
              </div>
            </div>
          )}

          {/* Keyboard shortcuts legend */}
          <div style={styles.shortcuts}>
            {[
              ['Drag', 'Select region'],
              ['Enter', 'Confirm name'],
              ['Esc', 'Cancel selection'],
              ['+  / -', 'Zoom in / out'],
              ['1 / 2 / 3', 'Switch sheet'],
            ].map(([key, label]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <kbd style={styles.kbd}>{key}</kbd>
                <span style={{ color: '#555', fontSize: 10 }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toast notification */}
      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontFamily: 'monospace',
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    background: '#16213e',
    borderBottom: '1px solid #0f3460',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  tabBtn: {
    padding: '4px 12px',
    border: '1px solid #444',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  zoomBtn: {
    background: '#0f3460',
    color: '#ddd',
    border: '1px solid #444',
    borderRadius: 4,
    cursor: 'pointer',
    width: 28,
    height: 28,
    fontFamily: 'monospace',
    fontSize: 16,
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  canvasArea: {
    flex: 1,
    overflow: 'auto',
    padding: 8,
    position: 'relative',
  },
  namingDialog: {
    position: 'sticky',
    bottom: 8,
    display: 'inline-flex',
    gap: 8,
    alignItems: 'center',
    background: '#16213e',
    border: '1px solid #e94560',
    borderRadius: 6,
    padding: '8px 12px',
    marginTop: 8,
    zIndex: 10,
  },
  nameInput: {
    background: '#0f3460',
    color: '#e0e0e0',
    border: '1px solid #555',
    borderRadius: 4,
    padding: '4px 8px',
    fontFamily: 'monospace',
    fontSize: 13,
    width: 140,
  },
  actionBtn: {
    background: '#e94560',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '4px 12px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  sidebar: {
    width: 260,
    background: '#16213e',
    borderLeft: '1px solid #0f3460',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  sidebarHeader: {
    padding: '8px 12px',
    borderBottom: '1px solid #0f3460',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexShrink: 0,
  },
  groupRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px',
    borderBottom: '1px solid #222',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#e94560',
    cursor: 'pointer',
    fontSize: 13,
    padding: '0 2px',
    lineHeight: 1,
  },
  sheetInfo: {
    padding: '6px 10px',
    borderTop: '1px solid #0f3460',
    flexShrink: 0,
  },
  shortcuts: {
    padding: '8px 10px',
    borderTop: '1px solid #0f3460',
    flexShrink: 0,
  },
  kbd: {
    background: '#0f3460',
    color: '#9aa',
    border: '1px solid #333',
    borderRadius: 3,
    padding: '1px 5px',
    fontSize: 10,
    fontFamily: 'monospace',
    minWidth: 60,
    display: 'inline-block',
  },
  toast: {
    position: 'fixed',
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#0f3460',
    border: '1px solid #e94560',
    color: '#e0e0e0',
    padding: '8px 22px',
    borderRadius: 20,
    pointerEvents: 'none',
    zIndex: 999,
    fontSize: 13,
  },
};
