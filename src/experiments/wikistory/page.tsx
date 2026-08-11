import { useState, useEffect, useRef, useCallback } from 'react';
import { BookOpen, Sparkles, RefreshCw } from 'lucide-react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { apiUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../platform/manifest.js';
import type { WikiStoryEvent } from './types.js';
import styles from './wikistory.module.css';

interface WikiInfo {
  title: string;
  extract: string;
  url?: string;
}

// The model writes markdown — mostly **bold** and *emphasis* with blank-line
// paragraph breaks, occasionally a heading or list. Every element renders bare
// (no className hooks) and is styled off the `.story` wrapper in
// wikistory.module.css; this map only remaps heading levels so the model's
// headings read as sub-sections of "AI Generated Story" rather than new
// page-level headings, and adds target="_blank" to links.
const storyMarkdown: Components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h4>{children}</h4>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

export default function WikiStoryPage(_props: ExperimentPageProps) {
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
      const response = await fetch(apiUrl('wikistory', '/'), {
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

          let data: WikiStoryEvent;
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            // A single malformed event shouldn't abandon the whole story.
            console.warn('Skipping unparseable SSE line:', line);
            continue;
          }

          if (data.type === 'wiki') {
            setWikiInfo({
              title: data.title,
              extract: data.extract,
              url: data.url,
            });
          } else if (data.type === 'story') {
            setStory(prev => prev + data.chunk);
          } else if (data.type === 'error') {
            setError(data.message);
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
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <BookOpen className={styles.titleIcon} />
          <h1 className={styles.title}>WikiStory</h1>
          <Sparkles className={styles.titleIcon} />
        </div>
        <p className={styles.subtitle}>
          Random Wikipedia articles transformed into creative stories by AI
        </p>
      </div>

      <div className={styles.controls}>
        <button
          onClick={generateStory}
          disabled={isLoading}
          className={styles.generateButton}
        >
          <RefreshCw className={`${styles.buttonIcon} ${isLoading ? styles.spin : ''}`} />
          {isLoading ? 'Generating...' : 'Generate New Story'}
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {wikiInfo && (
        <div className={styles.wikiCard}>
          <h2 className={styles.wikiTitle}>
            <BookOpen className={styles.headingIcon} />
            Wikipedia Article:{' '}
            {wikiInfo.url ? (
              <a
                href={wikiInfo.url}
                target="_blank"
                rel="noreferrer"
                className={styles.wikiLink}
              >
                {wikiInfo.title}
              </a>
            ) : (
              wikiInfo.title
            )}
          </h2>
          <p className={styles.wikiExtract}>{wikiInfo.extract}</p>
        </div>
      )}

      {story && (
        <div className={styles.storyCard}>
          <h2 className={styles.storyTitle}>
            <Sparkles className={styles.headingIcon} />
            AI Generated Story
          </h2>
          <div className={styles.story}>
            <Markdown components={storyMarkdown}>{story}</Markdown>
            {isLoading && <span className={styles.cursor} />}
          </div>
        </div>
      )}

      {!wikiInfo && !story && isLoading && (
        <div className={styles.loadingState}>
          <p className={styles.loadingText}>
            <RefreshCw className={`${styles.icon} ${styles.spin}`} />
            Loading your first story...
          </p>
        </div>
      )}
    </div>
  );
}
