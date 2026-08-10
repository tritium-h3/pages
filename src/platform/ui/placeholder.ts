/** FNV-1a, 32-bit. */
export function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A stable two-stop gradient derived from the id, used when a manifest has no
 *  `art`. Kept dark enough for the plate's caption to stay readable. */
export function placeholderStyle(id: string): { background: string } {
  const hash = hashId(id);
  const hue = hash % 360;
  const hueShift = 30 + ((hash >>> 9) % 90);
  const angle = 100 + ((hash >>> 17) % 80);
  return {
    background:
      `linear-gradient(${angle}deg, ` +
      `hsl(${hue} 42% 30%), ` +
      `hsl(${(hue + hueShift) % 360} 48% 15%))`,
  };
}
