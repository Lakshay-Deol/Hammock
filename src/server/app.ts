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
  <title>Hammock Triage Gate — Local Approval-Gated Issue Triage</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --orange-500: #f97316;
      --orange-600: #ea580c;
      --orange-700: #c2410c;
      --orange-glow: rgba(249, 115, 22, 0.25);
      --orange-subtle: rgba(249, 115, 22, 0.08);
      --bg-pitch: #06080c;
      --bg-dark: #0b0e14;
      --bg-surface: #10151f;
      --bg-surface-elevated: #161c28;
      --border-dark: #1e2636;
      --border-subtle: #2d3748;
      --border-orange: rgba(249, 115, 22, 0.4);
      --text-white: #f8fafc;
      --text-cream: #f5eedc;
      --text-muted: #8b98a5;
      --text-dim: #4b5868;
      --font-display: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-body: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      background: var(--bg-pitch);
      color: var(--text-white);
      font-family: var(--font-body);
      line-height: 1.6;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }

    /* Navigation Bar */
    nav {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(6, 8, 12, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border-dark);
      padding: 0.85rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .nav-brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      text-decoration: none;
      color: var(--text-white);
    }
    .nav-logo {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 1.35rem;
      letter-spacing: -0.04em;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .logo-glyph {
      background: var(--orange-500);
      color: #000;
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      font-size: 0.85rem;
      clip-path: polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%);
    }
    .nav-tag {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      letter-spacing: 0.08em;
      color: var(--orange-500);
      background: var(--orange-subtle);
      border: 1px solid var(--border-orange);
      padding: 0.15rem 0.5rem;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .nav-actions {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .nav-pill {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--text-muted);
      border: 1px solid var(--border-dark);
      padding: 0.35rem 0.75rem;
      border-radius: 4px;
      background: var(--bg-surface);
    }
    .nav-pill strong { color: var(--orange-500); }

    /* Industrial Chamfer Button */
    .btn-chamfer {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 0.65rem 1.4rem;
      background: #11141a;
      color: #fff;
      border: 1px solid #333a46;
      cursor: pointer;
      text-decoration: none;
      clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .btn-chamfer:hover {
      background: var(--orange-500);
      color: #000;
      border-color: var(--orange-500);
      transform: translateY(-1px);
      box-shadow: 0 4px 20px var(--orange-glow);
    }
    .btn-chamfer.btn-orange-solid {
      background: var(--orange-500);
      color: #06080c;
      border-color: var(--orange-500);
    }
    .btn-chamfer.btn-orange-solid:hover {
      background: #fb923c;
    }
    .btn-chamfer.btn-ghost-danger {
      background: transparent;
      color: #f87171;
      border-color: rgba(248, 113, 113, 0.3);
    }
    .btn-chamfer.btn-ghost-danger:hover {
      background: rgba(248, 113, 113, 0.15);
      border-color: #f87171;
      color: #fca5a5;
    }

    /* SECTION 1: HERO SECTION (RIG.AI VIBRANT ORANGE THEME) */
    .hero-container {
      position: relative;
      background: linear-gradient(135deg, #f97316 0%, #ea580c 45%, #c2410c 100%);
      color: var(--text-cream);
      padding: 6rem 2rem 5rem 2rem;
      overflow: hidden;
      border-bottom: 1px solid #000;
    }
    /* CRT Scanline effect */
    .hero-container::before {
      content: "";
      position: absolute;
      inset: 0;
      background: repeating-linear-gradient(
        0deg,
        rgba(0, 0, 0, 0.12),
        rgba(0, 0, 0, 0.12) 1px,
        transparent 1px,
        transparent 3px
      );
      pointer-events: none;
      z-index: 1;
    }
    /* Abstract curved contour waves */
    .hero-container::after {
      content: "";
      position: absolute;
      top: -30%;
      right: -10%;
      width: 75vw;
      height: 75vw;
      border-radius: 40%;
      border: 80px solid rgba(255, 255, 255, 0.05);
      pointer-events: none;
      z-index: 1;
      transform: rotate(25deg);
    }
    .hero-content {
      position: relative;
      z-index: 2;
      max-width: 1200px;
      margin: 0 auto;
    }
    .hero-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 3.5rem;
    }
    .hero-brand-rig {
      font-family: var(--font-display);
      font-size: 2.2rem;
      font-weight: 900;
      letter-spacing: -0.06em;
      color: #fff;
      text-transform: uppercase;
      text-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    .hero-title {
      font-family: var(--font-display);
      font-size: clamp(2.8rem, 7vw, 5.8rem);
      font-weight: 800;
      line-height: 0.98;
      letter-spacing: -0.04em;
      color: #fff;
      max-width: 950px;
      margin-bottom: 1.75rem;
      text-shadow: 0 4px 30px rgba(0,0,0,0.15);
    }
    .hero-subhead {
      font-size: clamp(1.05rem, 2vw, 1.35rem);
      font-weight: 500;
      max-width: 720px;
      line-height: 1.5;
      color: rgba(255, 255, 255, 0.92);
      margin-bottom: 2.5rem;
    }
    .hero-actions {
      display: flex;
      gap: 1rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .hero-btn-demo {
      padding: 0.9rem 2rem;
      font-size: 0.9rem;
      background: #0d1017;
      color: #fff;
      border: 1px solid #1f242e;
    }

    /* Marquee Ticker */
    .ticker-bar {
      background: #000;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-dark);
      padding: 0.75rem 0;
      overflow: hidden;
      white-space: nowrap;
      display: flex;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      letter-spacing: 0.08em;
    }
    .ticker-track {
      display: inline-flex;
      animation: ticker-slide 35s linear infinite;
    }
    .ticker-item {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0 2rem;
      color: #94a3b8;
    }
    .ticker-item strong {
      color: var(--orange-500);
      font-weight: 600;
    }
    .ticker-dot {
      color: var(--orange-500);
      font-size: 0.6rem;
    }
    @keyframes ticker-slide {
      0% { transform: translateX(0); }
      100% { transform: translateX(-50%); }
    }

    /* GLOBAL SECTION WRAPPER */
    .section-wrap {
      max-width: 1200px;
      margin: 0 auto;
      padding: 6rem 2rem;
    }
    .section-badge-center {
      text-align: center;
      margin-bottom: 1.5rem;
    }
    .tech-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      color: var(--orange-500);
      background: var(--orange-subtle);
      border: 1px solid var(--border-orange);
      padding: 0.35rem 0.9rem;
      text-transform: uppercase;
      clip-path: polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px));
    }
    .section-headline {
      font-family: var(--font-display);
      font-size: clamp(2rem, 4.5vw, 3.4rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      text-align: center;
      line-height: 1.15;
      margin-bottom: 1rem;
      color: #fff;
    }
    .section-subhead {
      text-align: center;
      font-size: 1.1rem;
      color: var(--text-muted);
      max-width: 680px;
      margin: 0 auto 4rem auto;
      line-height: 1.6;
    }

    /* SECTION 2: THE PROBLEM (RIG.AI 4-GRID + SCHEMATIC) */
    .problem-grid-layout {
      display: grid;
      grid-template-columns: 1fr 1.35fr;
      gap: 2rem;
      align-items: stretch;
    }
    @media (max-width: 960px) {
      .problem-grid-layout { grid-template-columns: 1fr; }
    }

    /* Schematic Diagram */
    .schematic-card {
      background: var(--bg-dark);
      border: 1px solid var(--border-dark);
      padding: 2.5rem 2rem;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      clip-path: polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%);
    }
    .schematic-corner-tl {
      position: absolute;
      top: 10px;
      left: 10px;
      width: 12px;
      height: 12px;
      border-top: 1px solid var(--border-subtle);
      border-left: 1px solid var(--border-subtle);
    }
    .schematic-corner-br {
      position: absolute;
      bottom: 10px;
      right: 10px;
      width: 12px;
      height: 12px;
      border-bottom: 1px solid var(--border-subtle);
      border-right: 1px solid var(--border-subtle);
    }
    .schematic-flow {
      width: 100%;
      max-width: 280px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.85rem;
      font-family: var(--font-mono);
      font-size: 0.75rem;
    }
    .schematic-node {
      width: 100%;
      padding: 0.75rem 1rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-dark);
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--text-white);
    }
    .schematic-node.highlight {
      border-color: var(--orange-500);
      background: rgba(249, 115, 22, 0.08);
      color: var(--orange-500);
      font-weight: 700;
    }
    .schematic-node.danger-point {
      border-color: #ef4444;
      background: rgba(239, 68, 68, 0.08);
      color: #ef4444;
    }
    .schematic-arrow {
      color: var(--text-dim);
      font-size: 0.9rem;
      line-height: 1;
    }

    /* 4-Item Grid */
    .problem-cards {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1.5rem;
    }
    @media (max-width: 640px) {
      .problem-cards { grid-template-columns: 1fr; }
    }
    .p-card {
      background: var(--bg-dark);
      border: 1px solid var(--border-dark);
      padding: 1.75rem;
      position: relative;
      transition: all 0.2s ease;
      clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
    }
    .p-card:hover {
      border-color: var(--border-orange);
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
    }
    .p-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.85rem;
      font-family: var(--font-mono);
    }
    .p-tag {
      font-size: 0.65rem;
      letter-spacing: 0.1em;
      color: var(--orange-500);
      font-weight: 700;
    }
    .p-num {
      font-size: 0.7rem;
      color: var(--text-dim);
    }
    .p-title {
      font-family: var(--font-display);
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      color: #fff;
    }
    .p-desc {
      font-size: 0.875rem;
      color: var(--text-muted);
      line-height: 1.55;
    }

    /* SECTION 3: WORKBENCH COCKPIT (RIG.AI TERMINAL + CHAT/COCKPIT) */
    .workbench-container {
      background: var(--bg-dark);
      border: 1px solid var(--border-dark);
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 25px 60px rgba(0,0,0,0.7);
    }
    .wb-topbar {
      background: #090c12;
      border-bottom: 1px solid var(--border-dark);
      padding: 0.75rem 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: var(--font-mono);
      font-size: 0.75rem;
    }
    .wb-window-dots {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .wb-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #2a3240;
    }
    .wb-dot.dot-active { background: var(--orange-500); }
    .wb-panes {
      display: grid;
      grid-template-columns: 1fr 1.35fr;
      min-height: 520px;
    }
    @media (max-width: 900px) {
      .wb-panes { grid-template-columns: 1fr; }
    }
    
    /* Left Code/Payload Pane */
    .wb-left-pane {
      background: #080b10;
      border-right: 1px solid var(--border-dark);
      padding: 1.5rem;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      line-height: 1.6;
      color: #94a3b8;
      overflow-y: auto;
      max-height: 600px;
    }
    .code-line {
      display: flex;
      gap: 1rem;
    }
    .code-ln {
      color: var(--text-dim);
      user-select: none;
      min-width: 28px;
      text-align: right;
    }
    .code-val-key { color: var(--orange-500); }
    .code-val-str { color: #a5d6a7; }
    .code-val-num { color: #818cf8; }

    /* Right Maintainer Cockpit Pane */
    .wb-right-pane {
      background: #0b0e15;
      padding: 1.75rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      max-height: 600px;
      overflow-y: auto;
    }
    .cockpit-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border-dark);
    }
    .cockpit-title {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .cockpit-title span { color: var(--orange-500); }
    .cockpit-status-tag {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      background: rgba(249, 115, 22, 0.1);
      color: var(--orange-500);
      border: 1px solid var(--border-orange);
    }

    /* Proposal Review Card */
    .review-bubble {
      background: var(--bg-surface);
      border: 1px solid var(--border-dark);
      padding: 1.25rem;
      margin-bottom: 1.25rem;
      clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
    }
    .review-bubble-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.75rem;
    }
    .review-issue-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #fff;
      font-family: var(--font-display);
    }
    .review-issue-meta {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      color: var(--text-muted);
      margin-top: 0.2rem;
    }
    .action-badge {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0.2rem 0.5rem;
      background: rgba(249, 115, 22, 0.15);
      color: var(--orange-500);
      border: 1px solid var(--border-orange);
      text-transform: uppercase;
    }

    .draft-editor-box {
      background: #06080c;
      border: 1px solid var(--border-dark);
      border-radius: 4px;
      padding: 0.85rem;
      margin: 0.85rem 0;
    }
    .draft-editor-label {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
      display: flex;
      justify-content: space-between;
    }
    .draft-textarea-input {
      width: 100%;
      min-height: 95px;
      background: transparent;
      border: none;
      color: #e2e8f0;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      line-height: 1.5;
      resize: vertical;
      outline: none;
    }
    .diff-indicator {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      color: var(--orange-500);
    }

    .cockpit-actions-bar {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }

    /* SECTION 4: THE DIFFERENCE (RIG.AI SIDE-BY-SIDE TERMINALS) */
    .difference-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
      margin-bottom: 3.5rem;
    }
    @media (max-width: 768px) {
      .difference-grid { grid-template-columns: 1fr; }
    }
    .diff-box {
      background: var(--bg-dark);
      border: 1px solid var(--border-dark);
      padding: 2.25rem 2rem;
      position: relative;
      clip-path: polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%);
    }
    .diff-box.diff-highlight {
      border-color: var(--orange-500);
      background: linear-gradient(180deg, rgba(249, 115, 22, 0.04) 0%, var(--bg-dark) 100%);
    }
    .diff-box-header {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--text-dim);
      margin-bottom: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .diff-box-header strong {
      color: #fff;
    }
    .diff-box.diff-highlight .diff-box-header strong {
      color: var(--orange-500);
    }
    .terminal-snippet {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: #94a3b8;
      background: #07090e;
      border: 1px solid var(--border-dark);
      padding: 1.25rem;
      margin-bottom: 1.5rem;
      line-height: 1.7;
    }
    .diff-callout-pill {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      padding: 0.85rem 1rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-dark);
      font-size: 0.825rem;
    }
    .callout-icon {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border-subtle);
    }
    .diff-callout-pill.danger-callout .callout-icon {
      color: #fbbf24;
      border-color: rgba(251, 191, 36, 0.4);
    }
    .diff-callout-pill.verified-callout {
      border-color: var(--border-orange);
      background: rgba(249, 115, 22, 0.06);
    }
    .diff-callout-pill.verified-callout .callout-icon {
      color: var(--orange-500);
      border-color: var(--orange-500);
    }

    /* 3 Pillars at Bottom */
    .metrics-trio {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2rem;
      padding-top: 2rem;
      border-top: 1px solid var(--border-dark);
    }
    @media (max-width: 768px) {
      .metrics-trio { grid-template-columns: 1fr; }
    }
    .metric-col-num {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--orange-500);
      margin-bottom: 0.5rem;
    }
    .metric-col-title {
      font-family: var(--font-display);
      font-size: 1.2rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 0.5rem;
    }
    .metric-col-desc {
      font-size: 0.875rem;
      color: var(--text-muted);
      line-height: 1.5;
    }

    /* SECTION 5: RECEIPTS AUDIT LOG & STATS */
    .receipts-section {
      background: #090c12;
      border-top: 1px solid var(--border-dark);
      padding: 5rem 2rem;
    }
    .stats-shelf {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1.25rem;
      margin-bottom: 3rem;
    }
    @media (max-width: 768px) {
      .stats-shelf { grid-template-columns: repeat(2, 1fr); }
    }
    .stat-brick {
      background: var(--bg-dark);
      border: 1px solid var(--border-dark);
      padding: 1.5rem;
      clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
      transition: all 0.2s ease;
    }
    .stat-brick:hover { border-color: var(--border-orange); }
    .stat-brick-val {
      font-family: var(--font-mono);
      font-size: 2.2rem;
      font-weight: 800;
      color: #fff;
      line-height: 1;
      margin-bottom: 0.35rem;
    }
    .stat-brick-val.highlight { color: var(--orange-500); }
    .stat-brick-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      font-family: var(--font-mono);
      letter-spacing: 0.05em;
    }

    /* Receipts Table */
    .table-frame {
      background: var(--bg-dark);
      border: 1px solid var(--border-dark);
      overflow-x: auto;
      clip-path: polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.8rem;
    }
    th {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-dim);
      padding: 1rem 1.25rem;
      background: #07090e;
      border-bottom: 1px solid var(--border-dark);
    }
    td {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border-dark);
      font-family: var(--font-mono);
      color: #94a3b8;
    }
    tr:hover td {
      background: rgba(249, 115, 22, 0.03);
    }
    .pill-outcome {
      display: inline-block;
      padding: 0.2rem 0.55rem;
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      border-radius: 2px;
    }
    .pill-outcome.approved-unedited {
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .pill-outcome.approved-edited {
      background: rgba(249, 115, 22, 0.15);
      color: var(--orange-500);
      border: 1px solid var(--border-orange);
    }
    .pill-outcome.rejected {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    footer {
      border-top: 1px solid var(--border-dark);
      padding: 2.5rem 2rem;
      text-align: center;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--text-dim);
      background: #05070a;
    }
  </style>
</head>
<body>

  <!-- Navigation Bar -->
  <nav>
    <a href="#" class="nav-brand">
      <div class="logo-glyph">H</div>
      <div class="nav-logo">HAMMOCK</div>
      <span class="nav-tag">Gated Triage</span>
    </a>
    <div class="nav-actions">
      <div class="nav-pill" id="nav-dry-status">CONFIG: <strong>HAMMOCK_DRY_RUN=1</strong></div>
      <div class="nav-pill" id="nav-auth-status">AUTH: <strong>AUTH0 LOCAL</strong></div>
      <a href="#workbench-section" class="btn-chamfer">Review Proposals</a>
    </div>
  </nav>

  <!-- SECTION 1: HERO (RIG.AI VIBRANT ORANGE THEME) -->
  <div class="hero-container">
    <div class="hero-content">
      <div class="hero-header-row">
        <div class="hero-brand-rig">HAMMOCK</div>
        <a href="#workbench-section" class="btn-chamfer hero-btn-demo">Get a Demo</a>
      </div>

      <h1 class="hero-title">Build Triage Into<br>The Overnight Loop</h1>
      <p class="hero-subhead">
        Find duplicates as issues arrive, draft tone-conditioned maintainer fixes with Gemma 4, and verify every action, before findings turn into comments.
      </p>

      <div class="hero-actions">
        <a href="#workbench-section" class="btn-chamfer hero-btn-demo">Review Proposals</a>
      </div>
    </div>
  </div>

  <!-- Marquee Ticker -->
  <div class="ticker-bar">
    <div class="ticker-track">
      <span class="ticker-item"><span class="ticker-dot">●</span> <strong>HAMMOCK TRIAGE GATE</strong>: REVERSIBLE ALONE. VISIBLE NEVER.</span>
      <span class="ticker-item"><span class="ticker-dot">●</span> <strong>TEMPORAL ORCHESTRATION</strong>: NIGHTLY WORKFLOW SCHEDULED</span>
      <span class="ticker-item"><span class="ticker-dot">●</span> <strong>0 TOKENS LEAKED</strong>: ON-DEVICE GEMMA 4 INFERENCE ONLY</span>
      <span class="ticker-item"><span class="ticker-dot">●</span> <strong>NOMIC-EMBED-TEXT</strong>: 768-DIMENSIONAL VECTOR COSINE DEDUPE</span>
      <span class="ticker-item"><span class="ticker-dot">●</span> <strong>AUTH0 TOKEN VAULT</strong>: 100% APPROVAL-GATED MAINTAINER WRITES</span>
      <span class="ticker-item"><span class="ticker-dot">●</span> <strong>SQLITE RECEIPTS</strong>: IMMUTABLE AUDIT TRAIL PRESERVED</span>
      <!-- Duplicate for infinite marquee -->
      <span class="ticker-item"><span class="ticker-dot">●</span> <strong>HAMMOCK TRIAGE GATE</strong>: REVERSIBLE ALONE. VISIBLE NEVER.</span>
      <span class="ticker-item"><span class="ticker-dot">●</span> <strong>TEMPORAL ORCHESTRATION</strong>: NIGHTLY WORKFLOW SCHEDULED</span>
      <span class="ticker-item"><span class="ticker-dot">●</span> <strong>0 TOKENS LEAKED</strong>: ON-DEVICE GEMMA 4 INFERENCE ONLY</span>
      <span class="ticker-item"><span class="ticker-dot">●</span> <strong>NOMIC-EMBED-TEXT</strong>: 768-DIMENSIONAL VECTOR COSINE DEDUPE</span>
    </div>
  </div>

  <!-- SECTION 2: THE PROBLEM (RIG.AI 4-GRID + SCHEMATIC) -->
  <div class="section-wrap">
    <div class="section-badge-center">
      <div class="tech-pill">✕ The Problem</div>
    </div>
    <h2 class="section-headline">GitHub Issues Are an Asset and a Risk</h2>
    <p class="section-subhead">
      AI coding agents generate code at supersonic speed, creating a massive flood of incoming issues, duplicated bug reports, and malicious prompt injections.
    </p>

    <div class="problem-grid-layout">
      <!-- Left Schematic Diagram -->
      <div class="schematic-card">
        <div class="schematic-corner-tl"></div>
        <div class="schematic-corner-br"></div>
        <div class="schematic-flow">
          <div style="color: var(--text-dim); text-align: center; margin-bottom: 0.5rem; letter-spacing: 0.1em;">ISSUES / PRs</div>
          <div class="schematic-node">
            <span>&lt;/&gt; Incoming Issue</span>
            <span style="color: var(--orange-500);">&lt; / &gt;</span>
          </div>
          <div class="schematic-arrow">↓</div>
          <div class="schematic-node highlight">
            <span>768-d nomic Embed</span>
            <span>001</span>
          </div>
          <div class="schematic-arrow">↓</div>
          <div class="schematic-node highlight">
            <span>Gemma 4 Verdict</span>
            <span>002</span>
          </div>
          <div class="schematic-arrow">↓</div>
          <div class="schematic-node danger-point">
            <span>Approval Gate (Tap)</span>
            <span>[ ! ]</span>
          </div>
          <div class="schematic-arrow">↓</div>
          <div class="schematic-node">
            <span>Immutable Receipt</span>
            <span style="color: #4ade80;">SHIP</span>
          </div>
        </div>
      </div>

      <!-- Right 4-Grid Cards -->
      <div class="problem-cards">
        <div class="p-card">
          <div class="p-card-header">
            <span class="p-tag">BOTTLENECK</span>
            <span class="p-num">001</span>
          </div>
          <h3 class="p-title">More to Review</h3>
          <p class="p-desc">The new bottleneck is your team's ability to review incoming spam, hallucinations, and repeated feature requests.</p>
        </div>

        <div class="p-card">
          <div class="p-card-header">
            <span class="p-tag">EXPOSURE</span>
            <span class="p-num">002</span>
          </div>
          <h3 class="p-title">Hackers Are More Dangerous</h3>
          <p class="p-desc">With AI, bad actors inject prompt payloads into issue text to trigger unauthorized writes or leak private maintainer tokens.</p>
        </div>

        <div class="p-card">
          <div class="p-card-header">
            <span class="p-tag">VOLUME</span>
            <span class="p-num">003</span>
          </div>
          <h3 class="p-title">Your Backlog is Growing</h3>
          <p class="p-desc">Dev teams are forced to slow down to deal with duplicate bug backlogs growing faster than maintainers can read.</p>
        </div>

        <div class="p-card">
          <div class="p-card-header">
            <span class="p-tag">NOISE</span>
            <span class="p-num">004</span>
          </div>
          <h3 class="p-title">False Positives Obscure Reality</h3>
          <p class="p-desc">Cloud bots hallucinate fixes and post generic spam comments. Maintainers suffer alert fatigue and miss real critical bugs.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- SECTION 3: INTRODUCING HAMMOCK (RIG.AI INTERACTIVE WORKBENCH) -->
  <div class="section-wrap" id="workbench-section" style="padding-top: 2rem;">
    <div class="section-badge-center">
      <div class="tech-pill">Introducing Hammock</div>
    </div>
    <h2 class="section-headline">Automated Triage Inside The Loop</h2>
    <p class="section-subhead">
      Hammock checks the incoming repository issues when you sleep. Findings go straight to the maintainer approval cockpit, while code and context are still fresh.
    </p>

    <div class="workbench-container">
      <div class="wb-topbar">
        <div class="wb-window-dots">
          <span class="wb-dot dot-active"></span>
          <span class="wb-dot"></span>
          <span class="wb-dot"></span>
          <span style="color: var(--text-dim); margin-left: 0.5rem;">workspace / hammock-triage-session</span>
        </div>
        <div style="color: var(--orange-500);">TEMPORAL WORKFLOW: CONNECTED</div>
      </div>

      <div class="wb-panes">
        <!-- Left: Code / Target Issue View -->
        <div class="wb-left-pane" id="wb-source-pane">
          <div style="color: var(--text-dim); margin-bottom: 1rem; border-bottom: 1px solid #1a2230; padding-bottom: 0.5rem;">
            // Target Issue Representation (Immutable Ingest)
          </div>
          <div class="code-line"><span class="code-ln">01</span><span>{</span></div>
          <div class="code-line"><span class="code-ln">02</span><span>  <span class="code-val-key">"system"</span>: <span class="code-val-str">"Hammock Local Triage"</span>,</span></div>
          <div class="code-line"><span class="code-ln">03</span><span>  <span class="code-val-key">"model"</span>: <span class="code-val-str">"gemma4:e2b-instruct"</span>,</span></div>
          <div class="code-line"><span class="code-ln">04</span><span>  <span class="code-val-key">"embedding_engine"</span>: <span class="code-val-str">"nomic-embed-text (768-d)"</span>,</span></div>
          <div class="code-line"><span class="code-ln">05</span><span>  <span class="code-val-key">"invariant"</span>: <span class="code-val-str">"REVERSIBLE_ALONE_VISIBLE_NEVER"</span>,</span></div>
          <div class="code-line"><span class="code-ln">06</span><span>  <span class="code-val-key">"approval_gated"</span>: <span class="code-val-num">true</span>,</span></div>
          <div class="code-line"><span class="code-ln">07</span><span>  <span class="code-val-key">"max_comments_per_run"</span>: <span class="code-val-num">5</span>,</span></div>
          <div class="code-line"><span class="code-ln">08</span><span>  <span class="code-val-key">"active_queue_status"</span>: <span class="code-val-str" id="wb-queue-status-text">"Checking proposals..."</span></span></div>
          <div class="code-line"><span class="code-ln">09</span><span>}</span></div>
          <div style="margin-top: 1.5rem; color: var(--text-dim); border-top: 1px solid #1a2230; padding-top: 0.75rem;">
            // Active Sandbox: <span id="wb-sandbox-name" style="color: var(--text-cream);">Lakshay-Deol/Hammock-sandbox</span>
          </div>
        </div>

        <!-- Right: Maintainer Cockpit -->
        <div class="wb-right-pane">
          <div class="cockpit-header">
            <div class="cockpit-title">&gt;_ <span>Maintainer Decision Console</span></div>
            <span class="cockpit-status-tag" id="cockpit-pending-badge">0 PENDING TAPS</span>
          </div>

          <div id="proposals-cockpit-list">
            <div style="text-align: center; color: var(--text-dim); padding: 3rem 1rem; font-family: var(--font-mono); font-size: 0.85rem;">
              Scanning local approval gate queue...
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- SECTION 4: THE DIFFERENCE (RIG.AI TERMINAL COMPARISON) -->
  <div class="section-wrap">
    <div class="section-badge-center">
      <div class="tech-pill">⌕ The Difference</div>
    </div>
    <h2 class="section-headline">Cloud bots spam the repo.<br>Hammock tests what it does.</h2>
    <p class="section-subhead">
      Static cloud triage bots find potential labels by sending your repository data to third-party endpoints. Hammock runs on-device, tests cosine vector duplicates, and gates every action.
    </p>

    <div class="difference-grid">
      <!-- 01 / Cloud Triage Bots -->
      <div class="diff-box">
        <div class="diff-box-header">
          <span>01 / CLOUD TRIAGE BOTS</span>
          <span style="color: #fbbf24;">UNVERIFIED WRITES</span>
        </div>
        <div class="terminal-snippet">
          <div style="color: #ef4444;">- POST /repos/owner/repo/issues/104/comments</div>
          <div>&gt; "Thank you for opening this issue! I am an automated bot..."</div>
          <div style="color: var(--text-dim); margin-top: 0.5rem;">// Bot hallucinated non-existent API parameter</div>
          <div style="color: var(--text-dim);">// Prompt injection allowed contributor to run malicious actions</div>
        </div>
        <div class="diff-callout-pill danger-callout">
          <span class="callout-icon">?</span>
          <div>
            <div style="font-weight: 700; color: #fff;">A potential hallucination</div>
            <div style="color: var(--text-muted); font-size: 0.75rem;">Posted automatically without maintainer review.</div>
          </div>
        </div>
      </div>

      <!-- 02 / Hammock Runtime Engine -->
      <div class="diff-box diff-highlight">
        <div class="diff-box-header">
          <strong>02 / HAMMOCK RUNTIME ENGINE</strong>
          <span style="color: var(--orange-500); font-weight: 700;">LOCAL APPROVAL GATE</span>
        </div>
        <div class="terminal-snippet">
          <div style="color: var(--orange-500);">+ ApprovalService.approveProposal(id, "maintainer")</div>
          <div style="color: #4ade80;">✓ Cosine similarity 0.912 matches existing issue #42</div>
          <div style="color: #4ade80;">✓ Tone-conditioned maintainer draft generated via Gemma 4</div>
          <div style="color: #4ade80;">✓ Signed cryptographic receipt written to SQLite</div>
        </div>
        <div class="diff-callout-pill verified-callout">
          <span class="callout-icon">✓</span>
          <div>
            <div style="font-weight: 700; color: #fff;">A confirmed maintainer tap</div>
            <div style="color: var(--text-muted); font-size: 0.75rem;">Observed while testing locally. Zero unsanctioned writes.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 3 Metrics Trio -->
    <div class="metrics-trio">
      <div>
        <div class="metric-col-num">01</div>
        <div class="metric-col-title">Reachability, confirmed.</div>
        <div class="metric-col-desc">Issues deduplicated using 768-dimensional nomic embeddings with cosine distance against existing open & closed issues.</div>
      </div>
      <div>
        <div class="metric-col-num">02</div>
        <div class="metric-col-title">Maintainer context, included.</div>
        <div class="metric-col-desc">Tone conditioning ensures replies match your repo maintainer voice without robotic filler or token leakage.</div>
      </div>
      <div>
        <div class="metric-col-num">03</div>
        <div class="metric-col-title">Receipts, ready to audit.</div>
        <div class="metric-col-desc">Every approve and reject produces an immutable SHA-256 signed receipt tracking original vs. edited text.</div>
      </div>
    </div>
  </div>

  <!-- SECTION 5: STATS SHELF & AUDIT RECEIPTS LOG -->
  <div class="receipts-section">
    <div class="section-wrap" style="padding-top: 0; padding-bottom: 2rem;">
      <div class="section-badge-center">
        <div class="tech-pill">⚡ The Lazy Payoff</div>
      </div>
      <h2 class="section-headline">Receipts Audit Log</h2>
      <p class="section-subhead">
        Reversible alone, visible never. Every action taken during morning triage is signed and stored with full diff accountability.
      </p>

      <div class="stats-shelf">
        <div class="stat-brick">
          <div class="stat-brick-val highlight" id="stat-pending">0</div>
          <div class="stat-brick-label">Pending Maintainer Taps</div>
        </div>
        <div class="stat-brick">
          <div class="stat-brick-val" id="stat-approved">0</div>
          <div class="stat-brick-label">Approved (Unedited)</div>
        </div>
        <div class="stat-brick">
          <div class="stat-brick-val" id="stat-edited">0</div>
          <div class="stat-brick-label">Approved (With Edits)</div>
        </div>
        <div class="stat-brick">
          <div class="stat-brick-val" id="stat-rejected">0</div>
          <div class="stat-brick-label">Rejected (Zero Repo Trace)</div>
        </div>
      </div>

      <div class="table-frame">
        <table>
          <thead>
            <tr>
              <th>Receipt ID</th>
              <th>Issue ID</th>
              <th>Action</th>
              <th>Outcome</th>
              <th>Maintainer Actor</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody id="receipts-tbody">
            <tr>
              <td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">
                Loading audit receipts...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <footer>
    HAMMOCK — APPROVAL-GATED OVERNIGHT TRIAGE ENGINE • NODE 22 + TEMPORAL + GEMMA 4 • STRICT INVARIANTS ENFORCED
  </footer>

  <script>
    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        document.getElementById('stat-pending').innerText = data.stats.pendingProposals;
        document.getElementById('stat-approved').innerText = data.stats.approvedUnedited;
        document.getElementById('stat-edited').innerText = data.stats.approvedEdited;
        document.getElementById('stat-rejected').innerText = data.stats.rejected;
        
        document.getElementById('cockpit-pending-badge').innerText = data.stats.pendingProposals + ' PENDING TAPS';
        document.getElementById('wb-queue-status-text').innerText = data.stats.pendingProposals + ' proposals pending approval';
        document.getElementById('wb-sandbox-name').innerText = data.sandboxRepo || 'Lakshay-Deol/Hammock-sandbox';

        document.getElementById('nav-dry-status').innerHTML = 'CONFIG: <strong>' + (data.dryRun ? 'HAMMOCK_DRY_RUN=1 (SAFE)' : 'LIVE WRITES') + '</strong>';
        document.getElementById('nav-auth-status').innerHTML = 'AUTH: <strong>' + data.authMode.toUpperCase() + '</strong>';
      } catch (err) {
        console.error('Failed to load stats', err);
      }
    }

    async function loadProposals() {
      const container = document.getElementById('proposals-cockpit-list');
      try {
        const res = await fetch('/api/proposals');
        const data = await res.json();

        if (!data.proposals || data.proposals.length === 0) {
          container.innerHTML = \`
            <div style="text-align: center; padding: 4rem 1.5rem; background: var(--bg-surface); border: 1px dashed var(--border-dark);">
              <div style="font-size: 2rem; margin-bottom: 0.75rem;">🦥</div>
              <div style="font-family: var(--font-display); font-size: 1.15rem; font-weight: 700; color: #fff; margin-bottom: 0.35rem;">
                Your Morning Queue Is Clean!
              </div>
              <div style="font-size: 0.85rem; color: var(--text-muted); max-width: 380px; margin: 0 auto;">
                Zero pending maintainer taps. Sleeping soundly in the hammock while the overnight cron guards the repo.
              </div>
            </div>
          \`;
          return;
        }

        container.innerHTML = data.proposals.map(p => {
          const issue = p.issue || { number: '?', title: 'Untitled Issue', author: 'anonymous' };
          const bodyText = p.payload.body || JSON.stringify(p.payload, null, 2);

          return \`
            <div class="review-bubble" id="card-\${p.proposal.id}">
              <div class="review-bubble-header">
                <div>
                  <div class="review-issue-title">#\${issue.number} — \${issue.title}</div>
                  <div class="review-issue-meta">
                    Author: @\${issue.author} • Proposal ID: \${p.proposal.id.slice(0, 8)}... • Risk: \${p.proposal.risk.toUpperCase()}
                  </div>
                </div>
                <span class="action-badge">\${p.proposal.action.toUpperCase()}</span>
              </div>

              <div class="draft-editor-box">
                <div class="draft-editor-label">
                  <span>Gemma 4 Tone-Conditioned Draft</span>
                  <span class="diff-indicator" id="diff-\${p.proposal.id}">Live Maintainer Diff: Unmodified</span>
                </div>
                <textarea 
                  class="draft-textarea-input" 
                  id="text-\${p.proposal.id}" 
                  oninput="trackDiff('\${p.proposal.id}', this)"
                  data-initial="\${encodeURIComponent(bodyText)}"
                >\${bodyText}</textarea>
              </div>

              <div class="cockpit-actions-bar">
                <button class="btn-chamfer btn-ghost-danger" onclick="decide('\${p.proposal.id}', false)">
                  ✕ Reject & Discard (Zero Trace)
                </button>
                <button class="btn-chamfer btn-orange-solid" onclick="decide('\${p.proposal.id}', true)">
                  ⚡ Approve & Execute (Tap)
                </button>
              </div>
            </div>
          \`;
        }).join('');
      } catch (err) {
        container.innerHTML = '<div style="color: #ef4444; padding: 2rem; font-family: var(--font-mono);">Failed to fetch proposals: ' + err.message + '</div>';
      }
    }

    function trackDiff(id, textarea) {
      const initial = decodeURIComponent(textarea.getAttribute('data-initial') || '');
      const current = textarea.value;
      const indicator = document.getElementById('diff-' + id);
      if (!indicator) return;

      if (current === initial) {
        indicator.innerText = 'Live Maintainer Diff: Unmodified';
        indicator.style.color = 'var(--text-dim)';
      } else {
        const diffLength = current.length - initial.length;
        const sign = diffLength >= 0 ? '+' : '';
        indicator.innerText = 'Live Maintainer Diff: Modified (' + sign + diffLength + ' chars)';
        indicator.style.color = 'var(--orange-500)';
      }
    }

    async function loadReceipts() {
      const tbody = document.getElementById('receipts-tbody');
      try {
        const res = await fetch('/api/receipts');
        const data = await res.json();

        if (!data.receipts || data.receipts.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">No audit receipts generated yet.</td></tr>';
          return;
        }

        tbody.innerHTML = data.receipts.map(r => {
          let pillClass = 'approved-unedited';
          if (r.outcome === 'approved_edited') pillClass = 'approved-edited';
          if (r.outcome === 'rejected') pillClass = 'rejected';

          return \`
            <tr>
              <td style="color: #fff;">\${r.id.slice(0, 10)}...</td>
              <td style="color: var(--orange-500);">#\${r.issue_id}</td>
              <td>\${r.action}</td>
              <td><span class="pill-outcome \${pillClass}">\${r.outcome}</span></td>
              <td>\${r.actor || 'maintainer'}</td>
              <td>\${new Date(r.created_at).toLocaleTimeString()}</td>
            </tr>
          \`;
        }).join('');
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="color: #ef4444; padding: 2rem;">Failed to fetch receipts: ' + err.message + '</td></tr>';
      }
    }

    async function decide(proposalId, isApproved) {
      const card = document.getElementById('card-' + proposalId);
      if (card) card.style.opacity = '0.4';

      const url = isApproved ? \`/api/proposals/\${proposalId}/approve\` : \`/api/proposals/\${proposalId}/reject\`;
      const textarea = document.getElementById('text-' + proposalId);
      const editedText = (isApproved && textarea) ? textarea.value : undefined;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ editedText, reason: 'Decided via Hammock maintainer cockpit' })
        });

        if (res.ok) {
          if (card) card.remove();
          await loadStats();
          await loadProposals();
          await loadReceipts();
        } else {
          alert('Action failed: ' + (await res.text()));
          if (card) card.style.opacity = '1';
        }
      } catch (err) {
        alert('Network error: ' + err.message);
        if (card) card.style.opacity = '1';
      }
    }

    loadStats();
    loadProposals();
    loadReceipts();
  </script>
</body>
</html>`;
    return c.html(html);
  });

  return app;
}
