import { Router, Request, Response } from 'express';
import type { SliceServer } from '../../../platform/server/slice.js';
import { ollama } from '../../../platform/server/ollama.js';
import { fetchRandomArticle } from './wikipedia.js';
import type { WikiStoryEvent } from '../types.js';

const router = Router();

const MODEL = 'qwen3:14b';

// Wikipedia Story endpoint
router.get('/', async (req: Request, res: Response) => {
  // If the browser navigates away or starts a new story, stop generating —
  // otherwise abandoned generations keep queueing inside Ollama and every
  // subsequent request waits behind them.
  const abort = new AbortController();
  req.on('close', () => abort.abort());

  const sse = (payload: WikiStoryEvent) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  try {
    console.log('Fetching random Wikipedia article...');
    const article = await fetchRandomArticle(5, abort.signal);
    console.log(`Got Wikipedia article: "${article.title}" (${article.extract.length} chars)`);

    if (abort.signal.aborted) return;

    // Set up Server-Sent Events headers for streaming
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send the Wikipedia article info first, so the page can show it while the
    // story streams in.
    sse({
      type: 'wiki',
      title: article.title,
      extract: article.extract,
      url: article.url,
    });

    const prompt = `Based on this Wikipedia article about "${article.title}":

${article.extract}

Tell me a creative and engaging short story (about 3-4 paragraphs) inspired by this topic. Make it interesting and fun!

Write only the story itself. Do not add a preamble, title, or commentary.`;

    console.log(`Generating story with ${MODEL}...`);

    try {
      for await (const chunk of ollama.generateStream(
        {
          model: MODEL,
          prompt,
          keep_alive: '60m',
          options: { temperature: 0.8 },
        },
        abort.signal
      )) {
        sse({ type: 'story', chunk });
      }

      sse({ type: 'done' });
      res.end();
    } catch (ollamaError) {
      if (abort.signal.aborted) {
        console.log('Client disconnected; generation cancelled.');
        return;
      }
      console.error('Ollama error:', ollamaError);
      sse({ type: 'error', message: 'Failed to generate story from Ollama' });
      res.end();
    }
  } catch (error) {
    if (abort.signal.aborted) return;
    console.error('Error in wikipedia-story endpoint:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to generate Wikipedia story';
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    } else {
      sse({ type: 'error', message });
      res.end();
    }
  }
});

const slice: SliceServer = { router };
export default slice;
