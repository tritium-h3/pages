import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';

const rootDir = process.cwd();
const sourceDir = path.join(rootDir, 'assets');
const outputDir = path.join(rootDir, 'public', 'sprites');
const manifestPath = path.join(outputDir, 'manifest.json');
const labelsConfigPath = path.join(sourceDir, 'sprite-labels.json');
const buildingGidMapPath = path.join(sourceDir, 'building-gid-map.json');

const BUILDING_TYPES = ['MINE', 'GREENHOUSE', 'FOOD_PROCESSOR', 'BARRACKS', 'WAREHOUSE'];

const defaultTile = Number.parseInt(process.env.SPRITE_TILE_SIZE ?? '32', 10) || 32;

function parseTileSize(fileBaseName) {
  const byWxH = fileBaseName.match(/(?:^|[-_])(\d+)x(\d+)(?:[-_]|$)/i);
  if (byWxH) {
    return {
      width: Number.parseInt(byWxH[1], 10),
      height: Number.parseInt(byWxH[2], 10),
    };
  }

  const byDb = fileBaseName.match(/(?:^|[-_])db(\d+)(?:[-_]|$)/i);
  if (byDb) {
    const size = Number.parseInt(byDb[1], 10);
    return { width: size, height: size };
  }

  return { width: defaultTile, height: defaultTile };
}

function makeSlug(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function parseXmlAttributes(rawAttributes) {
  const attrs = {};
  const regex = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
  let match = regex.exec(rawAttributes);
  while (match) {
    attrs[match[1]] = match[2];
    match = regex.exec(rawAttributes);
  }
  return attrs;
}

function decodeZlibBase64Gids(encodedData) {
  const cleanBase64 = encodedData.replace(/\s+/g, '');
  const compressed = Buffer.from(cleanBase64, 'base64');
  const raw = inflateSync(compressed);
  const total = Math.floor(raw.length / 4);
  const gids = new Array(total);
  for (let i = 0; i < total; i += 1) {
    gids[i] = raw.readUInt32LE(i * 4);
  }
  return gids;
}

async function loadTmxInfo() {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const tmxEntry = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.tmx'));
  if (!tmxEntry) {
    return null;
  }

  const tmxPath = path.join(sourceDir, tmxEntry.name);
  const xml = await fs.readFile(tmxPath, 'utf8');

  const mapMatch = xml.match(/<map\s+([^>]+)>/i);
  const mapAttrs = mapMatch ? parseXmlAttributes(mapMatch[1]) : {};

  const tilesets = [];
  const tilesetRegex = /<tileset\s+([^>]*?)>([\s\S]*?)<\/tileset>/gi;
  let tilesetMatch = tilesetRegex.exec(xml);
  while (tilesetMatch) {
    const tilesetAttrs = parseXmlAttributes(tilesetMatch[1]);
    const body = tilesetMatch[2];
    const imageMatch = body.match(/<image\s+([^>]*?)\/>/i);
    const imageAttrs = imageMatch ? parseXmlAttributes(imageMatch[1]) : {};

    const tileLabelsByIndex = {};
    const tileRegex = /<tile\s+([^>]*?)>([\s\S]*?)<\/tile>/gi;
    let tileMatch = tileRegex.exec(body);
    while (tileMatch) {
      const tileAttrs = parseXmlAttributes(tileMatch[1]);
      const tileBody = tileMatch[2];
      const tileId = Number.parseInt(tileAttrs.id ?? '-1', 10);
      const propertyRegex = /<property\s+([^>]*?)\/>/gi;
      let propertyMatch = propertyRegex.exec(tileBody);
      while (propertyMatch) {
        const propertyAttrs = parseXmlAttributes(propertyMatch[1]);
        const propertyName = (propertyAttrs.name ?? '').toLowerCase();
        if (propertyName === 'label' || propertyName === 'name') {
          tileLabelsByIndex[tileId] = propertyAttrs.value ?? '';
        }
        propertyMatch = propertyRegex.exec(tileBody);
      }
      tileMatch = tileRegex.exec(body);
    }

    tilesets.push({
      firstGid: Number.parseInt(tilesetAttrs.firstgid ?? '0', 10),
      name: tilesetAttrs.name ?? '',
      tileWidth: Number.parseInt(tilesetAttrs.tilewidth ?? mapAttrs.tilewidth ?? '0', 10),
      tileHeight: Number.parseInt(tilesetAttrs.tileheight ?? mapAttrs.tileheight ?? '0', 10),
      imageSource: imageAttrs.source ?? null,
      imageWidth: Number.parseInt(imageAttrs.width ?? '0', 10),
      imageHeight: Number.parseInt(imageAttrs.height ?? '0', 10),
      tileLabelsByIndex,
    });

    tilesetMatch = tilesetRegex.exec(xml);
  }

  const layers = [];
  const layerRegex = /<layer\s+([^>]*?)>([\s\S]*?)<\/layer>/gi;
  let layerMatch = layerRegex.exec(xml);
  while (layerMatch) {
    const layerAttrs = parseXmlAttributes(layerMatch[1]);
    const layerBody = layerMatch[2];
    const dataMatch = layerBody.match(/<data\s+([^>]*?)>([\s\S]*?)<\/data>/i);
    if (!dataMatch) {
      layerMatch = layerRegex.exec(xml);
      continue;
    }

    const dataAttrs = parseXmlAttributes(dataMatch[1]);
    const encoding = (dataAttrs.encoding ?? '').toLowerCase();
    const compression = (dataAttrs.compression ?? '').toLowerCase();
    if (encoding !== 'base64' || compression !== 'zlib') {
      layerMatch = layerRegex.exec(xml);
      continue;
    }

    const gids = decodeZlibBase64Gids(dataMatch[2]);
    const gidCounts = {};
    const cells = [];
    for (let index = 0; index < gids.length; index += 1) {
      const gid = gids[index];
      if (gid === 0) {
        continue;
      }
      gidCounts[gid] = (gidCounts[gid] ?? 0) + 1;
      cells.push([index, gid]);
    }

    layers.push({
      name: layerAttrs.name ?? 'Unnamed Layer',
      width: Number.parseInt(layerAttrs.width ?? mapAttrs.width ?? '0', 10),
      height: Number.parseInt(layerAttrs.height ?? mapAttrs.height ?? '0', 10),
      usedGids: Object.keys(gidCounts).map((value) => Number.parseInt(value, 10)).sort((a, b) => a - b),
      gidCounts,
      cells,
    });

    layerMatch = layerRegex.exec(xml);
  }

  return {
    sourceFile: tmxEntry.name,
    map: {
      width: Number.parseInt(mapAttrs.width ?? '0', 10),
      height: Number.parseInt(mapAttrs.height ?? '0', 10),
      tileWidth: Number.parseInt(mapAttrs.tilewidth ?? '0', 10),
      tileHeight: Number.parseInt(mapAttrs.tileheight ?? '0', 10),
      orientation: mapAttrs.orientation ?? null,
    },
    tilesets,
    layers,
  };
}

async function loadLabelsConfig() {
  try {
    const raw = await fs.readFile(labelsConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    return {};
  }
  return {};
}

async function loadBuildingGidMap() {
  try {
    const raw = await fs.readFile(buildingGidMapPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    return {};
  }
  return {};
}

function lookupLabel(labelsConfig, sheetName, row, column, absoluteIndex) {
  const perSheet = labelsConfig[sheetName];
  if (!perSheet) {
    return null;
  }

  if (Array.isArray(perSheet)) {
    return perSheet[absoluteIndex] ?? null;
  }

  if (typeof perSheet === 'object') {
    return perSheet[`${row},${column}`] ?? null;
  }

  return null;
}

async function isTileEmpty(baseImage, tileWidth, tileHeight, left, top) {
  const { data, info } = await baseImage
    .clone()
    .extract({ left, top, width: tileWidth, height: tileHeight })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixelSize = info.channels;
  const alphaIndex = 3;
  for (let i = alphaIndex; i < data.length; i += pixelSize) {
    if (data[i] > 0) {
      return false;
    }
  }
  return true;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const labelsConfig = await loadLabelsConfig();
  const buildingGidMap = await loadBuildingGidMap();
  const tmxInfo = await loadTmxInfo();
  const tmxTilesetsByName = Object.fromEntries((tmxInfo?.tilesets ?? []).map((tileset) => [tileset.name, tileset]));

  const sourceEntries = await fs.readdir(sourceDir, { withFileTypes: true });
  const sourceFiles = sourceEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map((entry) => entry.name)
    .sort();

  const manifest = {
    generatedAt: new Date().toISOString(),
    sheets: [],
    spritesById: {},
    spritesByGid: {},
    spriteUrlsByGid: {},
    tmx: null,
    suggested: {
      groundSpriteUrls: [],
      buildingSpriteUrls: [],
    },
    mappings: {
      buildingTypeToGid: {},
      buildingTypeToUrl: {},
    },
  };

  for (const fileName of sourceFiles) {
    const absoluteSourcePath = path.join(sourceDir, fileName);
    const sheetName = path.parse(fileName).name;
    const sheetSlug = makeSlug(sheetName);
    const sheetOutDir = path.join(outputDir, sheetSlug);
    await fs.rm(sheetOutDir, { recursive: true, force: true });
    await fs.mkdir(sheetOutDir, { recursive: true });

    const tmxTileset = tmxTilesetsByName[sheetName] ?? null;
    const tileSize = tmxTileset
      ? { width: tmxTileset.tileWidth, height: tmxTileset.tileHeight }
      : parseTileSize(sheetName);
    const baseImage = sharp(absoluteSourcePath);
    const metadata = await baseImage.metadata();
    const imageWidth = metadata.width ?? 0;
    const imageHeight = metadata.height ?? 0;

    if (imageWidth === 0 || imageHeight === 0) {
      continue;
    }

    const columns = Math.floor(imageWidth / tileSize.width);
    const rows = Math.floor(imageHeight / tileSize.height);

    const sheetManifest = {
      name: sheetName,
      sourceFile: fileName,
      tileWidth: tileSize.width,
      tileHeight: tileSize.height,
      columns,
      rows,
      firstGid: tmxTileset?.firstGid ?? null,
      sprites: [],
    };

    let absoluteIndex = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const left = column * tileSize.width;
        const top = row * tileSize.height;
        const isEmpty = await isTileEmpty(baseImage, tileSize.width, tileSize.height, left, top);
        const configuredLabel = lookupLabel(labelsConfig, sheetName, row, column, absoluteIndex);
        const tmxLabel = tmxTileset?.tileLabelsByIndex?.[absoluteIndex] ?? null;
        const label = configuredLabel ?? tmxLabel ?? `${sheetName}-r${row}-c${column}`;

        if (!isEmpty) {
          const spriteId = `${sheetName}:${row},${column}`;
          const gid = tmxTileset ? tmxTileset.firstGid + absoluteIndex : null;
          const outName = `${sheetSlug}--r${row}-c${column}.png`;
          const outPath = path.join(sheetOutDir, outName);

          await baseImage
            .clone()
            .extract({ left, top, width: tileSize.width, height: tileSize.height })
            .png()
            .toFile(outPath);

          const url = `/sprites/${sheetSlug}/${outName}`;
          sheetManifest.sprites.push({
            id: spriteId,
            label,
            row,
            column,
            index: absoluteIndex,
            gid,
            width: tileSize.width,
            height: tileSize.height,
            url,
          });
          manifest.spritesById[spriteId] = url;
          if (gid !== null) {
            manifest.spritesByGid[gid] = spriteId;
            manifest.spriteUrlsByGid[gid] = url;
          }
        }

        absoluteIndex += 1;
      }
    }

    manifest.sheets.push(sheetManifest);
  }

  if (tmxInfo) {
    const tilesets = [...tmxInfo.tilesets]
      .sort((a, b) => a.firstGid - b.firstGid)
      .map((tileset, index, list) => {
        const nextFirstGid = list[index + 1]?.firstGid ?? null;
        const linkedSheet = manifest.sheets.find((sheet) => sheet.name === tileset.name);
        const tileCount = linkedSheet ? linkedSheet.columns * linkedSheet.rows : 0;
        const lastGid = nextFirstGid ? nextFirstGid - 1 : tileset.firstGid + tileCount - 1;
        return {
          name: tileset.name,
          firstGid: tileset.firstGid,
          lastGid,
          tileWidth: tileset.tileWidth,
          tileHeight: tileset.tileHeight,
          imageSource: tileset.imageSource,
        };
      });

    const layers = tmxInfo.layers.map((layer) => {
      const spriteUrls = layer.usedGids
        .map((gid) => manifest.spriteUrlsByGid[gid])
        .filter(Boolean);
      return {
        name: layer.name,
        width: layer.width,
        height: layer.height,
        usedGids: layer.usedGids,
        usedSpriteUrls: [...new Set(spriteUrls)],
        cells: layer.cells,
      };
    });

    manifest.tmx = {
      sourceFile: tmxInfo.sourceFile,
      map: tmxInfo.map,
      tilesets,
      layers,
    };

    const groundLayers = tmxInfo.layers.filter((layer) => /(ground|basic tile layer|path|wall|darkness)/i.test(layer.name));
    const buildingLayers = tmxInfo.layers.filter((layer) => /(building|others-buildings|corrections)/i.test(layer.name));
    const buildingTilesetRanges = tilesets
      .filter((tileset) => /building/i.test(tileset.name))
      .map((tileset) => ({ firstGid: tileset.firstGid, lastGid: tileset.lastGid }));

    manifest.suggested.groundSpriteUrls = [
      ...new Set(
        groundLayers
          .flatMap((layer) => layer.usedGids)
          .map((gid) => manifest.spriteUrlsByGid[gid])
          .filter(Boolean),
      ),
    ];

    manifest.suggested.buildingSpriteUrls = [
      ...new Set(
        buildingLayers
          .flatMap((layer) => layer.usedGids)
          .map((gid) => manifest.spriteUrlsByGid[gid])
          .filter(Boolean),
      ),
    ];

    const autoBuildingGids = [
      ...new Set(
        buildingLayers
          .flatMap((layer) => layer.usedGids)
          .filter((gid) =>
            buildingTilesetRanges.some((range) => gid >= range.firstGid && gid <= range.lastGid),
          )
          .filter((gid) => Boolean(manifest.spriteUrlsByGid[gid])),
      ),
    ];

    BUILDING_TYPES.forEach((buildingType, index) => {
      const configured = Number.parseInt(String(buildingGidMap[buildingType] ?? ''), 10);
      const configuredUrl = manifest.spriteUrlsByGid[configured];
      const autoGid = autoBuildingGids[index];
      const autoUrl = manifest.spriteUrlsByGid[autoGid];

      if (configured && configuredUrl) {
        manifest.mappings.buildingTypeToGid[buildingType] = configured;
        manifest.mappings.buildingTypeToUrl[buildingType] = configuredUrl;
      } else if (autoGid && autoUrl) {
        manifest.mappings.buildingTypeToGid[buildingType] = autoGid;
        manifest.mappings.buildingTypeToUrl[buildingType] = autoUrl;
      }
    });
  }

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Built ${manifest.sheets.length} sprite sheets into ${outputDir}`);
  console.log(`Manifest written to ${manifestPath}`);
}

main().catch((error) => {
  console.error('Failed to build sprites:', error);
  process.exitCode = 1;
});