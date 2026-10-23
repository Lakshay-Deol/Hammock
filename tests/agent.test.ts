import { describe, it, expect } from 'vitest';
import { createHammockAgent, triageTools } from '../src/agent/index.js';
import type { Issue, VerdictOutput } from '../src/types/schemas.js';

describe('Mastra Agent & Triage Tools', () => {
  it('instantiates the Mastra agent with triage tools', async () => {
    const agent = createHammockAgent();
    expect(agent.name).toBe('hammock-triage-agent');
    const instructions = await agent.getInstructions();
    expect(instructions).toContain('overnight GitHub issue triage');
  });

  it('executes classifyIssue tool correctly', async () => {
    const issue: Issue = {
      id: 'issue-tool-test',
      repo: 'acme/sandbox',
      number: 99,
      title: 'Documentation error in tutorial',
      body: 'Tutorial section 2 has a broken command.',
      author: 'learner',
      state: 'open',
      labels: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = await triageTools.classifyIssue.execute({ issue });
    expect(result.verdict).toBeDefined();
    expect(result.verdict.type).toBe('documentation');
    expect(result.latencyMs).toBeGreaterThanOrEqual(1);
  },30000);

  it('executes draftReply tool correctly', async () => {
    const issue: Issue = {
      id: 'issue-tool-draft',
      repo: 'acme/sandbox',
      number: 100,
      title: 'Crash on shutdown',
      body: 'Error on close',
      author: 'alice',
      state: 'open',
      labels: ['bug'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const verdict: VerdictOutput = {
      type: 'bug',
      severity: 'high',
      confidence: 0.9,
      missing_info: ['stack trace', 'node version'],
      suggested_labels: ['bug', 'needs-info'],
      summary: 'Crash on shutdown',
      injection_suspected: false,
    };

    const result = await triageTools.draftReply.execute({
      issue,
      verdict,
      tone: 'warm-professional',
    });

    expect(result.draft).toBeDefined();
    expect(result.draft.reply).toContain('Hi @alice');
    expect(result.draft.questions.length).toBe(2);
  },30000);
});
