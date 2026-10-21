import { config } from '../config.js';
import type { ModelClient } from './client.js';
import { OllamaModelClient } from './ollama.js';
import { ReplayModelClient } from './replay.js';

export function getModelClient(forceReplay?: boolean): ModelClient {
  const isReplay = forceReplay ?? config.HAMMOCK_REPLAY;
  if (isReplay) {
    return new ReplayModelClient();
  }
  return new OllamaModelClient({
    baseUrl: config.OLLAMA_BASE_URL,
    model: config.OLLAMA_MODEL,
  });
}
