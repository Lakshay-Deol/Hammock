import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ApprovalService } from '../approval/service.js';
import { HammockRepository } from '../db/index.js';
import { getAuthAdapter } from '../auth/index.js';
import { config } from '../config.js';

export function createHammockServer(): Hono {
  const app = new Hono();
  const repo = new HammockRepository(config.HAMMOCK_DB_PATH);
  const approvalService = new ApprovalService(repo);
  const authAdapter = getAuthAdapter();

  app.use('*', cors());

  // API 1: List pending proposals
  app.get('/api/proposals', (c) => {
    const proposals = approvalService.getPendingProposals();
    return c.json({ proposals });
  });

  // API 2: Approve proposal
  app.post('/api/proposals/:id/approve', async (c) => {
    const id = c.req.param('id');
    const authHeader = c.req.header('Authorization');
    const auth = await authAdapter.validateAuthorization(authHeader);

    if (!auth.authorized) {
      return c.json({ error: 'Unauthorized maintainer approval tap' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const editedText = typeof body['editedText'] === 'string' ? body['editedText'] : undefined;

    try {
      const receipt = await approvalService.approveProposal(id, auth.actor, editedText);
      return c.json({ success: true, receipt });
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  });

  // API 3: Reject proposal
  app.post('/api/proposals/:id/reject', async (c) => {
    const id = c.req.param('id');
    const authHeader = c.req.header('Authorization');
    const auth = await authAdapter.validateAuthorization(authHeader);

    if (!auth.authorized) {
      return c.json({ error: 'Unauthorized maintainer approval tap' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const reason = typeof body['reason'] === 'string' ? body['reason'] : 'Rejected by maintainer tap';

    try {
      const receipt = await approvalService.rejectProposal(id, auth.actor, reason);
      return c.json({ success: true, receipt });
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  });

  // API 4: Receipts log
  app.get('/api/receipts', (c) => {
    const receipts = repo.getAllReceipts();
    return c.json({ receipts });
  });

  // API 5: Statistics for "The Lazy Payoff"
  app.get('/api/stats', (c) => {
    const stats = repo.getStats();
    return c.json({
      stats,
      authMode: authAdapter.name,
      dryRun: config.HAMMOCK_DRY_RUN,
      sandboxRepo: config.HAMMOCK_SANDBOX_REPO,
    });
  });

  // Dashboard Frontend UI
  app.get('/', (c) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hammock — Approval Queue & Receipts</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --surface: #111726;
      --surface-border: #1e293b;
      --surface-hover: #182238;
      --primary: #38bdf8;
      --primary-glow: rgba(56, 189, 248, 0.15);
      --accent: #818cf8;
      --success: #34d399;
      --warning: #fbbf24;
      --danger: #f87171;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --font: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      --mono: 'JetBrains Mono', monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      min-height: 100vh;
      padding: 2rem;
      line-height: 1.5;
    }

    .container { max-width: 1200px; margin: 0 auto; }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 2rem;
      border-bottom: 1px solid var(--surface-border);
      margin-bottom: 2rem;
    }

    .logo-group { display: flex; align-items: center; gap: 1rem; }
    .logo-icon { font-size: 2.5rem; }
    h1 { font-size: 1.75rem; font-weight: 700; letter-spacing: -0.02em; }
    .subtitle { color: var(--text-muted); font-size: 0.875rem; }

    .badges { display: flex; gap: 0.5rem; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      border: 1px solid var(--surface-border);
      background: var(--surface);
    }
    .badge-dry { color: var(--warning); border-color: rgba(251, 191, 36, 0.3); }
    .badge-auth { color: var(--primary); border-color: rgba(56, 189, 248, 0.3); }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-bottom: 2.5rem;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      padding: 1.25rem;
      border-radius: 12px;
      position: relative;
      overflow: hidden;
    }
    .stat-val { font-size: 2rem; font-weight: 700; color: var(--text); font-family: var(--mono); }
    .stat-label { font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem; }

    /* Nav Tabs */
    .tabs { display: flex; gap: 1rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--surface-border); }
    .tab-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.9375rem;
      font-weight: 600;
      padding: 0.75rem 0.5rem;
      cursor: pointer;
      position: relative;
      font-family: var(--font);
    }
    .tab-btn.active { color: var(--primary); }
    .tab-btn.active::after {
      content: '';
      position: absolute;
      bottom: -1px; left: 0; right: 0;
      height: 2px;
      background: var(--primary);
    }

    /* Proposal Cards */
    .proposal-card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      transition: border-color 0.2s;
    }
    .proposal-card:hover { border-color: rgba(56, 189, 248, 0.4); }

    .prop-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1rem;
    }
    .prop-title { font-size: 1.125rem; font-weight: 600; color: #fff; }
    .prop-meta { font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem; }

    .prop-action {
      font-family: var(--mono);
      font-size: 0.75rem;
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      background: rgba(129, 140, 248, 0.15);
      color: var(--accent);
      border: 1px solid rgba(129, 140, 248, 0.3);
    }

    .draft-box {
      margin: 1rem 0;
      background: #090d16;
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      padding: 1rem;
    }
    .draft-textarea {
      width: 100%;
      background: transparent;
      border: none;
      color: var(--text);
      font-family: var(--mono);
      font-size: 0.875rem;
      resize: vertical;
      min-height: 110px;
      outline: none;
      line-height: 1.6;
    }

    .btn-group { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; }
    .btn {
      padding: 0.5rem 1.25rem;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
      font-family: var(--font);
    }
    .btn-approve {
      background: #10b981;
      color: #022c22;
    }
    .btn-approve:hover { background: #34d399; }
    .btn-reject {
      background: transparent;
      border: 1px solid rgba(248, 113, 113, 0.4);
      color: var(--danger);
    }
    .btn-reject:hover { background: rgba(248, 113, 113, 0.1); }

    /* Receipts Table */
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.875rem; }
    th { text-align: left; padding: 0.75rem 1rem; border-bottom: 1px solid var(--surface-border); color: var(--text-muted); }
    td { padding: 0.875rem 1rem; border-bottom: 1px solid var(--surface-border); font-family: var(--mono); }
    tr:hover td { background: var(--surface-hover); }

    .diff-badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .diff-unedited { background: rgba(52, 211, 153, 0.15); color: var(--success); }
    .diff-edited { background: rgba(251, 191, 36, 0.15); color: var(--warning); }
    .diff-rejected { background: rgba(248, 113, 113, 0.15); color: var(--danger); }
    .diff-auto { background: rgba(56, 189, 248, 0.15); color: var(--primary); }

    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--text-muted);
      border: 1px dashed var(--surface-border);
      border-radius: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-group">
        <div class="logo-icon">🦥</div>
        <div>
          <h1>Hammock Triage Gate</h1>
          <div class="subtitle">Reversible alone. Visible never. Approval-gated issue triage with Gemma 4.</div>
        </div>
      </div>
      <div class="badges">
        <span class="badge badge-dry" id="badge-dry">HAMMOCK_DRY_RUN=1</span>
        <span class="badge badge-auth" id="badge-auth">Auth0 / Local Gate</span>
      </div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-val" id="stat-pending">0</div>
        <div class="stat-label">Pending Maintainer Taps</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" id="stat-approved">0</div>
        <div class="stat-label">Approved (Unedited)</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" id="stat-edited">0</div>
        <div class="stat-label">Approved (With Edits)</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" id="stat-rejected">0</div>
        <div class="stat-label">Rejected (Zero Repo Trace)</div>
      </div>
    </div>

    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab('queue')">Pending Approval Queue (<span id="queue-count">0</span>)</button>
      <button class="tab-btn" onclick="switchTab('receipts')">Receipts Audit Log</button>
    </div>

    <div id="tab-queue">
      <div id="proposals-list">
        <div class="empty-state">Loading pending triage decisions...</div>
      </div>
    </div>

    <div id="tab-receipts" style="display: none;">
      <div style="background: var(--surface); border: 1px solid var(--surface-border); border-radius: 12px; overflow: hidden;">
        <table>
          <thead>
            <tr>
              <th>Receipt ID</th>
              <th>Issue ID</th>
              <th>Action</th>
              <th>Outcome</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody id="receipts-tbody">
            <tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">Loading receipts...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    async function loadStats() {
      const res = await fetch('/api/stats');
      const data = await res.json();
      document.getElementById('stat-pending').innerText = data.stats.pendingProposals;
      document.getElementById('stat-approved').innerText = data.stats.approvedUnedited;
      document.getElementById('stat-edited').innerText = data.stats.approvedEdited;
      document.getElementById('stat-rejected').innerText = data.stats.rejected;
      document.getElementById('queue-count').innerText = data.stats.pendingProposals;

      document.getElementById('badge-dry').innerText = data.dryRun ? 'DRY-RUN (Safe)' : 'LIVE WRITES';
      document.getElementById('badge-auth').innerText = data.authMode;
    }

    async function loadProposals() {
      const res = await fetch('/api/proposals');
      const data = await res.json();
      const container = document.getElementById('proposals-list');

      if (!data.proposals || data.proposals.length === 0) {
        container.innerHTML = '<div class="empty-state">✨ No pending triage decisions. Your morning queue is clean!</div>';
        return;
      }

      container.innerHTML = data.proposals.map(p => {
        const issue = p.issue || { number: '?', title: 'Unknown Issue', author: 'anonymous' };
        const bodyText = p.payload.body || JSON.stringify(p.payload, null, 2);

        return \`
          <div class="proposal-card" id="card-\${p.proposal.id}">
            <div class="prop-header">
              <div>
                <div class="prop-title">#\${issue.number} — \${issue.title}</div>
                <div class="prop-meta">Author: @\${issue.author} • Proposal ID: \${p.proposal.id} • Risk: \${p.proposal.risk.toUpperCase()}</div>
              </div>
              <span class="prop-action">\${p.proposal.action.toUpperCase()}</span>
            </div>

            <div class="draft-box">
              <textarea class="draft-textarea" id="text-\${p.proposal.id}">\${bodyText}</textarea>
            </div>

            <div class="btn-group">
              <button class="btn btn-reject" onclick="decide('\${p.proposal.id}', false)">Reject & Discard</button>
              <button class="btn btn-approve" onclick="decide('\${p.proposal.id}', true)">Approve & Post</button>
            </div>
          </div>
        \`;
      }).join('');
    }

    async function loadReceipts() {
      const res = await fetch('/api/receipts');
      const data = await res.json();
      const tbody = document.getElementById('receipts-tbody');

      if (!data.receipts || data.receipts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">No receipts generated yet.</td></tr>';
        return;
      }

      tbody.innerHTML = data.receipts.map(r => {
        let badgeClass = 'diff-unedited';
        if (r.outcome === 'approved_edited') badgeClass = 'diff-edited';
        if (r.outcome === 'rejected') badgeClass = 'diff-rejected';
        if (r.outcome === 'auto_applied') badgeClass = 'diff-auto';

        return \`
          <tr>
            <td>\${r.id}</td>
            <td>\${r.issue_id}</td>
            <td>\${r.action}</td>
            <td><span class="diff-badge \${badgeClass}">\${r.outcome}</span></td>
            <td>\${new Date(r.created_at).toLocaleTimeString()}</td>
          </tr>
        \`;
      }).join('');
    }

    async function decide(proposalId, isApproved) {
      const card = document.getElementById('card-' + proposalId);
      if (card) card.style.opacity = '0.5';

      const url = isApproved ? \`/api/proposals/\${proposalId}/approve\` : \`/api/proposals/\${proposalId}/reject\`;
      const editedText = isApproved ? document.getElementById('text-' + proposalId).value : undefined;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editedText, reason: 'Decided via Hammock maintainer dashboard' })
      });

      if (res.ok) {
        if (card) card.remove();
        loadStats();
        loadReceipts();
      } else {
        alert('Action failed: ' + (await res.text()));
        if (card) card.style.opacity = '1';
      }
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      if (tab === 'queue') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('tab-queue').style.display = 'block';
        document.getElementById('tab-receipts').style.display = 'none';
        loadProposals();
      } else {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('tab-queue').style.display = 'none';
        document.getElementById('tab-receipts').style.display = 'block';
        loadReceipts();
      }
    }

    loadStats();
    loadProposals();
  </script>
</body>
</html>`;
    return c.html(html);
  });

  return app;
}
