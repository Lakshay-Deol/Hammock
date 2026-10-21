import { HammockRepository } from '../db/index.js';
import { executeProposal } from '../github/write.js';
import { config } from '../config.js';
import type { Proposal, Receipt, Issue } from '../types/schemas.js';

export interface ProposalWithIssue {
  proposal: Proposal;
  issue: Issue | null;
  payload: Record<string, unknown>;
}

export class ApprovalService {
  private repo: HammockRepository;

  constructor(repo?: HammockRepository) {
    this.repo = repo ?? new HammockRepository(config.HAMMOCK_DB_PATH);
  }

  getPendingProposals(): ProposalWithIssue[] {
    const proposals = this.repo.getProposalsByStatus('pending');
    return proposals.map((p) => {
      const issue = this.repo.getIssue(p.issue_id);
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(p.payload_json) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      return {
        proposal: p,
        issue,
        payload,
      };
    });
  }

  async approveProposal(
    proposalId: string,
    actor: string,
    userEditedText?: string
  ): Promise<Receipt> {
    const proposal = this.repo.getProposal(proposalId);
    if (!proposal) {
      throw new Error(`Proposal with ID "${proposalId}" not found.`);
    }

    if (proposal.status !== 'pending') {
      throw new Error(`Cannot approve proposal "${proposalId}" with status "${proposal.status}".`);
    }

    const issue = this.repo.getIssue(proposal.issue_id);
    if (!issue) {
      throw new Error(`Associated issue "${proposal.issue_id}" not found.`);
    }

    let payload = JSON.parse(proposal.payload_json) as Record<string, unknown>;
    let isEdited = false;
    let diff: string | null = null;

    if (userEditedText !== undefined && proposal.action === 'comment') {
      const originalText = String(payload['body'] ?? '');
      if (userEditedText.trim() !== originalText.trim()) {
        isEdited = true;
        diff = `--- original\n+++ edited\n- ${originalText.replace(/\n/g, '\n- ')}\n+ ${userEditedText.replace(/\n/g, '\n+ ')}`;
        payload['body'] = userEditedText;
      }
    }

    // 1. Mark proposal approved
    proposal.status = 'approved';
    proposal.decided_at = new Date().toISOString();
    proposal.decided_by = actor;
    proposal.payload_json = JSON.stringify(payload);
    this.repo.saveProposal(proposal);

    // 2. Execute via write gate (Invariant 1)
    const receipt = await executeProposal({
      proposal,
      repo: issue.repo,
      issueNumber: issue.number,
      actor,
      runId: `approval_${Date.now()}`,
      evidenceJson: JSON.stringify({
        approvedBy: actor,
        timestamp: new Date().toISOString(),
        wasEdited: isEdited,
      }),
    });

    // 3. Record accurate outcome and user edit diff
    receipt.outcome = isEdited ? 'approved_edited' : 'approved_unedited';
    receipt.user_edit_diff = diff;
    this.repo.saveReceipt(receipt);

    return receipt;
  }

  async rejectProposal(
    proposalId: string,
    actor: string,
    reason = 'Rejected by maintainer tap'
  ): Promise<Receipt> {
    const proposal = this.repo.getProposal(proposalId);
    if (!proposal) {
      throw new Error(`Proposal with ID "${proposalId}" not found.`);
    }

    if (proposal.status !== 'pending') {
      throw new Error(`Cannot reject proposal "${proposalId}" with status "${proposal.status}".`);
    }

    // 1. Mark proposal rejected
    proposal.status = 'rejected';
    proposal.decided_at = new Date().toISOString();
    proposal.decided_by = actor;
    this.repo.saveProposal(proposal);

    // 2. PLAN.md Day 4: "rejecting leaves zero trace on the repo"
    // No call to executeProposal or GitHub API is made!

    // 3. Record rejected receipt
    const receipt: Receipt = {
      id: `rcpt_reject_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      run_id: `rejection_${Date.now()}`,
      issue_id: proposal.issue_id,
      action: proposal.action,
      payload_json: proposal.payload_json,
      evidence_json: JSON.stringify({
        rejectedBy: actor,
        reason,
        timestamp: new Date().toISOString(),
      }),
      outcome: 'rejected',
      user_edit_diff: null,
      created_at: new Date().toISOString(),
    };

    this.repo.saveReceipt(receipt);
    return receipt;
  }
}
