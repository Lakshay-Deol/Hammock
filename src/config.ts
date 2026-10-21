import { z } from 'zod';

export const EnvSchema = z.object({
  HAMMOCK_DRY_RUN: z.string().default('1').transform((v) => v === '1' || v === 'true'),
  HAMMOCK_SANDBOX_REPO: z.string().default(''),
  GITHUB_TOKEN: z.string().optional().default(''),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('gemma4:e4b'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
  HAMMOCK_REPLAY: z.string().default('0').transform((v) => v === '1' || v === 'true'),
  HAMMOCK_DB_PATH: z.string().default('./hammock.db'),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(overrides?: Partial<Record<string, string>>): Config {
  const raw = {
    HAMMOCK_DRY_RUN: overrides?.HAMMOCK_DRY_RUN ?? process.env['HAMMOCK_DRY_RUN'] ?? '1',
    HAMMOCK_SANDBOX_REPO: overrides?.HAMMOCK_SANDBOX_REPO ?? process.env['HAMMOCK_SANDBOX_REPO'] ?? '',
    GITHUB_TOKEN: overrides?.GITHUB_TOKEN ?? process.env['GITHUB_TOKEN'] ?? '',
    OLLAMA_BASE_URL: overrides?.OLLAMA_BASE_URL ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
    OLLAMA_MODEL: overrides?.OLLAMA_MODEL ?? process.env['OLLAMA_MODEL'] ?? 'gemma4:e4b',
    OLLAMA_EMBED_MODEL: overrides?.OLLAMA_EMBED_MODEL ?? process.env['OLLAMA_EMBED_MODEL'] ?? 'nomic-embed-text',
    HAMMOCK_REPLAY: overrides?.HAMMOCK_REPLAY ?? process.env['HAMMOCK_REPLAY'] ?? '0',
    HAMMOCK_DB_PATH: overrides?.HAMMOCK_DB_PATH ?? process.env['HAMMOCK_DB_PATH'] ?? './hammock.db',
  };

  return EnvSchema.parse(raw);
}

export const config = loadConfig();
