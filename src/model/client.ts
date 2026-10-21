import type { Issue, VerdictOutput } from '../types/schemas.js';

export interface VerdictResult {
  verdict: VerdictOutput;
  rawJson: string;
  latencyMs: number;
  tokensPerSec?: number;
  evalCount?: number;
  evalDurationNs?: number;
}

export interface ModelClient {
  name: string;
  classifyIssue(issue: Issue): Promise<VerdictResult>;
  checkHealth(): Promise<{ ok: boolean; message: string }>;
}
