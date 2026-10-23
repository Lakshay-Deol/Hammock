import { describe, it, expect, beforeEach } from 'vitest';
import {
  fetchIssuesActivity,
  triageIssueActivity,
  applyAllowlistActivity,
  saveRunDigestActivity,
} from '../src/temporal/activities.js';
import { HammockRepository } from '../src/db/index.js';
import { config } from '../src/config.js';
import type { Issue, VerdictOutput, DuplicateCandidate, DraftReply } from '../src/types/schemas.js';

describe('Temporal Activities & Idempotent Fetch', () => {
  const sandboxRepo = 'acme/hammock-sandbox';

  beforeEach(() => {
    config.HAMMOCK_SANDBOX_REPO = sandboxRepo;
    config.HAMMOCK_DRY_RUN = true;
  });

  it('fetchIssuesActivity performs idempotent fetch using since filter', async () => {
    const allResult = await fetchIssuesActivity({ repo: sandboxRepo });
    expect(allResult.issues.length).toBeGreaterThanOrEqual(5);
    expect(allResult.notModified).toBe(false);

    // Using future since timestamp
    const futureResult = await fetchIssuesActivity({
      repo: sandboxRepo,
      since: '2099-01-01T00:00:00Z',
    });
    expect(futureResult.issues.length).toBe(0);
  },30000);

  it('triageIssueActivity produces verdict, embedding, and draft reply', async () => {
    const issue: Issue = {
      id: 'issue-temp-1',
      repo: sandboxRepo,
      number: 101,
      title: 'Crash on graceful shutdown with keep-alive connections',
      body: 'Server aborts on SIGINT.',
      author: 'contributor-1',
      state: 'open',
      labels: ['bug'],
      created_at: '2026-10-20T10:00:00Z',
      updated_at: '2026-10-20T10:00:00Z',
    };

    const res = await triageIssueActivity({ issue, runId: 'run-test-1' });

    expect(res.issueId).toBe('issue-temp-1');
    expect(res.verdict.type).toBe('bug');
    expect(res.draft.questions.length).toBeGreaterThanOrEqual(1);

    const repo = new HammockRepository(config.HAMMOCK_DB_PATH);
    try {
      const storedEmbedding = repo.getEmbedding('issue-temp-1');
      expect(storedEmbedding).not.toBeNull();
      expect(storedEmbedding?.length).toBeGreaterThan(0);
    } finally {
      repo.close();
    }
  },30000);

  it('applyAllowlistActivity enforces policy allowlist and gates comments', async () => {
    const issue: Issue = {
      id: 'issue-temp-2',
      repo: sandboxRepo,
      number: 102,
      title: 'Documentation error',
      body: 'Broken link',
      author: 'contributor-2',
      state: 'open',
      labels: [],
      created_at: '2026-10-20T11:00:00Z',
      updated_at: '2026-10-20T11:00:00Z',
    };

    const verdict: VerdictOutput = {
      type: 'documentation',
      severity: 'low',
      confidence: 0.95,
      missing_info: ['page url'],
      suggested_labels: ['bug', 'security', 'needs-info'], // 'security' is in policy labels.never!
      summary: 'Broken link in docs',
      injection_suspected: false,
    };

    const candidates: DuplicateCandidate[] = [];
    const draft: DraftReply = {
      issue_id: issue.id,
      tone: 'warm-professional',
      reply: 'Hi, please provide the URL.',
      questions: ['What is the exact URL?'],
    };

    const actionRes = await applyAllowlistActivity({
      issue,
      verdict,
      candidates,
      draft,
      runId: 'run-test-allowlist',
    });

    // 'bug' and 'needs-info' are in auto list; 'security' is in never list!
    expect(actionRes.appliedLabels).toContain('bug');
    expect(actionRes.appliedLabels).toContain('needs-info');
    expect(actionRes.appliedLabels).not.toContain('security');

    // Comment draft must be queued as pending proposal, never executed directly!
    expect(actionRes.queuedProposals.length).toBe(1);

    const repo = new HammockRepository(config.HAMMOCK_DB_PATH);
    try {
      const proposal = repo.getProposal(actionRes.queuedProposals[0]!);
      expect(proposal).not.toBeNull();
      expect(proposal?.status).toBe('pending');
      expect(proposal?.action).toBe('comment');
    } finally {
      repo.close();
    }
  },30000);

  it('saveRunDigestActivity records run summary accurately', async () => {
    const digest = await saveRunDigestActivity({
      runId: 'run-digest-test',
      repo: sandboxRepo,
      totalIssues: 6,
      labelsApplied: 8,
      proposalsQueued: 5,
      duplicatesFound: 1,
    });

    expect(digest.runId).toBe('run-digest-test');
    expect(digest.totalIssues).toBe(6);
    expect(digest.labelsApplied).toBe(8);
    expect(digest.completedAt).toBeDefined();
  },30000);
});
