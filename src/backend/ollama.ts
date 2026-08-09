/**
 * Ollama API client library for backend integration
 */

const OLLAMA_BASE_URL = 'http://localhost:11434';

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  keep_alive?: string;
  images?: string[]; // base64-encoded images for vision models
  format?: 'json';   // constrain output to valid JSON
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream?: boolean;
  keep_alive?: string;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
  };
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaChatMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Ollama client for interacting with the Ollama server
 */
export class OllamaClient {
  private baseUrl: string;

  constructor(baseUrl: string = OLLAMA_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * List available models
   */
  async listModels(): Promise<OllamaModel[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.statusText}`);
    }
    const data = await response.json() as { models?: OllamaModel[] };
    return data.models || [];
  }

  /**
   * List model names that accept image input (vision capability), per Ollama's
   * /api/show capabilities. Sorted alphabetically.
   */
  async listVisionModels(): Promise<string[]> {
    const models = await this.listModels();
    const checked = await Promise.all(
      models.map(async (m) => {
        try {
          const response = await fetch(`${this.baseUrl}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: m.name }),
          });
          if (!response.ok) return null;
          const data = (await response.json()) as { capabilities?: string[] };
          return data.capabilities?.includes('vision') ? m.name : null;
        } catch {
          return null;
        }
      })
    );
    return checked.filter((name): name is string => name !== null).sort();
  }

  /**
   * Generate text from a prompt (non-streaming).
   * Pass an AbortSignal to cancel the in-flight request (e.g. on client disconnect).
   */
  async generate(request: OllamaGenerateRequest, signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...request,
        stream: false,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to generate: ${response.statusText}`);
    }

    const data = await response.json() as OllamaGenerateResponse;
    return data.response;
  }

  /**
   * Read an ollama NDJSON stream, yielding one parsed object per line.
   *
   * A read from the socket is not guaranteed to end on a line boundary — long
   * messages (notably the final one, which carries the whole `context` array)
   * routinely straddle two reads. Anything left after the last newline is held
   * back and prefixed onto the next read, so no message is ever parsed from a
   * half-received line.
   */
  private async *streamNdjson<T>(url: string, body: unknown, signal?: AbortSignal): AsyncGenerator<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to stream from ${url}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const parse = (line: string): T | null => {
      if (!line.trim()) return null;
      try {
        return JSON.parse(line) as T;
      } catch (e) {
        console.error('Failed to parse JSON:', line, e);
        return null;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // The last element is whatever followed the final newline: either an
        // empty string or a partial line. Carry it into the next read.
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const json = parse(line);
          if (json) yield json;
        }
      }

      // A stream that ends without a trailing newline leaves a complete
      // message in the buffer.
      buffer += decoder.decode();
      const last = parse(buffer);
      if (last) yield last;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Generate text from a prompt with streaming
   * Returns an async generator that yields text chunks.
   * Pass an AbortSignal to cancel the in-flight generation (e.g. on client disconnect).
   */
  async *generateStream(request: OllamaGenerateRequest, signal?: AbortSignal): AsyncGenerator<string> {
    const stream = this.streamNdjson<OllamaGenerateResponse>(
      `${this.baseUrl}/api/generate`,
      { ...request, stream: true },
      signal
    );
    for await (const json of stream) {
      if (json.response) {
        yield json.response;
      }
    }
  }

  /**
   * Chat with a model (non-streaming)
   */
  async chat(request: OllamaChatRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...request,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to chat: ${response.statusText}`);
    }

    const data = await response.json() as OllamaChatResponse;
    return data.message.content;
  }

  /**
   * Chat with a model with streaming
   * Returns an async generator that yields text chunks
   */
  async *chatStream(request: OllamaChatRequest, signal?: AbortSignal): AsyncGenerator<string> {
    const stream = this.streamNdjson<OllamaChatResponse>(
      `${this.baseUrl}/api/chat`,
      { ...request, stream: true },
      signal
    );
    for await (const json of stream) {
      if (json.message && json.message.content) {
        yield json.message.content;
      }
    }
  }

  /**
   * Check if Ollama server is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Default Ollama client instance
 */
export const ollama = new OllamaClient();
