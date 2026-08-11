import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaClient } from './ollama.js';

afterEach(() => vi.unstubAllGlobals());

/** Build a Response whose body streams exactly the given byte-chunks. */
const streamOf = (chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    }),
    { status: 200 }
  );

const collect = async (gen: AsyncGenerator<string>) => {
  const out: string[] = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
};

describe('generateStream — NDJSON framing', () => {
  const client = new OllamaClient('http://ollama.test');

  it('yields responses when each JSON object arrives in its own read', async () => {
    vi.stubGlobal('fetch', async () =>
      streamOf([
        JSON.stringify({ response: 'Hello ' }) + '\n',
        JSON.stringify({ response: 'world' }) + '\n',
      ])
    );
    const out = await collect(client.generateStream({ model: 'm', prompt: 'p' }));
    expect(out.join('')).toBe('Hello world');
  });

  it('does not drop text when a JSON object is split across reads', async () => {
    // A single NDJSON line cut in half at an arbitrary byte boundary, exactly
    // as happens when ollama's message straddles a TCP read.
    const line = JSON.stringify({ response: 'the quick brown fox' }) + '\n';
    const cut = Math.floor(line.length / 2);
    vi.stubGlobal('fetch', async () => streamOf([line.slice(0, cut), line.slice(cut)]));

    const out = await collect(client.generateStream({ model: 'm', prompt: 'p' }));
    expect(out.join('')).toBe('the quick brown fox');
  });

  it('reassembles a stream split at many boundaries', async () => {
    const words = ['Once ', 'upon ', 'a ', 'time ', 'there ', 'was ', 'a ', 'crayfish.'];
    const payload = words.map(w => JSON.stringify({ response: w }) + '\n').join('');
    // Slice the whole payload into small fixed-size pieces, ignoring line boundaries.
    const pieces: string[] = [];
    for (let i = 0; i < payload.length; i += 7) pieces.push(payload.slice(i, i + 7));
    vi.stubGlobal('fetch', async () => streamOf(pieces));

    const out = await collect(client.generateStream({ model: 'm', prompt: 'p' }));
    expect(out.join('')).toBe(words.join(''));
  });

  it('ignores the trailing done message but keeps its text', async () => {
    vi.stubGlobal('fetch', async () =>
      streamOf([
        JSON.stringify({ response: 'end' }) + '\n',
        JSON.stringify({ response: '', done: true, context: [1, 2, 3] }) + '\n',
      ])
    );
    const out = await collect(client.generateStream({ model: 'm', prompt: 'p' }));
    expect(out.join('')).toBe('end');
  });

  it('propagates an abort signal to fetch', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seenSignal = init.signal ?? undefined;
      return streamOf([JSON.stringify({ response: 'x' }) + '\n']);
    });
    await collect(client.generateStream({ model: 'm', prompt: 'p' }, controller.signal));
    expect(seenSignal).toBe(controller.signal);
  });
});
