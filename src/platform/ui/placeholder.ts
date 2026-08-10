/** FNV-1a, 32-bit. */
export function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Golden angle. Successive multiples land as far from every previous value as
 *  possible, so hues stay separated for any number of cards — which hashing
 *  the id does not do: nine ids clustered three into one yellow-green band. */
const GOLDEN_ANGLE = 137.508;

/** The card's dominant hue, from its position in the registry rather than its
 *  id. Exported so the test can assert separation directly. */
export function primaryHue(index: number): number {
  return Math.round((index * GOLDEN_ANGLE) % 360);
}

/** A stable two-stop gradient for a card with no `art`. Position sets the hue
 *  so the gallery reads as distinct plates; the id hash sets the secondary
 *  stop and the angle, so each card still looks individual. Both lightness
 *  values stay dark enough for the caption to remain readable. */
export function placeholderStyle(id: string, index: number): { background: string } {
  const hash = hashId(id);
  const hue = primaryHue(index);
  const hueShift = 30 + ((hash >>> 9) % 90);
  const angle = 100 + ((hash >>> 17) % 80);
  return {
    background:
      `linear-gradient(${angle}deg, ` +
      `hsl(${hue} 42% 30%), ` +
      `hsl(${(hue + hueShift) % 360} 48% 15%))`,
  };
}
