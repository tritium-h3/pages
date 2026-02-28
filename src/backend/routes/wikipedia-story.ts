import { Router, Request, Response } from 'express';
import { ollama } from '../ollama.js';

const router = Router();

// Wikipedia Story endpoint
router.get('/wikipedia-story', async (req: Request, res: Response) => {
  try {
    // Fetch a random Wikipedia article
    console.log('Fetching random Wikipedia article...');
    const wikiResponse = await fetch('https://en.wikipedia.org/api/rest_v1/page/random/summary');
    
    if (!wikiResponse.ok) {
      throw new Error('Failed to fetch Wikipedia article');
    }

    const wikiData = await wikiResponse.json() as { title: string; extract: string };
    const title = wikiData.title;
    const extract = wikiData.extract;

    // Fetch additional content using mobile-sections for richer context
    console.log(`Got Wikipedia article: "${title}", fetching full content...`);
    const sectionsResponse = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/mobile-sections/${encodeURIComponent(title)}`
    );
    
    let fullContext = extract;
    if (sectionsResponse.ok) {
      const sectionsData = await sectionsResponse.json() as {
        remaining?: { sections?: Array<{ text: string }> };
      };
      
      // Combine the summary with the first few sections for richer context
      const sections = sectionsData.remaining?.sections || [];
      const additionalText = sections
        .slice(0, 3) // Get first 3 sections
        .map(s => s.text)
        .join('\n\n');
      
      if (additionalText) {
        fullContext = extract + '\n\n' + additionalText;
        // Limit total context to ~2000 characters to avoid overwhelming the prompt
        if (fullContext.length > 2000) {
          fullContext = fullContext.substring(0, 2000) + '...';
        }
      }
    }

    console.log(`Context length: ${fullContext.length} characters`);

    // Set up Server-Sent Events headers for streaming
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send the Wikipedia article info first (send summary for display)
    res.write(`data: ${JSON.stringify({ type: 'wiki', title, extract })}\n\n`);

    // Generate a story using Ollama with the fuller context
    const prompt = `Based on this Wikipedia article about "${title}":

${fullContext}

Tell me a creative and engaging short story (about 3-4 paragraphs) inspired by this topic. Make it interesting and fun!`;

    console.log('Generating story with Ollama...');

    try {
      // Stream the story from Ollama
      for await (const chunk of ollama.generateStream({
        model: 'qwen3:14b',
        prompt: prompt,
        keep_alive: '60m',
        options: {
          temperature: 0.8,
        }
      })) {
        // Send each chunk as a Server-Sent Event
        res.write(`data: ${JSON.stringify({ type: 'story', chunk })}\n\n`);
      }

      // Send completion message
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (ollamaError) {
      console.error('Ollama error:', ollamaError);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to generate story from Ollama' })}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error('Error in wikipedia-story endpoint:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate Wikipedia story' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'An error occurred' })}\n\n`);
      res.end();
    }
  }
});

export default router;
