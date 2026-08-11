/**
 * Wikipedia article fetching for the WikiStory generator.
 *
 * Uses a single Action API query with `generator=random`, so the title and the
 * article text always come from the same page. (The previous two-step approach
 * — REST `random/summary` followed by `mobile-sections` for the title — could
 * not guarantee that, and `mobile-sections` has since been withdrawn: it now
 * returns 403 for every request, so every story was written from the ~250
 * character summary alone.)
 */

const API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';

// Wikimedia's User-Agent policy: unidentified clients are throttled or refused.
const USER_AGENT =
  'pages-wikistory/1.0 (https://samarkand.hopto.org; https://github.com/tritium/pages)';

/** Below this, an article is a stub with too little substance to write from. */
const MIN_EXTRACT_CHARS = 400;

/** Upper bound on prompt context. Generous — qwen3:14b handles it comfortably. */
export const MAX_CONTEXT_CHARS = 4000;

export interface WikiArticle {
  title: string;
  pageId: number;
  /** Plain-text article body, already trimmed to MAX_CONTEXT_CHARS. */
  extract: string;
  url: string;
}

interface ApiPage {
  pageid: number;
  title: string;
  extract?: string;
  pageprops?: Record<string, unknown>;
}

/**
 * Trim to a budget without cutting mid-sentence: prefer the last paragraph
 * break, then the last sentence end, and only hard-cut if neither exists.
 */
export function trimToBudget(text: string, budget = MAX_CONTEXT_CHARS): string {
  if (text.length <= budget) return text;

  const window = text.slice(0, budget);
  const paragraph = window.lastIndexOf('\n\n');
  if (paragraph > budget * 0.5) return window.slice(0, paragraph).trimEnd();

  const sentence = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('.\n'),
    window.lastIndexOf('! '),
    window.lastIndexOf('? ')
  );
  if (sentence > budget * 0.5) return window.slice(0, sentence + 1).trimEnd();

  return window.trimEnd() + '…';
}

/** A page we can't write a story from: a disambiguation list, or a bare stub. */
export function isUsable(page: ApiPage): boolean {
  if (page.pageprops && 'disambiguation' in page.pageprops) return false;
  const extract = (page.extract ?? '').trim();
  return extract.length >= MIN_EXTRACT_CHARS;
}

async function fetchOneRandomPage(signal?: AbortSignal): Promise<ApiPage | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'random',
    grnnamespace: '0', // article namespace only
    grnlimit: '1',
    prop: 'extracts|pageprops',
    explaintext: '1', // plain text, not HTML
    exsectionformat: 'plain',
    redirects: '1',
  });

  const response = await fetch(`${API_ENDPOINT}?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Wikipedia API returned ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { query?: { pages?: ApiPage[] } };
  return data.query?.pages?.[0] ?? null;
}

/**
 * Fetch a random article substantial enough to build a story from, skipping
 * disambiguation pages and stubs. Retries a bounded number of times, since
 * "random" regularly lands on one-line geographic or taxonomic stubs.
 */
export async function fetchRandomArticle(
  attempts = 5,
  signal?: AbortSignal
): Promise<WikiArticle> {
  let lastSeen: string | null = null;

  for (let i = 0; i < attempts; i++) {
    const page = await fetchOneRandomPage(signal);
    if (!page) continue;

    if (!isUsable(page)) {
      lastSeen = page.title;
      continue;
    }

    return {
      title: page.title,
      pageId: page.pageid,
      extract: trimToBudget((page.extract ?? '').trim()),
      url: `https://en.wikipedia.org/?curid=${page.pageid}`,
    };
  }

  throw new Error(
    `No suitable Wikipedia article found in ${attempts} attempts` +
      (lastSeen ? ` (last was "${lastSeen}")` : '')
  );
}
