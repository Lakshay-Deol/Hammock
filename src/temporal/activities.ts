import { fetchUpdatedIssues, type FetchIssuesResult } from '../github/fetch.js';
import { executeProposal } from '../github/write.js';
import { HammockRepository } from '../db/index.js';
import { getModelClient } from '../model/factory.js';
import { getEmbeddingClient } from '../model/embedding.js';
import { findAndAdjudicateDuplicates } from '../model/dedupe.js';
import { generateDraftReply } from '../model/draft.js';
import { loadPolicy } from '../policy/index.js';
import { config } from '../config.js';
import type { Issue, VerdictOutput, DuplicateCandidate, DraftReply, Proposal } from '../types/schemas.js';

export interface TriageIssueActivityResult {
  issueId: string;
  verdict: VerdictOutput;
  candidates: DuplicateCandidate[];
  draft: DraftReply;
  latencyMs: number;
}

export interface ActionsResult {
  appliedLabels: string[];
  queuedProposals: string[];
}

export interface RunDigest {
  runId: string;
  repo: string;
  totalIssues: number;
  labelsApplied: number;
  proposalsQueued: number;
  duplicatesFound: number;
  completedAt: string;
}

/**
 * Temporal Activity 1: Idempotent Fetch
 */
export async function fetchIssuesActivity(params: {
  repo: string;
  since?: string;
  etag?: string;
}): Promise<FetchIssuesResult> {
  return fetchUpdatedIssues(params);
}

/**
 * Temporal Activity 2: Classify, Embed, Dedupe, and Draft
 */
export async function triageIssueActivity(params: {
  issue: Issue;
  runId: string;
}): Promise<TriageIssueActivityResult> {
  const { issue, runId } = params;
  const rawModel = getModelClient();
  const rawEmbed = getEmbeddingClient();

  let modelClient = rawModel;
  let embedClient = rawEmbed;

  if (!config.HAMMOCK_REPLAY) {
    const [mHealth, eHealth] = await Promise.all([rawModel.checkHealth(), rawEmbed.checkHealth()]);
    if (!mHealth.ok || !eHealth.ok) {
      modelClient = getModelClient(true);
      embedClient = getEmbeddingClient(true);
    }
  }

  const repo = new HammockRepository(config.HAMMOCK_DB_PATH);
  try {
    // 1. Save issue
    repo.saveIssue(issue);

    // 2. Classify issue
    const classifyRes = await modelClient.classifyIssue(issue);

    // 3. Save verdict
    repo.saveVerdict({
      ...classifyRes.verdict,
      issue_id: issue.id,
      model: modelClient.name,
      raw_json: classifyRes.rawJson,
      latency_ms: classifyRes.latencyMs,
      created_at: new Date().toISOString(),
    });

    // 4. Generate & save embedding
    const textToEmbed = `${issue.title}\n\n${issue.body}`;
    const vector = await embedClient.embed(textToEmbed);
    repo.saveEmbedding(issue.id, embedClient.name, vector);

    // 5. Adjudicate duplicates
    const candidates = await findAndAdjudicateDuplicates(
      issue,
      repo,
      modelClient,
      embedClient,
      3
    );

    // 6. Draft reply
    const policy = loadPolicy();
    const draft = await generateDraftReply(issue, classifyRes.verdict, policy.tone, modelClient);

    return {
      issueId: issue.id,
      verdict: classifyRes.verdict,
      candidates,
      draft,
      latencyMs: classifyRes.latencyMs,
    };
  } finally {
    repo.close();
  }
}

/**
 * Temporal Activity 3: Apply Allowlisted Labels and Queue Proposals
 */
export async function applyAllowlistActivity(params: {
  issue: Issue;
  verdict: VerdictOutput;
  candidates: DuplicateCandidate[];
  draft: DraftReply;
  runId: string;
}): Promise<ActionsResult> {
  const { issue, verdict, candidates, draft, runId } = params;
  const policy = loadPolicy();
  const repo = new HammockRepository(config.HAMMOCK_DB_PATH);

  const appliedLabels: string[] = [];
  const queuedProposals: string[] = [];

  try {
    // Ensure issue exists in repository
    repo.saveIssue(issue);

    // Filter labels by policy allowlist
    const autoAllowed = new Set(policy.labels.auto);
    const neverAllowed = new Set(policy.labels.never);

    const eligibleLabels = verdict.suggested_labels.filter(
      (l) => autoAllowed.has(l) && !neverAllowed.has(l)
    );

    // Add duplicate label if confirmed duplicate candidate exists
    const hasDuplicate = candidates.some((c) => c.is_duplicate && c.confidence >= 0.85);
    if (hasDuplicate && autoAllowed.has('duplicate') && !neverAllowed.has('duplicate')) {
      if (!eligibleLabels.includes('duplicate')) {
        eligibleLabels.push('duplicate');
      }
    }

    const finalLabels = eligibleLabels.slice(0, policy.limits.max_labels_per_issue);

    // Execute allowlisted label write via executeProposal() (Invariant 1)
    if (finalLabels.length > 0) {
      const labelProposal: Proposal = {
        id: `prop_label_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        issue_id: issue.id,
        action: 'label',
        payload_json: JSON.stringify({ labels: finalLabels }),
        risk: 'low',
        status: 'approved', // Auto-allowlisted labels are pre-approved by policy
        created_at: new Date().toISOString(),
      };

      const receipt = await executeProposal({
        proposal: labelProposal,
        repo: issue.repo,
        issueNumber: issue.number,
        actor: 'hammock-temporal-worker',
        runId,
        evidenceJson: JSON.stringify({ autoLabels: finalLabels, policy: '.hammock.yml' }),
      });

      repo.saveReceipt(receipt);
      appliedLabels.push(...finalLabels);
    }

    // Queue draft comment as pending proposal (Invariant 3: Comments are ALWAYS approval-gated)
    if (draft.questions.length > 0 && !verdict.injection_suspected) {
      const commentProposal: Proposal = {
        id: `prop_comment_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        issue_id: issue.id,
        action: 'comment',
        payload_json: JSON.stringify({ body: draft.reply }),
        risk: 'medium',
        status: 'pending', // Strictly pending human tap!
        created_at: new Date().toISOString(),
      };

      repo.saveProposal(commentProposal);
      queuedProposals.push(commentProposal.id);
    }

    return { appliedLabels, queuedProposals };
  } finally {
    repo.close();
  }
}

/**
 * Temporal Activity 4: Save Run Digest
 */
export async function saveRunDigestActivity(params: {
  runId: string;
  repo: string;
  totalIssues: number;
  labelsApplied: number;
  proposalsQueued: number;
  duplicatesFound: number;
}): Promise<RunDigest> {
  const digest: RunDigest = {
    ...params,
    completedAt: new Date().toISOString(),
  };

  return digest;
}
