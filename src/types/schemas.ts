import { z } from 'zod';

export const IssueSchema = z.object({
  id: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  author: z.string(),
  state: z.enum(['open', 'closed']).default('open'),
  labels: z.array(z.string()).default([]),
  created_at: z.string(),
  updated_at: z.string(),
  etag: z.string().optional(),
  embedded_at: z.string().optional(),
});

export type Issue = z.infer<typeof IssueSchema>;

export const VerdictTypeEnum = z.enum(['bug', 'feature', 'question', 'documentation', 'chore']);
export type VerdictType = z.infer<typeof VerdictTypeEnum>;

export const SeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeverityEnum>;

export const VerdictOutputSchema = z.object({
  type: VerdictTypeEnum,
  severity: SeverityEnum,
  confidence: z.number().min(0).max(1),
  missing_info: z.array(z.string()),
  suggested_labels: z.array(z.string()),
  summary: z.string(),
  injection_suspected: z.boolean(),
});

export type VerdictOutput = z.infer<typeof VerdictOutputSchema>;

export const VerdictRecordSchema = VerdictOutputSchema.extend({
  issue_id: z.string(),
  model: z.string(),
  raw_json: z.string(),
  latency_ms: z.number().int().nonnegative(),
  created_at: z.string(),
});

export type VerdictRecord = z.infer<typeof VerdictRecordSchema>;

export const ProposalActionEnum = z.enum(['label', 'comment', 'close', 'lock', 'assign']);
export type ProposalAction = z.infer<typeof ProposalActionEnum>;

export const ProposalStatusEnum = z.enum(['pending', 'approved', 'rejected', 'executed']);
export type ProposalStatus = z.infer<typeof ProposalStatusEnum>;

export const ProposalSchema = z.object({
  id: z.string(),
  issue_id: z.string(),
  action: ProposalActionEnum,
  payload_json: z.string(),
  risk: z.enum(['low', 'medium', 'high']),
  status: ProposalStatusEnum,
  created_at: z.string(),
  decided_at: z.string().nullable().optional(),
  decided_by: z.string().nullable().optional(),
});

export type Proposal = z.infer<typeof ProposalSchema>;

export const ReceiptOutcomeEnum = z.enum(['approved_unedited', 'approved_edited', 'rejected', 'auto_applied']);
export type ReceiptOutcome = z.infer<typeof ReceiptOutcomeEnum>;

export const ReceiptSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  issue_id: z.string(),
  action: ProposalActionEnum,
  payload_json: z.string(),
  evidence_json: z.string(),
  outcome: ReceiptOutcomeEnum,
  user_edit_diff: z.string().nullable().optional(),
  created_at: z.string(),
});

export type Receipt = z.infer<typeof ReceiptSchema>;

export const DuplicateCandidateSchema = z.object({
  target_issue_id: z.string(),
  candidate_issue_id: z.string(),
  similarity: z.number().min(-1).max(1),
  is_duplicate: z.boolean(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
});

export type DuplicateCandidate = z.infer<typeof DuplicateCandidateSchema>;

export const DraftReplySchema = z.object({
  issue_id: z.string(),
  tone: z.string(),
  reply: z.string(),
  questions: z.array(z.string()),
});

export type DraftReply = z.infer<typeof DraftReplySchema>;
