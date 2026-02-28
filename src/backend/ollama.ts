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
   * Generate text from a prompt (non-streaming)
   */
  async generate(request: OllamaGenerateRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
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
      throw new Error(`Failed to generate: ${response.statusText}`);
    }

    const data = await response.json() as OllamaGenerateResponse;
    return data.response;
  }

  /**
   * Generate text from a prompt with streaming
   * Returns an async generator that yields text chunks
   */
  async *generateStream(request: OllamaGenerateRequest): AsyncGenerator<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...request,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to generate stream: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const json: OllamaGenerateResponse = JSON.parse(line);
            if (json.response) {
              yield json.response;
            }
          } catch (e) {
            console.error('Failed to parse JSON:', line, e);
          }
        }
      }
    } finally {
      reader.releaseLock();
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
  async *chatStream(request: OllamaChatRequest): AsyncGenerator<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...request,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to chat stream: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const json: OllamaChatResponse = JSON.parse(line);
            if (json.message && json.message.content) {
              yield json.message.content;
            }
          } catch (e) {
            console.error('Failed to parse JSON:', line, e);
          }
        }
      }
    } finally {
      reader.releaseLock();
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
