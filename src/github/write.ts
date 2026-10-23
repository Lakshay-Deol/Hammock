import { Octokit } from 'octokit';
import { config } from '../config.js';
import type { Proposal, Receipt } from '../types/schemas.js';

/**
 * Hard invariant 2:
 * assertWritable(repo) runs first in every write path.
 * It throws unless repo === config.HAMMOCK_SANDBOX_REPO.
 */
export function assertWritable(repo: string): void {
  if (!config.HAMMOCK_SANDBOX_REPO || repo !== config.HAMMOCK_SANDBOX_REPO) {
    throw new Error(
      `Safety invariant violation: repo "${repo}" is not the configured sandbox repository "${config.HAMMOCK_SANDBOX_REPO}". Writes are blocked.`
    );
  }
}

export interface ExecuteProposalOptions {
  proposal: Proposal;
  repo: string;
  issueNumber: number;
  octokit?: Octokit;
  actor: string;
  runId: string;
  evidenceJson?: string;
}

/**
 * Hard invariant 1:
 * Every GitHub write goes through executeProposal() in src/github/write.ts.
 * No other file may call issues.createComment, issues.update, issues.addLabels, issues.lock, or issues.remove*.
 */
export async function executeProposal(options: ExecuteProposalOptions): Promise<Receipt> {
  const { proposal, repo, issueNumber, octokit, actor, runId, evidenceJson = '{}' } = options;

  // Hard Invariant 2: Run first
  assertWritable(repo);

  // Hard Invariant 3: Comments are always approval-gated
  if (proposal.action === 'comment' && proposal.status !== 'approved') {
    throw new Error(
      `Hard invariant violation: Comments must be approval-gated. Cannot execute comment proposal with status "${proposal.status}".`
    );
  }

  // Parse repo owner and name
  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) {
    throw new Error(`Invalid repo format "${repo}". Expected "owner/repo".`);
  }

  const payload = JSON.parse(proposal.payload_json) as Record<string, unknown>;

  // Check dry-run mode
  if (config.HAMMOCK_DRY_RUN) {
    const receipt: Receipt = {
      id: `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      run_id: runId,
      issue_id: proposal.issue_id,
      action: proposal.action,
      payload_json: proposal.payload_json,
      evidence_json: evidenceJson,
      outcome: 'auto_applied',
      created_at: new Date().toISOString(),
    };
    return receipt;
  }

  // Build the client from the environment when a caller does not supply one.
  // Every write still routes through this function (Invariant 1) and past assertWritable (Invariant 2).
  if (!octokit && !config.GITHUB_TOKEN) {
    throw new Error('Octokit instance required for real writes when HAMMOCK_DRY_RUN=0.');
  }
  const client = octokit ?? new Octokit({ auth: config.GITHUB_TOKEN });

  switch (proposal.action) {
    case 'label': {
      const labels = Array.isArray(payload['labels']) ? (payload['labels'] as string[]) : [];
      if (labels.length > 0) {
        await client.rest.issues.addLabels({
          owner,
          repo: repoName,
          issue_number: issueNumber,
          labels,
        });
      }
      break;
    }
    case 'comment': {
      const body = typeof payload['body'] === 'string' ? payload['body'] : '';
      if (!body) throw new Error('Missing comment body in payload.');
      await client.rest.issues.createComment({
        owner,
        repo: repoName,
        issue_number: issueNumber,
        body,
      });
      break;
    }
    case 'close': {
      await client.rest.issues.update({
        owner,
        repo: repoName,
        issue_number: issueNumber,
        state: 'closed',
      });
      break;
    }
    case 'lock': {
      await client.rest.issues.lock({
        owner,
        repo: repoName,
        issue_number: issueNumber,
      });
      break;
    }
    case 'assign': {
      const assignees = Array.isArray(payload['assignees']) ? (payload['assignees'] as string[]) : [];
      if (assignees.length > 0) {
        await client.rest.issues.addAssignees({
          owner,
          repo: repoName,
          issue_number: issueNumber,
          assignees,
        });
      }
      break;
    }
  }

  const receipt: Receipt = {
    id: `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    run_id: runId,
    issue_id: proposal.issue_id,
    action: proposal.action,
    payload_json: proposal.payload_json,
    evidence_json: evidenceJson,
    outcome: proposal.action === 'comment' ? 'approved_unedited' : 'auto_applied',
    user_edit_diff: typeof payload['user_edit_diff'] === 'string' ? payload['user_edit_diff'] : null,
    created_at: new Date().toISOString(),
  };

  return receipt;
}
