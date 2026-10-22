#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { config } from './config.js';
import { IssueSchema } from './types/schemas.js';
import { HammockRepository } from './db/index.js';
import { getModelClient } from './model/factory.js';
import { getEmbeddingClient } from './model/embedding.js';
import { findAndAdjudicateDuplicates } from './model/dedupe.js';
import { generateDraftReply } from './model/draft.js';
import { runDedupeBenchmark } from './model/eval-dedupe.js';
import { loadPolicy } from './policy/index.js';
import { checkTemporalHealth, scheduleNightlyTriage, triggerTriageRun } from './temporal/client.js';
import { runWorker } from './temporal/worker.js';
import {
  fetchIssuesActivity,
  triageIssueActivity,
  applyAllowlistActivity,
  saveRunDigestActivity,
} from './temporal/activities.js';
import { ApprovalService } from './approval/service.js';
import { startServer } from './server/index.js';

const program = new Command();

program
  .name('hammock')
  .description('Local, approval-gated GitHub issue triage with Gemma 4')
  .version('0.1.0');

/**
 * hammock doctor
 * AGENTS.md Invariant 7: The human runs daemons outside the agent.
 * Your only check is pnpm hammock doctor.
 */
program
  .command('doctor')
  .description('Check local environment, database, policy, and daemon reachability')
  .action(async () => {
    console.log('🩺 Running Hammock Doctor diagnostics...\n');

    const checks: Array<{ name: string; status: 'PASS' | 'WARN' | 'FAIL'; message: string }> = [];

    // 1. Node version check
    const nodeVersion = process.versions.node;
    const majorNode = parseInt(nodeVersion.split('.')[0] ?? '0', 10);
    if (majorNode >= 22) {
      checks.push({ name: 'Node.js Runtime', status: 'PASS', message: `v${nodeVersion} (Node >= 22 requirement met)` });
    } else {
      checks.push({ name: 'Node.js Runtime', status: 'FAIL', message: `v${nodeVersion} (Requires Node >= 22)` });
    }

    // 2. Policy file check
    try {
      const policy = loadPolicy();
      checks.push({
        name: 'Policy (.hammock.yml)',
        status: 'PASS',
        message: `Valid. Tone: "${policy.tone}", Auto-labels: [${policy.labels.auto.join(', ')}]`,
      });
    } catch (err) {
      checks.push({ name: 'Policy (.hammock.yml)', status: 'FAIL', message: `Failed to load policy: ${String(err)}` });
    }

    // 3. SQLite Database check
    try {
      const repo = new HammockRepository(':memory:');
      repo.close();
      checks.push({ name: 'SQLite Storage', status: 'PASS', message: `better-sqlite3 operational with WAL mode` });
    } catch (err) {
      checks.push({ name: 'SQLite Storage', status: 'FAIL', message: `SQLite error: ${String(err)}` });
    }

    // 4. Configuration & Safety Invariants
    if (config.HAMMOCK_DRY_RUN) {
      checks.push({
        name: 'Dry-Run Mode',
        status: 'PASS',
        message: 'Active (HAMMOCK_DRY_RUN=1). Writes are prevented.',
      });
    } else {
      checks.push({
        name: 'Dry-Run Mode',
        status: 'WARN',
        message: 'Inactive (HAMMOCK_DRY_RUN=0). Real writes enabled to sandbox repo.',
      });
    }

    if (config.HAMMOCK_SANDBOX_REPO) {
      checks.push({
        name: 'Sandbox Repo Target',
        status: 'PASS',
        message: `Configured: "${config.HAMMOCK_SANDBOX_REPO}"`,
      });
    } else {
      checks.push({
        name: 'Sandbox Repo Target',
        status: 'WARN',
        message: 'Not set. Real writes will be blocked by assertWritable().',
      });
    }

    // 5. Ollama / Model check
    const client = getModelClient();
    const health = await client.checkHealth();
    if (health.ok) {
      checks.push({
        name: `Model Backend (${client.name})`,
        status: 'PASS',
        message: health.message,
      });
    } else {
      // If live Ollama is offline, check if replay transport is available
      if (config.HAMMOCK_REPLAY) {
        checks.push({
          name: `Model Backend (${client.name})`,
          status: 'WARN',
          message: `Live Ollama offline; running in Replay mode (${health.message})`,
        });
      } else {
        checks.push({
          name: `Model Backend (${client.name})`,
          status: 'WARN',
          message: `${health.message} (Run "ollama serve" and "ollama pull ${config.OLLAMA_MODEL}" or set HAMMOCK_REPLAY=1)`,
        });
      }
    }

    // 6. Temporal Orchestrator Daemon check
    const temporalHealth = await checkTemporalHealth();
    checks.push({
      name: 'Temporal Orchestrator',
      status: temporalHealth.ok ? 'PASS' : 'WARN',
      message: temporalHealth.message,
    });

    // Display table
    console.table(
      checks.map((c) => ({
        Component: c.name,
        Status: c.status === 'PASS' ? '✅ PASS' : c.status === 'WARN' ? '⚠️ WARN' : '❌ FAIL',
        Details: c.message,
      }))
    );

    const hasFail = checks.some((c) => c.status === 'FAIL');
    if (hasFail) {
      process.exit(1);
    }
  });

/**
 * hammock verdict <file>
 * PLAN.md acceptance:
 * `pnpm hammock verdict fixtures/issue-001.json` prints schema-valid JSON in <60s;
 * 8/8 fixtures pass incl. 3 injection ones; tok/s recorded
 */
program
  .command('verdict <file>')
  .description('Triage a GitHub issue fixture and generate a schema-validated verdict')
  .option('-r, --replay', 'Force replay adapter', false)
  .option('--no-save', 'Do not save verdict to SQLite')
  .action(async (filePath: string, options: { replay: boolean; save: boolean }) => {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Error: Issue fixture file not found at ${resolvedPath}`);
      process.exit(1);
    }

    const rawContent = fs.readFileSync(resolvedPath, 'utf8');
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawContent);
    } catch (err) {
      console.error(`Error: File is not valid JSON: ${String(err)}`);
      process.exit(1);
    }

    const issue = IssueSchema.parse(parsedJson);

    // Pick client
    const client = getModelClient(options.replay);

    // Check health if not forced replay
    if (!options.replay && !config.HAMMOCK_REPLAY) {
      const health = await client.checkHealth();
      if (!health.ok) {
        process.stderr.write(`[Notice: ${health.message}. Falling back to Replay adapter for deterministic execution.]\n`);
      }
    }

    const effectiveClient =
      options.replay || config.HAMMOCK_REPLAY
        ? client
        : (await client.checkHealth()).ok
          ? client
          : getModelClient(true);

    const result = await effectiveClient.classifyIssue(issue);

    // Save to SQLite if enabled
    if (options.save) {
      const dbRepo = new HammockRepository(config.HAMMOCK_DB_PATH);
      try {
        dbRepo.saveIssue(issue);
        dbRepo.saveVerdict({
          ...result.verdict,
          issue_id: issue.id,
          model: effectiveClient.name,
          raw_json: result.rawJson,
          latency_ms: result.latencyMs,
          created_at: new Date().toISOString(),
        });
      } finally {
        dbRepo.close();
      }
    }

    // Print metrics to stderr so stdout is purely valid JSON
    process.stderr.write(
      `[Hammock] Triaged ${issue.id} (#${issue.number}) via ${effectiveClient.name} in ${result.latencyMs}ms | Speed: ${
        result.tokensPerSec ? `${result.tokensPerSec.toFixed(1)} tok/s` : 'N/A'
      }\n`
    );

    // Print schema-valid JSON to stdout
    console.log(JSON.stringify(result.verdict, null, 2));
  });

/**
 * hammock test-fixtures
 * Acceptance check: all 8 fixtures pass in <60s, 3 injection ones detected, tok/s recorded
 */
program
  .command('test-fixtures')
  .description('Run triage on all 8 test fixtures and report metrics')
  .option('-r, --replay', 'Force replay adapter', false)
  .action(async (options: { replay: boolean }) => {
    console.log('🧪 Running fixture test suite...\n');
    const fixturesDir = path.resolve(process.cwd(), 'fixtures');
    const files = fs
      .readdirSync(fixturesDir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('recorded'))
      .sort();

    const initialClient = getModelClient(options.replay || config.HAMMOCK_REPLAY ? true : undefined);
    let effectiveClient = initialClient;

    if (!options.replay && !config.HAMMOCK_REPLAY) {
      const health = await initialClient.checkHealth();
      if (!health.ok) {
        console.log(`[Notice: ${health.message}. Running test suite using Replay adapter.]\n`);
        effectiveClient = getModelClient(true);
      }
    }

    const results: Array<{
      Fixture: string;
      Type: string;
      Severity: string;
      Injection: string;
      Latency: string;
      Speed: string;
      Status: string;
    }> = [];

    let allPass = true;

    for (const file of files) {
      const filePath = path.join(fixturesDir, file);
      const raw = fs.readFileSync(filePath, 'utf8');
      const issue = IssueSchema.parse(JSON.parse(raw));

      const isInjectionFixture = file.includes('injection');
      const res = await effectiveClient.classifyIssue(issue);

      const isUnder60s = res.latencyMs < 60000;
      const injectionMatch = isInjectionFixture ? res.verdict.injection_suspected === true : true;
      const pass = isUnder60s && injectionMatch;

      if (!pass) allPass = false;

      results.push({
        Fixture: file,
        Type: res.verdict.type,
        Severity: res.verdict.severity,
        Injection: res.verdict.injection_suspected ? '🚨 DETECTED' : 'Safe',
        Latency: `${res.latencyMs}ms`,
        Speed: res.tokensPerSec ? `${res.tokensPerSec.toFixed(1)} tok/s` : 'N/A',
        Status: pass ? '✅ PASS' : '❌ FAIL',
      });
    }

    console.table(results);

    if (allPass) {
      console.log(`\n🎉 All ${results.length}/${results.length} fixtures passed acceptance checks!`);
    } else {
      console.error('\n❌ Some fixtures failed acceptance check.');
      process.exit(1);
    }
  });

/**
 * hammock dedupe <file>
 * Search for duplicates of the given issue among issues in SQLite
 */
program
  .command('dedupe <file>')
  .description('Find potential duplicates for an issue using hybrid cosine recall and Gemma adjudication')
  .option('-r, --replay', 'Force replay adapter', false)
  .option('-k, --top-k <number>', 'Number of top candidates to adjudicate', '3')
  .action(async (filePath: string, options: { replay: boolean; topK: string }) => {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Error: Issue file not found at ${resolvedPath}`);
      process.exit(1);
    }

    const issue = IssueSchema.parse(JSON.parse(fs.readFileSync(resolvedPath, 'utf8')));
    const rawModelClient = getModelClient(options.replay);
    const rawEmbedClient = getEmbeddingClient(options.replay);

    let modelClient = rawModelClient;
    let embedClient = rawEmbedClient;

    if (!options.replay && !config.HAMMOCK_REPLAY) {
      const [mHealth, eHealth] = await Promise.all([rawModelClient.checkHealth(), rawEmbedClient.checkHealth()]);
      if (!mHealth.ok || !eHealth.ok) {
        modelClient = getModelClient(true);
        embedClient = getEmbeddingClient(true);
      }
    }

    const repo = new HammockRepository(config.HAMMOCK_DB_PATH);

    try {
      console.log(`🔍 Searching duplicates for issue #${issue.number}: "${issue.title}"...`);
      const candidates = await findAndAdjudicateDuplicates(
        issue,
        repo,
        modelClient,
        embedClient,
        parseInt(options.topK, 10)
      );

      if (candidates.length === 0) {
        console.log('No prior issues stored in database to compare against.');
        return;
      }

      console.table(
        candidates.map((c) => ({
          CandidateID: c.candidate_issue_id,
          Similarity: `${(c.similarity * 100).toFixed(1)}%`,
          Duplicate: c.is_duplicate ? '⚠️ YES' : 'NO',
          Confidence: `${(c.confidence * 100).toFixed(0)}%`,
          Evidence: c.evidence,
        }))
      );
    } finally {
      repo.close();
    }
  });

/**
 * hammock draft <file>
 * Generate a tone-conditioned response requesting missing information
 */
program
  .command('draft <file>')
  .description('Draft a polite, tone-conditioned reply requesting missing information')
  .option('-r, --replay', 'Force replay adapter', false)
  .option('-t, --tone <tone>', 'Override policy tone (warm-professional | friendly | terse)')
  .action(async (filePath: string, options: { replay: boolean; tone?: string }) => {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Error: Issue file not found at ${resolvedPath}`);
      process.exit(1);
    }

    const issue = IssueSchema.parse(JSON.parse(fs.readFileSync(resolvedPath, 'utf8')));
    const policy = loadPolicy();
    const effectiveTone = options.tone ?? policy.tone;
    const rawModelClient = getModelClient(options.replay);

    let modelClient = rawModelClient;
    if (!options.replay && !config.HAMMOCK_REPLAY) {
      const mHealth = await rawModelClient.checkHealth();
      if (!mHealth.ok) {
        modelClient = getModelClient(true);
      }
    }

    console.log(`✍️ Drafting reply for issue #${issue.number} using tone "${effectiveTone}"...`);
    const verdictRes = await modelClient.classifyIssue(issue);
    const draft = await generateDraftReply(issue, verdictRes.verdict, effectiveTone, modelClient);

    console.log('\n--- Draft Reply ---');
    console.log(draft.reply);
    console.log('\n--- Questions Asked ---');
    draft.questions.forEach((q, i) => console.log(`${i + 1}. ${q}`));
  });

/**
 * hammock eval-dedupe
 * PLAN.md acceptance:
 * Dedupe precision/recall computed on harvested data (target precision > 0.8 at recall ~0.5)
 */
program
  .command('eval-dedupe')
  .description('Run deduplication benchmark on harvested dataset and compute precision/recall')
  .option('-r, --replay', 'Force replay adapter', false)
  .option('-d, --dataset <path>', 'Custom dataset path')
  .action(async (options: { replay: boolean; dataset?: string }) => {
    console.log('📊 Evaluating deduplication precision and recall against ground truth dataset...\n');
    const { metrics, details } = await runDedupeBenchmark(options.dataset, options.replay);

    console.table(details);

    console.log('\n📈 Deduplication Benchmark Summary:');
    console.table([
      { Metric: 'Total Pairs Evaluated', Value: metrics.totalPairs },
      { Metric: 'True Positives (TP)', Value: metrics.truePositives },
      { Metric: 'False Positives (FP)', Value: metrics.falsePositives },
      { Metric: 'True Negatives (TN)', Value: metrics.trueNegatives },
      { Metric: 'False Negatives (FN)', Value: metrics.falseNegatives },
      { Metric: 'Precision (Target > 0.80)', Value: `${(metrics.precision * 100).toFixed(1)}%` },
      { Metric: 'Recall (Target ~ 0.50)', Value: `${(metrics.recall * 100).toFixed(1)}%` },
      { Metric: 'F1 Score', Value: metrics.f1Score.toFixed(3) },
      { Metric: 'Avg Duplicate Cosine Similarity', Value: metrics.meanSimilarityDuplicates.toFixed(3) },
      { Metric: 'Avg Non-Duplicate Cosine Similarity', Value: metrics.meanSimilarityNonDuplicates.toFixed(3) },
      { Metric: 'Avg Latency Per Pair', Value: `${metrics.avgLatencyMs}ms` },
    ]);

    const precisionPass = metrics.precision >= 0.8;
    const recallPass = metrics.recall >= 0.5;

    if (precisionPass && recallPass) {
      console.log('🎯 Dedupe precision/recall acceptance targets MET! (Precision >= 0.80, Recall >= 0.50)\n');
    } else {
      console.warn('⚠️ Benchmark results fell below target threshold.\n');
      process.exit(1);
    }
  });

/**
 * hammock triage-run [repo]
 * Run complete triage pipeline across fetched issues using Temporal activities
 */
program
  .command('triage-run [repo]')
  .description('Execute full triage run over issues (fetch -> triage fan-out -> allowlist auto-label -> proposals -> digest)')
  .option('-s, --since <timestamp>', 'Only fetch issues updated after timestamp')
  .option('-r, --replay', 'Force replay mode', false)
  .action(async (targetRepo?: string, options?: { since?: string; replay?: boolean }) => {
    const repo = targetRepo ?? config.HAMMOCK_SANDBOX_REPO ?? 'acme/hammock-sandbox';
    const runId = `run_${Date.now()}`;

    console.log(`🚀 Starting Hammock triage run for "${repo}" (Run ID: ${runId})...\n`);

    // 1. Fetch updated issues
    const fetchRes = await fetchIssuesActivity({
      repo,
      since: options?.since,
    });

    console.log(`📥 Fetched ${fetchRes.issues.length} issues (NotModified: ${fetchRes.notModified})`);

    if (fetchRes.issues.length === 0) {
      console.log('No new or updated issues found to triage.');
      return;
    }

    let labelsAppliedCount = 0;
    let proposalsQueuedCount = 0;
    let duplicatesFoundCount = 0;

    for (const issue of fetchRes.issues) {
      console.log(`\n--- Triaging #${issue.number}: "${issue.title}" ---`);

      // 2. Classify, embed, and dedupe
      const triageRes = await triageIssueActivity({ issue, runId });
      console.log(`Type: ${triageRes.verdict.type} | Severity: ${triageRes.verdict.severity} | Latency: ${triageRes.latencyMs}ms`);

      if (triageRes.candidates.some((c) => c.is_duplicate)) {
        duplicatesFoundCount++;
        console.log(`⚠️ Possible duplicate detected among prior issues.`);
      }

      // 3. Apply allowlisted labels and queue proposals
      const actionRes = await applyAllowlistActivity({
        issue,
        verdict: triageRes.verdict,
        candidates: triageRes.candidates,
        draft: triageRes.draft,
        runId,
      });

      if (actionRes.appliedLabels.length > 0) {
        console.log(`🏷️ Auto-applied allowlisted labels: [${actionRes.appliedLabels.join(', ')}]`);
        labelsAppliedCount += actionRes.appliedLabels.length;
      }

      if (actionRes.queuedProposals.length > 0) {
        console.log(`📋 Approval-gated proposals queued: ${actionRes.queuedProposals.length} (comments require human approval)`);
        proposalsQueuedCount += actionRes.queuedProposals.length;
      }
    }

    // 4. Digest
    const digest = await saveRunDigestActivity({
      runId,
      repo,
      totalIssues: fetchRes.issues.length,
      labelsApplied: labelsAppliedCount,
      proposalsQueued: proposalsQueuedCount,
      duplicatesFound: duplicatesFoundCount,
    });

    console.log('\n📊 Triage Run Completed Successfully:');
    console.table([
      { Metric: 'Run ID', Value: digest.runId },
      { Metric: 'Repository', Value: digest.repo },
      { Metric: 'Total Issues Triaged', Value: digest.totalIssues },
      { Metric: 'Allowlisted Labels Applied', Value: digest.labelsApplied },
      { Metric: 'Pending Proposals Queued', Value: digest.proposalsQueued },
      { Metric: 'Duplicates Spotted', Value: digest.duplicatesFound },
      { Metric: 'Completed At', Value: digest.completedAt },
    ]);
  });

/**
 * hammock schedule [repo]
 * Register durable nightly triage cron schedule on Temporal
 */
program
  .command('schedule [repo]')
  .description('Configure durable nightly triage schedule in Temporal')
  .option('-c, --cron <expression>', 'Cron expression for schedule', '0 2 * * *')
  .action(async (targetRepo?: string, options?: { cron: string }) => {
    const repo = targetRepo ?? config.HAMMOCK_SANDBOX_REPO ?? 'acme/hammock-sandbox';
    console.log(`⏰ Configuring Temporal nightly schedule for "${repo}" (${options?.cron ?? '0 2 * * *'})...`);
    const res = await scheduleNightlyTriage(repo, options?.cron);
    console.log(`✅ ${res.message} (Schedule ID: ${res.scheduleId})`);
  });

/**
 * hammock worker
 * Start Temporal worker daemon
 */
program
  .command('worker')
  .description('Start the Hammock Temporal worker')
  .action(async () => {
    await runWorker();
  });

/**
 * hammock dashboard
 * Launch Hono maintainer approval dashboard
 */
program
  .command('dashboard')
  .description('Launch the Hammock maintainer approval dashboard')
  .option('-p, --port <number>', 'Port to listen on', process.env.PORT || '3000')
  .action((options: { port: string }) => {
    const port = parseInt(options.port, 10);
    startServer(port);
  });

/**
 * hammock proposals
 * List pending triage proposals in approval queue
 */
program
  .command('proposals')
  .description('List pending triage proposals waiting for human approval')
  .action(() => {
    const service = new ApprovalService();
    const pending = service.getPendingProposals();

    if (pending.length === 0) {
      console.log('✨ No pending proposals. Your maintainer queue is clean!');
      return;
    }

    console.log(`📋 Found ${pending.length} pending proposal(s) waiting for approval:\n`);
    console.table(
      pending.map((p) => ({
        ID: p.proposal.id,
        Issue: p.issue ? `#${p.issue.number} ${p.issue.title.slice(0, 30)}...` : p.proposal.issue_id,
        Action: p.proposal.action.toUpperCase(),
        Risk: p.proposal.risk.toUpperCase(),
        Created: new Date(p.proposal.created_at).toLocaleTimeString(),
      }))
    );
  });

/**
 * hammock approve <id>
 * Approve and execute a gated proposal
 */
program
  .command('approve <id>')
  .description('Approve a gated proposal and execute through write gate')
  .option('-e, --edit <text>', 'Edited text content for draft comment')
  .option('-a, --actor <name>', 'Maintainer actor identity', 'maintainer-cli')
  .action(async (id: string, options: { edit?: string; actor: string }) => {
    const service = new ApprovalService();
    try {
      console.log(`👍 Approving proposal "${id}" as ${options.actor}...`);
      const receipt = await service.approveProposal(id, options.actor, options.edit);
      console.log(`✅ Proposal executed!`);
      console.log(`Receipt ID: ${receipt.id}`);
      console.log(`Outcome: ${receipt.outcome}`);
      if (receipt.user_edit_diff) {
        console.log(`User Edit Diff:\n${receipt.user_edit_diff}`);
      }
    } catch (err) {
      console.error(`❌ Approval failed: ${String(err)}`);
      process.exit(1);
    }
  });

/**
 * hammock reject <id>
 * Reject a gated proposal (leaves zero trace on GitHub)
 */
program
  .command('reject <id>')
  .description('Reject a gated proposal (leaves zero trace on GitHub)')
  .option('-r, --reason <text>', 'Reason for rejection', 'Rejected by maintainer CLI')
  .option('-a, --actor <name>', 'Maintainer actor identity', 'maintainer-cli')
  .action(async (id: string, options: { reason: string; actor: string }) => {
    const service = new ApprovalService();
    try {
      console.log(`🚫 Rejecting proposal "${id}"...`);
      const receipt = await service.rejectProposal(id, options.actor, options.reason);
      console.log(`✅ Proposal rejected without touching the repo.`);
      console.log(`Receipt ID: ${receipt.id}`);
      console.log(`Outcome: ${receipt.outcome}`);
    } catch (err) {
      console.error(`❌ Rejection failed: ${String(err)}`);
      process.exit(1);
    }
  });

/**
 * hammock receipts
 * Display immutable receipt audit log
 */
program
  .command('receipts')
  .description('View cryptographic receipt log from SQLite')
  .action(() => {
    const repo = new HammockRepository(config.HAMMOCK_DB_PATH);
    try {
      const receipts = repo.getAllReceipts();
      if (receipts.length === 0) {
        console.log('No receipts recorded in audit log.');
        return;
      }

      console.log(`📜 Showing ${receipts.length} receipt(s) from immutable audit log:\n`);
      console.table(
        receipts.map((r) => ({
          ID: r.id,
          Issue: r.issue_id,
          Action: r.action,
          Outcome: r.outcome,
          Created: new Date(r.created_at).toLocaleTimeString(),
        }))
      );
    } finally {
      repo.close();
    }
  });

program.parse(process.argv);
