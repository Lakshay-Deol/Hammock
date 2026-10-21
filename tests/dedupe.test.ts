import { describe, it, expect } from 'vitest';
import { HammockRepository, cosineSimilarity } from '../src/db/index.js';
import { ReplayEmbeddingClient } from '../src/model/embedding.js';
import { ReplayModelClient } from '../src/model/replay.js';
import { findAndAdjudicateDuplicates } from '../src/model/dedupe.js';
import { runDedupeBenchmark } from '../src/model/eval-dedupe.js';
import type { Issue } from '../src/types/schemas.js';

describe('Embeddings & Cosine Similarity', () => {
  it('computes unit vectors and high cosine similarity for semantic duplicates', async () => {
    const embedClient = new ReplayEmbeddingClient();

    const textA = 'Unhandled promise rejection during graceful shutdown with keep-alive connections';
    const textB = 'Graceful shutdown fails when keep-alive HTTP client stays connected';
    const textUnrelated = 'Feature Request: Support exponential backoff in worker retry strategy';

    const [vecA, vecB, vecC] = await embedClient.embedBatch([textA, textB, textUnrelated]);

    expect(vecA).toBeDefined();
    expect(vecB).toBeDefined();
    expect(vecC).toBeDefined();

    const simDuplicate = cosineSimilarity(vecA!, vecB!);
    const simUnrelated = cosineSimilarity(vecA!, vecC!);

    expect(simDuplicate).toBeGreaterThan(0.85);
    expect(simUnrelated).toBeLessThan(0.3);
  });

  it('stores and retrieves issue embeddings in SQLite', () => {
    const repo = new HammockRepository(':memory:');

    const issue: Issue = {
      id: 'issue-embed-1',
      repo: 'acme/test',
      number: 1,
      title: 'Graceful shutdown issue',
      body: 'Detailed body',
      author: 'alice',
      state: 'open',
      labels: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    repo.saveIssue(issue);
    repo.saveEmbedding(issue.id, 'nomic-embed-text', [0.1, 0.2, 0.3]);

    const retrieved = repo.getEmbedding(issue.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.length).toBe(3);
    expect(retrieved?.[0]).toBeCloseTo(0.1);

    repo.close();
  });
});

describe('Hybrid Deduplication Engine', () => {
  it('identifies known duplicate pairs and produces evidence', async () => {
    const repo = new HammockRepository(':memory:');
    const embedClient = new ReplayEmbeddingClient();
    const modelClient = new ReplayModelClient();

    const issue1: Issue = {
      id: 'issue-001',
      repo: 'acme/sandbox',
      number: 1,
      title: 'Unhandled promise rejection during graceful shutdown with keep-alive connections',
      body: 'When calling server.close() with active keep-alive connections...',
      author: 'dev',
      state: 'open',
      labels: ['bug'],
      created_at: '2026-10-20T10:00:00Z',
      updated_at: '2026-10-20T10:00:00Z',
    };

    const issue5: Issue = {
      id: 'issue-005',
      repo: 'acme/sandbox',
      number: 5,
      title: 'Graceful shutdown fails when keep-alive HTTP client stays connected',
      body: 'When sending SIGINT with keepalive HTTP client...',
      author: 'tester',
      state: 'open',
      labels: ['bug'],
      created_at: '2026-10-20T12:00:00Z',
      updated_at: '2026-10-20T12:00:00Z',
    };

    repo.saveIssue(issue1);
    const vec1 = await embedClient.embed(`${issue1.title} ${issue1.body}`);
    repo.saveEmbedding(issue1.id, embedClient.name, vec1);

    const candidates = await findAndAdjudicateDuplicates(issue5, repo, modelClient, embedClient, 3);

    expect(candidates.length).toBe(1);
    expect(candidates[0]?.candidate_issue_id).toBe('issue-001');
    expect(candidates[0]?.is_duplicate).toBe(true);
    expect(candidates[0]?.confidence).toBeGreaterThan(0.8);
    expect(candidates[0]?.evidence).toContain('graceful server shutdown');

    repo.close();
  });

  it('meets PLAN.md benchmark target (precision >= 0.8 at recall >= 0.5)', async () => {
    const { metrics } = await runDedupeBenchmark(undefined, true);

    expect(metrics.totalPairs).toBeGreaterThanOrEqual(8);
    expect(metrics.precision).toBeGreaterThanOrEqual(0.8);
    expect(metrics.recall).toBeGreaterThanOrEqual(0.5);
    expect(metrics.falsePositives).toBe(0);
  });
});
