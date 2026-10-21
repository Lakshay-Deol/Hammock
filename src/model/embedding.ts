import { config } from '../config.js';

export interface EmbeddingClient {
  readonly name: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  checkHealth(): Promise<{ ok: boolean; message: string }>;
}

export class OllamaEmbeddingClient implements EmbeddingClient {
  readonly name = `ollama:${config.OLLAMA_EMBED_MODEL}`;
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = config.OLLAMA_BASE_URL, model = config.OLLAMA_EMBED_MODEL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
  }

  async checkHealth(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) {
        return { ok: false, message: `Ollama returned status ${res.status}` };
      }
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const hasModel = data.models?.some((m) => m.name.startsWith(this.model.split(':')[0] ?? 'nomic-embed-text'));
      if (!hasModel) {
        return {
          ok: false,
          message: `Model ${this.model} not found in Ollama. Run "ollama pull ${this.model}".`,
        };
      }
      return { ok: true, message: `Ollama embeddings ready (${this.model})` };
    } catch (err) {
      return { ok: false, message: `Could not connect to Ollama at ${this.baseUrl}: ${String(err)}` };
    }
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama embed call failed [${res.status}]: ${errText}`);
    }

    const data = (await res.json()) as {
      embeddings?: number[][];
      embedding?: number[];
    };

    if (data.embeddings && data.embeddings[0]) {
      return data.embeddings[0];
    }
    if (data.embedding) {
      return data.embedding;
    }
    throw new Error('Ollama embed call returned empty embeddings');
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama batch embed failed [${res.status}]: ${errText}`);
    }

    const data = (await res.json()) as { embeddings?: number[][] };
    if (!data.embeddings || data.embeddings.length !== texts.length) {
      throw new Error('Ollama batch embed returned invalid count');
    }
    return data.embeddings;
  }
}

/**
 * ReplayEmbeddingClient produces deterministic, semantic unit vectors.
 * Real adapter swapping transport for offline/test replay per Invariant 8.
 */
export class ReplayEmbeddingClient implements EmbeddingClient {
  readonly name = 'nomic-embed-text [replay]';
  private readonly dimensions = 128;

  async checkHealth(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Replay embedding client ready' };
  }

  async embed(text: string): Promise<number[]> {
    return this.generateDeterministicVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.generateDeterministicVector(t));
  }

  private generateDeterministicVector(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter(Boolean);

    // Topic clusters to ensure semantic similarity in offline replay
    const semanticClusters: Record<string, number> = {
      // Cluster 1: Shutdown & keepalive connections
      shutdown: 10,
      graceful: 10,
      keepalive: 10,
      connections: 10,
      reset: 10,
      socket: 10,
      pool: 10,
      drain: 10,
      abort: 10,
      sigint: 10,

      // Cluster 2: Retry & backoff
      retry: 25,
      exponential: 25,
      backoff: 25,
      jitter: 25,
      burst: 25,
      strategy: 25,
      interval: 25,

      // Cluster 3: WebSocket timer & memory leak
      websocket: 40,
      ws: 40,
      heartbeat: 40,
      ping: 40,
      pingtimer: 40,
      intervaltimer: 40,
      leak: 40,
      heap: 40,

      // Cluster 4: Windows paths & resolver
      windows: 55,
      backslash: 55,
      backslashes: 55,
      path: 55,
      paths: 55,
      resolver: 55,
      slashes: 55,

      // Cluster 5: CORS & headers
      cors: 70,
      wildcard: 70,
      subdomains: 70,
      credentials: 70,
      origin: 70,
      header: 70,

      // Cluster 6: Docs & migration
      doc: 85,
      documentation: 85,
      readme: 85,
      migration: 85,
      hyperlink: 85,
      guide: 85,
      '404': 85,

      // Cluster 7: Security / injection
      injection: 100,
      override: 100,
      admin: 100,
      instruction: 100,
      delete: 100,
    };

    for (const token of tokens) {
      if (semanticClusters[token] !== undefined) {
        const clusterBase = semanticClusters[token]!;
        for (let j = 0; j < 5; j++) {
          const idx = (clusterBase + j) % this.dimensions;
          vector[idx] = (vector[idx] ?? 0) + 3.0;
        }
      }

      // General hash projection for every token
      let hash = 0;
      for (let i = 0; i < token.length; i++) {
        hash = (hash << 5) - hash + token.charCodeAt(i);
        hash |= 0;
      }
      const idx = Math.abs(hash) % this.dimensions;
      vector[idx] = (vector[idx] ?? 0) + 1.0;
    }

    // Normalize to unit vector
    let magSq = 0;
    for (const val of vector) {
      magSq += val * val;
    }
    const mag = Math.sqrt(magSq);
    if (mag === 0) {
      vector[0] = 1;
      return vector;
    }
    return vector.map((v) => v / mag);
  }
}

export function getEmbeddingClient(forceReplay?: boolean): EmbeddingClient {
  if (forceReplay || config.HAMMOCK_REPLAY) {
    return new ReplayEmbeddingClient();
  }
  return new OllamaEmbeddingClient();
}
