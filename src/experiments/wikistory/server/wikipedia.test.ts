import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchRandomArticle, trimToBudget, isUsable, MAX_CONTEXT_CHARS } from './wikipedia.js';

afterEach(() => vi.unstubAllGlobals());

const page = (over: Record<string, unknown> = {}) => ({
  pageid: 123,
  title: 'Ficus racemosa',
  extract: 'F'.repeat(600),
  ...over,
});

const apiResponse = (p: unknown) =>
  new Response(JSON.stringify({ query: { pages: p === null ? [] : [p] } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('trimToBudget', () => {
  it('leaves short text alone', () => {
    expect(trimToBudget('a short article')).toBe('a short article');
  });

  it('cuts at a paragraph break rather than mid-word', () => {
    const text = 'A'.repeat(70) + '\n\n' + 'B'.repeat(70);
    expect(trimToBudget(text, 100)).toBe('A'.repeat(70));
  });

  it('falls back to a sentence boundary', () => {
    const text = 'C'.repeat(60) + '. ' + 'D'.repeat(60);
    const out = trimToBudget(text, 100);
    expect(out).toBe('C'.repeat(60) + '.');
  });

  it('never exceeds the budget', () => {
    const out = trimToBudget('E'.repeat(9000), 500);
    expect(out.length).toBeLessThanOrEqual(501); // +1 for the ellipsis
  });
});

describe('isUsable', () => {
  it('rejects disambiguation pages', () => {
    expect(isUsable(page({ pageprops: { disambiguation: '' } }))).toBe(false);
  });

  it('rejects stubs with almost no text', () => {
    expect(isUsable(page({ extract: 'A township in Iowa.' }))).toBe(false);
  });

  it('rejects pages with no extract at all', () => {
    expect(isUsable(page({ extract: undefined }))).toBe(false);
  });

  it('accepts a substantial article', () => {
    expect(isUsable(page())).toBe(true);
  });
});

describe('fetchRandomArticle', () => {
  it('returns title and extract from the same page', async () => {
    vi.stubGlobal('fetch', async () => apiResponse(page()));
    const article = await fetchRandomArticle();
    expect(article.title).toBe('Ficus racemosa');
    expect(article.pageId).toBe(123);
    expect(article.extract.length).toBeGreaterThan(400);
    expect(article.url).toBe('https://en.wikipedia.org/?curid=123');
  });

  it('sends a User-Agent, as Wikimedia policy requires', async () => {
    const spy = vi.fn(async (_url: string, _init: RequestInit) => apiResponse(page()));
    vi.stubGlobal('fetch', spy);
    await fetchRandomArticle();
    const headers = spy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/wikistory/i);
  });

  it('requests plaintext extracts from the article namespace', async () => {
    const spy = vi.fn(async (_url: string, _init: RequestInit) => apiResponse(page()));
    vi.stubGlobal('fetch', spy);
    await fetchRandomArticle();
    const url = spy.mock.calls[0][0];
    expect(url).toContain('generator=random');
    expect(url).toContain('grnnamespace=0');
    expect(url).toContain('explaintext=1');
  });

  it('retries past stubs and disambiguation pages', async () => {
    const queue = [
      page({ title: 'Stub Township', extract: 'A township.' }),
      page({ title: 'Mercury (disambiguation)', pageprops: { disambiguation: '' } }),
      page({ title: 'Good Article', pageid: 999 }),
    ];
    const spy = vi.fn(async () => apiResponse(queue.shift()));
    vi.stubGlobal('fetch', spy);

    const article = await fetchRandomArticle();
    expect(article.title).toBe('Good Article');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('trims an overlong article to the context budget', async () => {
    vi.stubGlobal('fetch', async () => apiResponse(page({ extract: 'G'.repeat(50_000) })));
    const article = await fetchRandomArticle();
    expect(article.extract.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 1);
  });

  it('throws a clear error when every attempt is unusable', async () => {
    vi.stubGlobal('fetch', async () => apiResponse(page({ title: 'Tiny', extract: 'x' })));
    await expect(fetchRandomArticle(3)).rejects.toThrow(/No suitable Wikipedia article/);
  });

  it('surfaces an API failure instead of hanging', async () => {
    vi.stubGlobal('fetch', async () => new Response('rate limited', { status: 429 }));
    await expect(fetchRandomArticle()).rejects.toThrow(/429/);
  });
});
