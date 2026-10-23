import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities.js';
import type { RunDigest } from './activities.js';

const {
  fetchIssuesActivity,
  triageIssueActivity,
  applyAllowlistActivity,
  saveRunDigestActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export interface NightlyTriageWorkflowInput {
  repo: string;
  runId: string;
  since?: string;
  etag?: string;
}

/**
 * Deterministic Temporal Workflow:
 * Nightly GitHub Issue Triage with per-issue fan-out, allowlisted auto-labeling,
 * and approval-gated proposal generation.
 */
export async function nightlyTriageWorkflow(
  input: NightlyTriageWorkflowInput
): Promise<RunDigest> {
  const { repo, runId, since, etag } = input;

  // 1. Fetch updated issues idempotently using since + ETag
  const fetchResult = await fetchIssuesActivity({ repo, since, etag });

  if (fetchResult.notModified || fetchResult.issues.length === 0) {
    return saveRunDigestActivity({
      runId,
      repo,
      totalIssues: 0,
      labelsApplied: 0,
      proposalsQueued: 0,
      duplicatesFound: 0,
    });
  }

  let totalLabelsApplied = 0;
  let totalProposalsQueued = 0;
  let totalDuplicatesFound = 0;

  // 2. Per-issue fan-out triage activities
  for (const issue of fetchResult.issues) {
    const triageRes = await triageIssueActivity({ issue, runId });

    if (triageRes.candidates.some((c) => c.is_duplicate)) {
      totalDuplicatesFound++;
    }

    // 3. Allowlist label enforcement and proposal queueing
    const actionRes = await applyAllowlistActivity({
      issue,
      verdict: triageRes.verdict,
      candidates: triageRes.candidates,
      draft: triageRes.draft,
      runId,
    });

    totalLabelsApplied += actionRes.appliedLabels.length;
    totalProposalsQueued += actionRes.queuedProposals.length;
  }

  // 4. Record and return run digest
  return saveRunDigestActivity({
    runId,
    repo,
    totalIssues: fetchResult.issues.length,
    labelsApplied: totalLabelsApplied,
    proposalsQueued: totalProposalsQueued,
    duplicatesFound: totalDuplicatesFound,
  });
}
