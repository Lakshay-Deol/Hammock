import { describe, it, expect } from 'vitest';
import { assertWritable, executeProposal } from '../src/github/write.js';
import { config } from '../src/config.js';
import type { Proposal } from '../src/types/schemas.js';

describe('Hard Invariants & Safety Gates', () => {
  it('Hard Invariant 2: assertWritable(repo) throws unless repo === config.HAMMOCK_SANDBOX_REPO', () => {
    // With non-matching repo
    expect(() => assertWritable('arbitrary-user/public-repo')).toThrow(
      /Safety invariant violation/
    );
  });

  it('Hard Invariant 3: executeProposal throws if comment action is not approved', async () => {
    const unapprovedCommentProposal: Proposal = {
      id: 'prop-1',
      issue_id: 'issue-001',
      action: 'comment',
      payload_json: JSON.stringify({ body: 'Draft comment response' }),
      risk: 'medium',
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    // Even if assertWritable passes, comments require approval
    // Temporarily set config.HAMMOCK_SANDBOX_REPO
    config.HAMMOCK_SANDBOX_REPO = 'acme/hammock-sandbox';

    await expect(
      executeProposal({
        proposal: unapprovedCommentProposal,
        repo: 'acme/hammock-sandbox',
        issueNumber: 1,
        actor: 'test-agent',
        runId: 'run-1',
      })
    ).rejects.toThrow(/Comments must be approval-gated/);
  });

  it('Hard Invariant 5: Dry-run returns receipt without invoking external network', async () => {
    config.HAMMOCK_SANDBOX_REPO = 'acme/hammock-sandbox';
    config.HAMMOCK_DRY_RUN = true;

    const labelProposal: Proposal = {
      id: 'prop-2',
      issue_id: 'issue-001',
      action: 'label',
      payload_json: JSON.stringify({ labels: ['bug'] }),
      risk: 'low',
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    const receipt = await executeProposal({
      proposal: labelProposal,
      repo: 'acme/hammock-sandbox',
      issueNumber: 1,
      actor: 'test-agent',
      runId: 'run-dry',
    });

    expect(receipt.id).toMatch(/^rcpt_/);
    expect(receipt.action).toBe('label');
    expect(receipt.outcome).toBe('auto_applied');
  });
});
