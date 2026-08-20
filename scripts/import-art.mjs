/**
 * Import a source image as an experiment's gallery artwork.
 *
 *   npm run art -- <image> <id> [--gravity=centre] [--quality=82] [--dry-run]
 *
 * Crops to the plate's 2:1 ratio, writes public/art/<id>.webp, and adds the
 * `art:` line to that slice's manifest. Re-running replaces both, so it is
 * safe to import a better version of the same image later.
 */
import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Must stay in step with `.art { aspect-ratio: 2 / 1 }` in Plate.module.css.
 *  1024 is 4x the rendered width at the default four-across layout, which
 *  covers retina and leaves room if the grid ever widens. */
const WIDTH = 1024;
const HEIGHT = 512;

const GRAVITIES = ['top', 'centre', 'bottom', 'north', 'south', 'east', 'west'];

function fail(message, detail) {
  console.error(`\n  ✗ ${message}`);
  if (detail) console.error(`    ${detail}`);
  console.error();
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = { gravity: 'centre', quality: 82, dryRun: false };

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [key, value] = arg.slice(2).split('=');
    if (key === 'dry-run') flags.dryRun = true;
    else if (key === 'gravity') flags.gravity = value;
    else if (key === 'quality') flags.quality = Number(value);
    else fail(`Unknown option --${key}`, 'Valid: --gravity, --quality, --dry-run');
  }

  const [source, id] = positional;
  if (!source || !id) {
    fail(
      'Usage: npm run art -- <image> <id> [--gravity=centre] [--quality=82] [--dry-run]',
      'Example: npm run art -- ~/generated/sunset.png sky --gravity=top',
    );
  }
  if (!GRAVITIES.includes(flags.gravity)) {
    fail(`Unknown --gravity "${flags.gravity}"`, `Valid: ${GRAVITIES.join(', ')}`);
  }
  if (!Number.isFinite(flags.quality) || flags.quality < 1 || flags.quality > 100) {
    fail(`--quality must be 1-100, got "${flags.quality}"`);
  }
  return { source, id, ...flags };
}

async function listSliceIds() {
  const entries = await fs.readdir(path.join(ROOT, 'src', 'experiments'), { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** Adds or replaces the `art:` line, keeping it directly after `route:` so
 *  every manifest stays in the same field order. */
function patchManifest(source, artPath) {
  const line = `  art: '${artPath}',`;

  if (/^\s*art:.*$/m.test(source)) {
    return { text: source.replace(/^\s*art:.*$/m, line), action: 'updated' };
  }
  if (!/^\s*route:.*$/m.test(source)) return { text: source, action: 'no-route-line' };

  return {
    text: source.replace(/^(\s*route:.*)$/m, `$1\n${line}`),
    action: 'added',
  };
}

const { source, id, gravity, quality, dryRun } = parseArgs(process.argv.slice(2));

const sliceIds = await listSliceIds();
if (!sliceIds.includes(id)) {
  fail(`No experiment called "${id}"`, `Known ids: ${sliceIds.join(', ')}`);
}

const manifestPath = path.join(ROOT, 'src', 'experiments', id, 'manifest.ts');
try {
  await fs.access(manifestPath);
} catch {
  fail(`${id} has no manifest.ts`, manifestPath);
}

let input;
try {
  input = await sharp(source).metadata();
} catch (error) {
  fail(`Could not read "${source}"`, error.message);
}

const outRelative = `/art/${id}.webp`;
const outPath = path.join(ROOT, 'public', 'art', `${id}.webp`);

const sourceRatio = (input.width / input.height).toFixed(2);
console.log(`\n  source   ${path.basename(source)}  ${input.width}x${input.height}  (${sourceRatio}:1)`);
console.log(`  output   public${outRelative}  ${WIDTH}x${HEIGHT}  (2:1, quality ${quality})`);
if (Math.abs(input.width / input.height - 2) > 0.01) {
  console.log(`  crop     ${gravity} — source is not 2:1, so the overflow is trimmed`);
}

if (dryRun) {
  console.log('\n  --dry-run: nothing written\n');
  process.exit(0);
}

await fs.mkdir(path.dirname(outPath), { recursive: true });
await sharp(source)
  .resize(WIDTH, HEIGHT, { fit: 'cover', position: gravity })
  .webp({ quality })
  .toFile(outPath);

const { size } = await fs.stat(outPath);
console.log(`  written  ${(size / 1024).toFixed(1)} KB`);

const before = await fs.readFile(manifestPath, 'utf8');
const { text, action } = patchManifest(before, outRelative);

if (action === 'no-route-line') {
  console.log(`\n  ! ${id}/manifest.ts has no route: line — add this yourself:`);
  console.log(`      art: '${outRelative}',\n`);
  process.exit(0);
}

if (text === before) {
  console.log(`  manifest already points at ${outRelative}`);
} else {
  await fs.writeFile(manifestPath, text);
  console.log(`  manifest ${action} art: '${outRelative}'`);
}

console.log(`\n  Done. Reload the gallery to see it.\n`);
