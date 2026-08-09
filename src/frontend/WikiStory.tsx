import { useState, useEffect, useRef, useCallback } from 'react';
import { BookOpen, Sparkles, RefreshCw } from 'lucide-react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { apiUrl } from './backendApi';

interface WikiInfo {
  title: string;
  extract: string;
  url?: string;
}

// The model writes markdown — mostly **bold** and *emphasis* with blank-line
// paragraph breaks, occasionally a heading or list. Tailwind's preflight strips
// default margins and list markers, and @tailwindcss/typography isn't installed
// here, so each element carries its own styling.
const storyMarkdown: Components = {
  p: ({ children }) => <p className="mb-4 leading-relaxed last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <h3 className="text-xl font-bold text-gray-800 mt-6 mb-2 first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="text-xl font-bold text-gray-800 mt-6 mb-2 first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="text-lg font-bold text-gray-800 mt-5 mb-2 first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-purple-300 pl-4 italic text-gray-600 mb-4">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="bg-gray-100 rounded px-1 py-0.5 text-base font-mono">{children}</code>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-purple-700 hover:underline">
      {children}
    </a>
  ),
  hr: () => <hr className="my-6 border-gray-200" />,
};

export default function WikiStory() {
  const [wikiInfo, setWikiInfo] = useState<WikiInfo | null>(null);
  const [story, setStory] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only one story may be in flight. Without this, StrictMode's double-invoked
  // mount effect (and any click landing before the previous stream finished)
  // ran two requests at once: both streamed into the same `story` state, so the
  // page showed one article's title above a blend of two different stories.
  const inFlight = useRef<AbortController | null>(null);
  const requestId = useRef(0);

  const generateStory = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    const id = ++requestId.current;
    // True only while this call is still the newest one; a superseded request
    // must not write to state after a newer one has cleared it.
    const isCurrent = () => requestId.current === id;

    setIsLoading(true);
    setError(null);
    setWikiInfo(null);
    setStory('');

    try {
      const response = await fetch(apiUrl('/wikipedia-story'), {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch story (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          if (!isCurrent()) return;

          let data: { type: string; [key: string]: unknown };
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            // A single malformed event shouldn't abandon the whole story.
            console.warn('Skipping unparseable SSE line:', line);
            continue;
          }

          if (data.type === 'wiki') {
            setWikiInfo({
              title: data.title as string,
              extract: data.extract as string,
              url: data.url as string | undefined,
            });
          } else if (data.type === 'story') {
            setStory(prev => prev + (data.chunk as string));
          } else if (data.type === 'error') {
            setError(data.message as string);
          }
        }
      }
    } catch (err) {
      // An abort is this component superseding itself, not a failure.
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      // Runs for every exit path — a `done` event, an `error` event, a stream
      // that ends early, or a thrown request. Previously only `done` cleared
      // this, so any failure left the Generate button disabled for good.
      if (isCurrent()) {
        setIsLoading(false);
        inFlight.current = null;
      }
    }
  }, []);

  // Generate a story automatically when the component mounts. The cleanup
  // cancels the request, so StrictMode's second mount replaces the first
  // stream instead of racing it.
  useEffect(() => {
    generateStory();
    return () => inFlight.current?.abort();
  }, [generateStory]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <BookOpen className="w-12 h-12 text-purple-600" />
            <h1 className="text-5xl font-bold text-gray-800">WikiStory</h1>
            <Sparkles className="w-12 h-12 text-blue-600" />
          </div>
          <p className="text-gray-600 text-lg">
            Random Wikipedia articles transformed into creative stories by AI
          </p>
        </div>

        <div className="text-center mb-8">
          <button
            onClick={generateStory}
            disabled={isLoading}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold py-3 px-8 rounded-lg shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Generating...' : 'Generate New Story'}
          </button>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6">
            <strong>Error:</strong> {error}
          </div>
        )}

        {wikiInfo && (
          <div className="bg-white rounded-lg shadow-xl p-6 mb-6 border-l-4 border-purple-500">
            <h2 className="text-2xl font-bold text-gray-800 mb-3 flex items-center gap-2">
              <BookOpen className="w-6 h-6 text-purple-600" />
              Wikipedia Article:{' '}
              {wikiInfo.url ? (
                <a
                  href={wikiInfo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-purple-700 hover:underline"
                >
                  {wikiInfo.title}
                </a>
              ) : (
                wikiInfo.title
              )}
            </h2>
            <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{wikiInfo.extract}</p>
          </div>
        )}

        {story && (
          <div className="bg-white rounded-lg shadow-xl p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-blue-600" />
              AI Generated Story
            </h2>
            <div className="text-lg text-gray-700">
              <Markdown components={storyMarkdown}>{story}</Markdown>
              {isLoading && (
                <span className="inline-block w-2 h-5 bg-blue-600 animate-pulse align-text-bottom" />
              )}
            </div>
          </div>
        )}

        {!wikiInfo && !story && isLoading && (
          <div className="text-center text-gray-400 mt-12">
            <p className="text-xl flex items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin" />
              Loading your first story...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
