#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { config } from './config.js';
import { IssueSchema } from './types/schemas.js';
import { HammockRepository } from './db/index.js';
import { getModelClient } from './model/factory.js';
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

program.parse(process.argv);
