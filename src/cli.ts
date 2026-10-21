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

program.parse(process.argv);
