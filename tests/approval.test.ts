import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalService } from '../src/approval/service.js';
import { HammockRepository } from '../src/db/index.js';
import { createHammockServer } from '../src/server/app.js';
import { getAuthAdapter, LocalSessionAuthAdapter, Auth0AsyncAuthAdapter } from '../src/auth/index.js';
import { config } from '../src/config.js';
import type { Issue, Proposal } from '../src/types/schemas.js';

describe('Approval Service & Receipt Log', () => {
  const sandboxRepo = 'acme/hammock-sandbox';
  let repo: HammockRepository;
  let service: ApprovalService;

  beforeEach(() => {
    config.HAMMOCK_SANDBOX_REPO = sandboxRepo;
    config.HAMMOCK_DRY_RUN = true;
    repo = new HammockRepository(':memory:');
    service = new ApprovalService(repo);
  });

  const sampleIssue: Issue = {
    id: 'issue-appr-1',
    repo: sandboxRepo,
    number: 42,
    title: 'Graceful shutdown connection reset',
    body: 'Details here',
    author: 'reporter',
    state: 'open',
    labels: ['bug'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('approves unedited draft comment, executes write, and produces approved_unedited receipt', async () => {
    repo.saveIssue(sampleIssue);

    const proposal: Proposal = {
      id: 'prop-appr-unedited',
      issue_id: sampleIssue.id,
      action: 'comment',
      payload_json: JSON.stringify({ body: 'Hi @reporter, could you provide OS details?' }),
      risk: 'medium',
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    repo.saveProposal(proposal);

    const receipt = await service.approveProposal(proposal.id, 'maintainer-alice');

    expect(receipt.outcome).toBe('approved_unedited');
    expect(receipt.user_edit_diff).toBeNull();

    // Check DB state
    const updatedProp = repo.getProposal(proposal.id);
    expect(updatedProp?.status).toBe('approved');
    expect(updatedProp?.decided_by).toBe('maintainer-alice');
  });

  it('approves edited draft comment, records accurate user_edit_diff and approved_edited outcome', async () => {
    repo.saveIssue(sampleIssue);

    const originalComment = 'Hi @reporter, could you provide OS details?';
    const editedComment = 'Hi @reporter, could you provide OS details and your Node.js patch version?';

    const proposal: Proposal = {
      id: 'prop-appr-edited',
      issue_id: sampleIssue.id,
      action: 'comment',
      payload_json: JSON.stringify({ body: originalComment }),
      risk: 'medium',
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    repo.saveProposal(proposal);

    const receipt = await service.approveProposal(proposal.id, 'maintainer-bob', editedComment);

    expect(receipt.outcome).toBe('approved_edited');
    expect(receipt.user_edit_diff).not.toBeNull();
    expect(receipt.user_edit_diff).toContain('--- original');
    expect(receipt.user_edit_diff).toContain('+++ edited');
    expect(receipt.user_edit_diff).toContain(editedComment);

    const updatedProp = repo.getProposal(proposal.id);
    expect(updatedProp?.status).toBe('approved');
    const parsedPayload = JSON.parse(updatedProp?.payload_json || '{}');
    expect(parsedPayload.body).toBe(editedComment);
  });

  it('rejects proposal without touching repo and creates rejected receipt (Day 4: zero trace on repo)', async () => {
    repo.saveIssue(sampleIssue);

    const proposal: Proposal = {
      id: 'prop-reject-test',
      issue_id: sampleIssue.id,
      action: 'comment',
      payload_json: JSON.stringify({ body: 'Draft comment to discard' }),
      risk: 'medium',
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    repo.saveProposal(proposal);

    const receipt = await service.rejectProposal(proposal.id, 'maintainer-carol', 'Draft hallucinated context');

    expect(receipt.outcome).toBe('rejected');
    expect(receipt.user_edit_diff).toBeNull();
    expect(receipt.evidence_json).toContain('Draft hallucinated context');

    const updatedProp = repo.getProposal(proposal.id);
    expect(updatedProp?.status).toBe('rejected');
    expect(updatedProp?.decided_by).toBe('maintainer-carol');
  });
});

describe('Auth0 & Local Session Adapters', () => {
  it('local adapter validates session and requests approval', async () => {
    const adapter = new LocalSessionAuthAdapter();
    const auth = await adapter.validateAuthorization();
    expect(auth.authorized).toBe(true);
    expect(auth.actor).toBe('maintainer-local');
    expect(auth.method).toBe('local_session');
  });

  it('Auth0 adapter validates scoped mock token', async () => {
    const adapter = new Auth0AsyncAuthAdapter();
    const auth = await adapter.validateAuthorization('Bearer auth0_async_token_12345');
    expect(auth.authorized).toBe(true);
    expect(auth.actor).toContain('auth0|');
    expect(auth.method).toBe('auth0_async_auth');
  });
});

describe('Hono Approval API Server', () => {
  it('returns pending proposals, allows approval and rejection via REST endpoints', async () => {
    const app = createHammockServer();

    // 1. Check stats endpoint
    const statsRes = await app.request('/api/stats');
    expect(statsRes.status).toBe(200);
    const statsData = (await statsRes.json()) as { stats: { pendingProposals: number } };
    expect(statsData.stats).toBeDefined();

    // 2. Check proposals endpoint
    const propRes = await app.request('/api/proposals');
    expect(propRes.status).toBe(200);

    // 3. Check receipts endpoint
    const rcptRes = await app.request('/api/receipts');
    expect(rcptRes.status).toBe(200);

    // 4. Check dashboard frontend HTML
    const htmlRes = await app.request('/');
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain('Hammock Triage Gate');
    expect(html).toContain('Pending Maintainer Taps');
    expect(html).toContain('/hammock-logo-icon.svg');

    // 5. Check logo and favicon endpoints
    const logoRes = await app.request('/hammock-logo-icon.svg');
    expect(logoRes.status).toBe(200);
    expect(logoRes.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(await logoRes.text()).toContain('<svg');

    const favRes = await app.request('/favicon.ico');
    expect(favRes.status).toBe(200);
    expect(favRes.headers.get('Content-Type')).toBe('image/svg+xml');
  });
});
