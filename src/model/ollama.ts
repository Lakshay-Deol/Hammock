import type { Issue, VerdictOutput } from '../types/schemas.js';
import { VerdictOutputSchema } from '../types/schemas.js';
import type { ModelClient, VerdictResult } from './client.js';
import { SYSTEM_PROMPT, buildIssuePrompt, cleanModelOutput } from './prompt.js';

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
}

export class OllamaModelClient implements ModelClient {
  readonly name: string;
  private baseUrl: string;

  constructor(options?: OllamaOptions) {
    this.name = options?.model ?? 'gemma4:e4b';
    this.baseUrl = (options?.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  }

  async checkHealth(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        return { ok: false, message: `Ollama returned HTTP ${res.status}` };
      }
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const models = data.models?.map((m) => m.name) ?? [];
      const hasModel = models.some((m) => m.startsWith(this.name) || this.name.startsWith(m));
      if (!hasModel) {
        return {
          ok: false,
          message: `Ollama is running, but model "${this.name}" is not installed. Found: ${models.join(', ') || 'none'}`,
        };
      }
      return { ok: true, message: `Ollama running with model "${this.name}" ready.` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Could not connect to Ollama at ${this.baseUrl}: ${message}` };
    }
  }

  async classifyIssue(issue: Issue): Promise<VerdictResult> {
    const prompt = buildIssuePrompt(issue);
    const start = Date.now();

    const requestBody = {
      model: this.name,
      prompt,
      system: SYSTEM_PROMPT,
      format: 'json',
      stream: false,
      options: {
        temperature: 1.0,
        top_p: 0.95,
        top_k: 64,
      },
    };

    let responseText = '';
    let evalCount: number | undefined;
    let evalDurationNs: number | undefined;

    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000), // Acceptance check: <60s
      });

      if (!res.ok) {
        throw new Error(`Ollama generation failed with status ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as {
        response: string;
        eval_count?: number;
        eval_duration?: number;
      };

      responseText = data.response;
      evalCount = data.eval_count;
      evalDurationNs = data.eval_duration;
    } catch (fetchErr) {
      throw new Error(`Ollama classify error for issue #${issue.number}: ${String(fetchErr)}`);
    }

    const latencyMs = Date.now() - start;
    let cleanedJson = cleanModelOutput(responseText);
    let parsed: unknown;

    try {
      parsed = JSON.parse(cleanedJson);
    } catch (parseErr) {
      // PLAN.md §11: One retry with the parse error if JSON is malformed
      const retryBody = {
        ...requestBody,
        prompt: `${prompt}\n\nYour previous response was not valid JSON (${String(parseErr)}). Output ONLY raw valid JSON adhering strictly to the schema.`,
      };

      const retryRes = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryBody),
        signal: AbortSignal.timeout(60000),
      });

      if (!retryRes.ok) {
        throw new Error(`Ollama retry failed with HTTP ${retryRes.status}`);
      }

      const retryData = (await retryRes.json()) as { response: string; eval_count?: number; eval_duration?: number };
      cleanedJson = cleanModelOutput(retryData.response);
      parsed = JSON.parse(cleanedJson);
      if (retryData.eval_count) evalCount = retryData.eval_count;
      if (retryData.eval_duration) evalDurationNs = retryData.eval_duration;
    }

    // Validate with Zod
    const verdict = VerdictOutputSchema.parse(parsed);

    let tokensPerSec: number | undefined;
    if (evalCount && evalDurationNs && evalDurationNs > 0) {
      tokensPerSec = evalCount / (evalDurationNs / 1e9);
    }

    return {
      verdict,
      rawJson: cleanedJson,
      latencyMs,
      tokensPerSec,
      evalCount,
      evalDurationNs,
    };
  }
}
