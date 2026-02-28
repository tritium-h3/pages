import { useState, useEffect } from 'react';
import { BookOpen, Sparkles, RefreshCw } from 'lucide-react';
import { apiUrl } from './backendApi';

interface WikiInfo {
  title: string;
  extract: string;
}

export default function WikiStory() {
  const [wikiInfo, setWikiInfo] = useState<WikiInfo | null>(null);
  const [story, setStory] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateStory = async () => {
    setIsLoading(true);
    setError(null);
    setWikiInfo(null);
    setStory('');

    try {
      const response = await fetch(apiUrl('/wikipedia-story'));

      if (!response.ok) {
        throw new Error('Failed to fetch story');
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
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'wiki') {
              setWikiInfo({ title: data.title, extract: data.extract });
            } else if (data.type === 'story') {
              setStory(prev => prev + data.chunk);
            } else if (data.type === 'error') {
              setError(data.message);
            } else if (data.type === 'done') {
              setIsLoading(false);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsLoading(false);
    }
  };

  // Generate a story automatically when the component mounts
  useEffect(() => {
    generateStory();
  }, []);

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
              Wikipedia Article: {wikiInfo.title}
            </h2>
            <p className="text-gray-600 leading-relaxed">{wikiInfo.extract}</p>
          </div>
        )}

        {story && (
          <div className="bg-white rounded-lg shadow-xl p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-blue-600" />
              AI Generated Story
            </h2>
            <div className="prose prose-lg max-w-none">
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                {story}
                {isLoading && <span className="inline-block w-2 h-5 bg-blue-600 animate-pulse ml-1" />}
              </p>
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
