import { useState, useEffect, useRef } from 'react';
import { loadSpriteManifest, loadSpriteGroups, resolveSpriteGroup } from './sprites';
import './ColonyGame.css';

const GRID_SIZE = 40;
const CELL_SIZE = 20;

const BUILDING_TYPES = {
  WAREHOUSE: { name: 'Warehouse', color: '#778899', produces: 'goods', cost: null, spriteGroup: 'BUILDING_GREY_5' },
  RESIDENCE: { name: 'Residence', color: '#5f9ea0', produces: null,    cost: null, spriteGroup: 'HOUSE_GREY_3' },
};

// Fallback hardcoded layouts used only when a building's sprite group is not
// found in the API data (e.g. before any groups have been saved).
const BUILDING_SPRITE_LAYOUT = {};

// All path sprite group names in the order they appear in sprite-groups.json.
const PATH_TILE_NAMES = [
  'PATH_ES', 'PATH_WS', 'PATH_NE', 'PATH_NW', 'PATH_WE', 'PATH_NS',
  'PATH_NES', 'PATH_WES', 'PATH_NWE', 'PATH_NWES',
  'PATH_S', 'PATH_N', 'PATH_E', 'PATH_W',
];

/**
 * Returns the cells that make up a straight horizontal or vertical line between
 * two grid positions. Picks the dominant axis; ties go to horizontal.
 */
function getStraightLineCells(start, end) {
  if (!start || !end) return [];
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const cells = [];
  if (dx >= dy) {
    // Horizontal
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    for (let x = minX; x <= maxX; x += 1) {
      cells.push({ x, y: start.y });
    }
  } else {
    // Vertical
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    for (let y = minY; y <= maxY; y += 1) {
      cells.push({ x: start.x, y });
    }
  }
  return cells;
}

/**
 * Returns the PATH_* sprite name for a cell given which cardinal neighbors are
 * also path cells. The canonical name order is N W E S.
 */
function getPathTileName(n, w, e, s) {
  const parts = [];
  if (n) parts.push('N');
  if (w) parts.push('W');
  if (e) parts.push('E');
  if (s) parts.push('S');
  return parts.length > 0 ? `PATH_${parts.join('')}` : 'PATH_NWES';
}

function inferFlatGroundUrls(manifest, groundsSheet) {
  const fallback = (groundsSheet?.sprites ?? []).slice(0, 1).map((sprite) => sprite.url);
  if (!groundsSheet?.sprites?.length) {
    return fallback;
  }

  const basicLayer = manifest.tmx?.layers?.find((layer) => layer.name === 'Basic Tile Layer')
    ?? manifest.tmx?.layers?.find((layer) => /(ground|basic tile layer)/i.test(layer.name));
  const groundsTileset = manifest.tmx?.tilesets?.find((tileset) => /grounds/i.test(tileset.name));

  if (!basicLayer || !groundsTileset || !manifest.spriteUrlsByGid) {
    return fallback;
  }

  const width = basicLayer.width || 0;
  const height = basicLayer.height || 0;
  if (width <= 0 || height <= 0) {
    return fallback;
  }

  const cellGids = new Map(basicLayer.cells);
  const statsByGid = {};

  const readGid = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return 0;
    }
    const index = y * width + x;
    return cellGids.get(index) ?? 0;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gid = readGid(x, y);
      if (gid < groundsTileset.firstGid || gid > groundsTileset.lastGid) {
        continue;
      }

      const entry = statsByGid[gid] ?? { count: 0, sameNeighborCount: 0 };
      entry.count += 1;
      const neighbors = [
        readGid(x - 1, y),
        readGid(x + 1, y),
        readGid(x, y - 1),
        readGid(x, y + 1),
      ];
      entry.sameNeighborCount += neighbors.filter((neighborGid) => neighborGid === gid).length;
      statsByGid[gid] = entry;
    }
  }

  const rankedGids = Object.entries(statsByGid)
    .map(([gid, stats]) => ({
      gid: Number.parseInt(gid, 10),
      count: stats.count,
      smoothness: stats.sameNeighborCount / Math.max(stats.count, 1),
    }))
    .sort((a, b) => (b.smoothness - a.smoothness) || (b.count - a.count));

  const urls = rankedGids
    .slice(0, 1)
    .map((item) => manifest.spriteUrlsByGid[String(item.gid)])
    .filter(Boolean);

  return urls.length > 0 ? urls : fallback;
}

export default function ColonyGame() {
  const [buildings, setBuildings] = useState([]);
  const [selectedBuildingType, setSelectedBuildingType] = useState(
    () => Object.keys(BUILDING_TYPES)[0],
  );
  const [hoverCell, setHoverCell] = useState(null);
  const [groundSpriteUrls, setGroundSpriteUrls] = useState([]);
  const [buildingSpriteTilesByType, setBuildingSpriteTilesByType] = useState({});
  const [spriteImages, setSpriteImages] = useState({});

  // Path building state
  const [mode, setMode] = useState('build'); // 'build' | 'path'
  const [paths, setPaths] = useState(new Set()); // Set of "x,y" strings
  const [pathDragStart, setPathDragStart] = useState(null);
  const [pathPreviewCells, setPathPreviewCells] = useState([]);
  const [pathSpriteTilesByName, setPathSpriteTilesByName] = useState({});

  const canvasRef = useRef(null);

  // Returns the tile dimensions { w, h } of a building type from its loaded
  // sprite grid. Falls back to 3×3 until sprites have finished loading.
  const getFootprint = (buildingTypeKey) => {
    const grid = buildingSpriteTilesByType[buildingTypeKey] ?? [];
    return {
      w: grid[0]?.length || 3,
      h: grid.length || 3,
    };
  };

  // Get grid cell from mouse position
  const getGridCell = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
    const y = Math.floor((e.clientY - rect.top) / CELL_SIZE);
    return { x, y };
  };

  const isCellOccupiedByBuilding = (x, y) => {
    return buildings.some((building) => {
      const { w, h } = getFootprint(building.type);
      return (
        x >= building.x
        && x < building.x + w
        && y >= building.y
        && y < building.y + h
      );
    });
  };

  const canPlaceBuildingAt = (x, y, type) => {
    const { w, h } = getFootprint(type);
    if (x < 0 || y < 0 || x + w > GRID_SIZE || y + h > GRID_SIZE) {
      return false;
    }
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        if (isCellOccupiedByBuilding(x + dx, y + dy)) {
          return false;
        }
      }
    }
    return true;
  };

  // Handle canvas click (build mode only)
  const handleCanvasClick = (e) => {
    if (mode !== 'build') return;
    const { x, y } = getGridCell(e);
    const { w, h } = getFootprint(selectedBuildingType);
    const originX = x - Math.floor(w / 2);
    const originY = y - Math.floor(h / 2);

    if (canPlaceBuildingAt(originX, originY, selectedBuildingType)) {
      setBuildings(prev => [...prev, {
        x: originX,
        y: originY,
        type: selectedBuildingType,
      }]);
    }
  };

  const handleCanvasMouseDown = (e) => {
    if (mode !== 'path') return;
    const cell = getGridCell(e);
    setPathDragStart(cell);
    setPathPreviewCells([cell]);
  };

  const handleCanvasMouseUp = (e) => {
    if (mode !== 'path' || !pathDragStart) return;
    if (pathPreviewCells.length > 0) {
      setPaths((prev) => {
        const next = new Set(prev);
        pathPreviewCells.forEach(({ x, y }) => next.add(`${x},${y}`));
        return next;
      });
    }
    setPathDragStart(null);
    setPathPreviewCells([]);
  };

  const handleCanvasMouseMove = (e) => {
    const { x, y } = getGridCell(e);
    setHoverCell({ x, y });
    if (mode === 'path' && pathDragStart) {
      setPathPreviewCells(getStraightLineCells(pathDragStart, { x, y }));
    }
  };

  const handleCanvasMouseLeave = () => {
    setHoverCell(null);
    if (mode === 'path') {
      setPathPreviewCells([]);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function loadSprites() {
      try {
        const [manifest, spriteGroupsData] = await Promise.all([
          loadSpriteManifest(),
          loadSpriteGroups().catch(() => null),
        ]);
        if (cancelled) {
          return;
        }

        const groundsSheet = manifest.sheets.find((sheet) => sheet.name.includes('grounds'));
        const buildingsSheet = manifest.sheets.find((sheet) => sheet.name.includes('buildings'));

        const nextGroundUrls = inferFlatGroundUrls(manifest, groundsSheet);

        const buildingSprites = buildingsSheet?.sprites ?? [];
        const spriteUrlByCoord = new Map(
          buildingSprites.map((sprite) => [`${sprite.row},${sprite.column}`, sprite.url]),
        );
        const nextBuildingTilesByType = {};

        Object.keys(BUILDING_TYPES).forEach((buildingType) => {
          // Prefer API-defined sprite groups; fall back to hardcoded layout.
          // Use the type's spriteGroup field as the lookup key so semantic
          // building names can differ from visual group names.
          const groupName = BUILDING_TYPES[buildingType].spriteGroup ?? buildingType;
          const spriteGroup = spriteGroupsData?.groups.find((g) => g.name === groupName);
          if (spriteGroup) {
            nextBuildingTilesByType[buildingType] = resolveSpriteGroup(spriteGroup, manifest);
          } else {
            const coordGrid = BUILDING_SPRITE_LAYOUT[buildingType] ?? [];
            const tileGrid = coordGrid.map((rowCoords) =>
              rowCoords.map(({ row, column }) => spriteUrlByCoord.get(`${row},${column}`) ?? null),
            );
            nextBuildingTilesByType[buildingType] = tileGrid;
          }
        });

        // Load path sprites (each group is 1×1 tile on the grounds sheet)
        const nextPathSpriteUrlByName = {};
        PATH_TILE_NAMES.forEach((pathName) => {
          const group = spriteGroupsData?.groups.find((g) => g.name === pathName);
          if (group) {
            const resolved = resolveSpriteGroup(group, manifest);
            const url = resolved[0]?.[0] ?? null;
            if (url) nextPathSpriteUrlByName[pathName] = url;
          }
        });

        setGroundSpriteUrls(nextGroundUrls);
        setBuildingSpriteTilesByType(nextBuildingTilesByType);
        setPathSpriteTilesByName(nextPathSpriteUrlByName);
      } catch (error) {
        console.error('Unable to load sprite manifest. Using fallback colors.', error);
      }
    }

    loadSprites();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const urls = [
      ...groundSpriteUrls,
      ...Object.values(buildingSpriteTilesByType).flatMap((grid) => grid.flat()),
      ...Object.values(pathSpriteTilesByName),
    ].filter(Boolean);

    if (urls.length === 0) {
      setSpriteImages({});
      return;
    }

    let cancelled = false;

    Promise.all(
      urls.map(
        (url) =>
          new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve([url, image]);
            image.onerror = () => reject(new Error(`Failed loading sprite image: ${url}`));
            image.src = url;
          }),
      ),
    )
      .then((entries) => {
        if (cancelled) {
          return;
        }

        const loaded = {};
        entries.forEach(([url, image]) => {
          loaded[url] = image;
        });
        setSpriteImages(loaded);
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, [groundSpriteUrls, buildingSpriteTilesByType, pathSpriteTilesByName]);

  // Draw the game
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw terrain
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (groundSpriteUrls.length > 0) {
          const spriteIndex = ((x % 4) + (y % 3) * 4) % groundSpriteUrls.length;
          const spriteUrl = groundSpriteUrls[spriteIndex];
          const spriteImage = spriteImages[spriteUrl];

          if (spriteImage) {
            ctx.drawImage(
              spriteImage,
              x * CELL_SIZE,
              y * CELL_SIZE,
              CELL_SIZE,
              CELL_SIZE,
            );
          } else {
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          }
        } else {
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }
    
    // Draw grid
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= GRID_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL_SIZE, 0);
      ctx.lineTo(i * CELL_SIZE, GRID_SIZE * CELL_SIZE);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(0, i * CELL_SIZE);
      ctx.lineTo(GRID_SIZE * CELL_SIZE, i * CELL_SIZE);
      ctx.stroke();
    }
    
    // Draw placed paths (ground overlays — drawn before buildings)
    paths.forEach((key) => {
      const [px, py] = key.split(',').map(Number);
      const n = paths.has(`${px},${py - 1}`);
      const s = paths.has(`${px},${py + 1}`);
      const e = paths.has(`${px + 1},${py}`);
      const w = paths.has(`${px - 1},${py}`);
      const tileName = getPathTileName(n, w, e, s);
      const url = pathSpriteTilesByName[tileName] ?? pathSpriteTilesByName['PATH_NWES'];
      const img = spriteImages[url];
      if (img) {
        ctx.drawImage(img, px * CELL_SIZE, py * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      } else {
        ctx.fillStyle = 'rgba(120, 90, 50, 0.6)';
        ctx.fillRect(px * CELL_SIZE + 1, py * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      }
    });

    // Draw path drag preview
    if (mode === 'path' && pathPreviewCells.length > 0) {
      const previewSet = new Set(pathPreviewCells.map((c) => `${c.x},${c.y}`));
      const allCells = new Set([...paths, ...previewSet]);
      ctx.save();
      ctx.globalAlpha = 0.65;
      pathPreviewCells.forEach(({ x, y }) => {
        if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return;
        const n = allCells.has(`${x},${y - 1}`);
        const s = allCells.has(`${x},${y + 1}`);
        const e = allCells.has(`${x + 1},${y}`);
        const w = allCells.has(`${x - 1},${y}`);
        const tileName = getPathTileName(n, w, e, s);
        const url = pathSpriteTilesByName[tileName] ?? pathSpriteTilesByName['PATH_NWES'];
        const img = spriteImages[url];
        if (img) {
          ctx.drawImage(img, x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        } else {
          ctx.fillStyle = 'rgba(160, 120, 60, 0.7)';
          ctx.fillRect(x * CELL_SIZE + 1, y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        }
      });
      ctx.restore();
    }

    // Draw buildings
    buildings.forEach(building => {
      const buildingType = BUILDING_TYPES[building.type];
      const tileGrid = buildingSpriteTilesByType[building.type] ?? [];
      const { w: bw, h: bh } = getFootprint(building.type);

      for (let dy = 0; dy < bh; dy += 1) {
        for (let dx = 0; dx < bw; dx += 1) {
          const spriteUrl = tileGrid[dy]?.[dx] ?? null;
          const spriteImage = spriteImages[spriteUrl];
          const drawX = (building.x + dx) * CELL_SIZE;
          const drawY = (building.y + dy) * CELL_SIZE;

          if (spriteImage) {
            ctx.drawImage(spriteImage, drawX, drawY, CELL_SIZE, CELL_SIZE);
          } else if (spriteUrl !== null) {
            // URL exists but image not loaded yet — show placeholder color
            ctx.fillStyle = buildingType?.color ?? '#555';
            ctx.fillRect(drawX + 2, drawY + 2, CELL_SIZE - 4, CELL_SIZE - 4);
          }
          // null URL = intentionally empty/transparent tile — draw nothing
        }
      }
    });

    // Draw hover placement preview (build mode only)
    if (mode === 'build' && hoverCell) {
      const { w: fw, h: fh } = getFootprint(selectedBuildingType);
      const originX = hoverCell.x - Math.floor(fw / 2);
      const originY = hoverCell.y - Math.floor(fh / 2);
      const canPlace = canPlaceBuildingAt(originX, originY, selectedBuildingType);
      const tileGrid = buildingSpriteTilesByType[selectedBuildingType] ?? [];

      ctx.save();
      ctx.globalAlpha = 0.5;

      for (let dy = 0; dy < fh; dy += 1) {
        for (let dx = 0; dx < fw; dx += 1) {
          const drawX = (originX + dx) * CELL_SIZE;
          const drawY = (originY + dy) * CELL_SIZE;

          if (
            originX + dx < 0
            || originY + dy < 0
            || originX + dx >= GRID_SIZE
            || originY + dy >= GRID_SIZE
          ) {
            continue;
          }

          const spriteUrl = tileGrid[dy]?.[dx] ?? null;
          const spriteImage = spriteImages[spriteUrl];

          if (spriteImage) {
            ctx.drawImage(spriteImage, drawX, drawY, CELL_SIZE, CELL_SIZE);
          } else if (spriteUrl !== null) {
            // URL exists but image not loaded yet — show placeholder color
            const buildingType = BUILDING_TYPES[selectedBuildingType];
            ctx.fillStyle = buildingType?.color ?? '#555';
            ctx.fillRect(drawX + 2, drawY + 2, CELL_SIZE - 4, CELL_SIZE - 4);
          }
          // null URL = intentionally empty/transparent tile — draw nothing
        }
      }

      ctx.globalAlpha = 1;
      ctx.strokeStyle = canPlace ? 'rgba(80, 200, 120, 0.85)' : 'rgba(220, 80, 80, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        originX * CELL_SIZE,
        originY * CELL_SIZE,
        fw * CELL_SIZE,
        fh * CELL_SIZE,
      );
      ctx.restore();
    }

  }, [buildings, selectedBuildingType, hoverCell, groundSpriteUrls, buildingSpriteTilesByType, spriteImages, paths, mode, pathPreviewCells, pathSpriteTilesByName]);

  return (
    <div className="colony-game">
      <h1>Space Colony Builder</h1>
      
      <div className="colony-controls">
        <div className="colony-build-panel">
          <h3>Mode:</h3>
          <button
            onClick={() => setMode('build')}
            className={`colony-build-btn${mode === 'build' ? ' selected' : ''}`}
          >
            🏗 Build
          </button>
          <button
            onClick={() => { setMode('path'); setPathDragStart(null); setPathPreviewCells([]); }}
            className={`colony-build-btn${mode === 'path' ? ' selected' : ''}`}
          >
            🛤 Path
          </button>

          {mode === 'build' && (
            <>
              <h3 style={{ marginTop: '0.75rem' }}>Building:</h3>
              {Object.entries(BUILDING_TYPES).map(([key, type]) => (
                <button
                  key={key}
                  onClick={() => setSelectedBuildingType(key)}
                  className={`colony-build-btn${selectedBuildingType === key ? ' selected' : ''}`}
                >
                  {type.name}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="colony-info-panel">
          <h3>Placed Buildings:</h3>
          <div className="colony-info-box">
            <div>Total: {buildings.length}</div>
          </div>

          <div className="colony-instructions">
            <p><strong>Instructions:</strong></p>
            {mode === 'build' ? (
              <>
                <p>• Click places a building centered on your cursor</p>
                <p>• Select a building type from the left</p>
                <p>• Buildings cannot overlap</p>
              </>
            ) : (
              <>
                <p>• Click and drag to draw a straight path</p>
                <p>• Paths snap to horizontal or vertical lines</p>
                <p>• Path tiles update automatically at junctions</p>
              </>
            )}
          </div>
        </div>
      </div>
      
      <canvas
        ref={canvasRef}
        width={GRID_SIZE * CELL_SIZE}
        height={GRID_SIZE * CELL_SIZE}
        onClick={handleCanvasClick}
        onMouseDown={handleCanvasMouseDown}
        onMouseUp={handleCanvasMouseUp}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
        className="colony-canvas"
        style={{ cursor: mode === 'path' ? 'crosshair' : 'default' }}
      />
    </div>
  );
}
