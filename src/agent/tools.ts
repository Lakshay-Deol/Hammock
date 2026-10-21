import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { IssueSchema, VerdictOutputSchema, DuplicateCandidateSchema, DraftReplySchema } from '../types/schemas.js';
import { getModelClient } from '../model/factory.js';
import { getEmbeddingClient } from '../model/embedding.js';
import { HammockRepository } from '../db/index.js';
import { findAndAdjudicateDuplicates } from '../model/dedupe.js';
import { generateDraftReply } from '../model/draft.js';
import { loadPolicy } from '../policy/index.js';
import { config } from '../config.js';

async function resolveClients() {
  const rawModel = getModelClient();
  const rawEmbed = getEmbeddingClient();

  if (!config.HAMMOCK_REPLAY) {
    const [mHealth, eHealth] = await Promise.all([rawModel.checkHealth(), rawEmbed.checkHealth()]);
    if (!mHealth.ok || !eHealth.ok) {
      return {
        modelClient: getModelClient(true),
        embedClient: getEmbeddingClient(true),
      };
    }
  }

  return { modelClient: rawModel, embedClient: rawEmbed };
}

export const classifyIssueTool = createTool({
  id: 'classify_issue',
  description: 'Classify an untrusted GitHub issue using local Gemma 4 into bug, feature, question, etc.',
  inputSchema: z.object({
    issue: IssueSchema,
  }),
  outputSchema: z.object({
    verdict: VerdictOutputSchema,
    latencyMs: z.number(),
    tokensPerSec: z.number().optional(),
  }),
  execute: async ({ issue }) => {
    const { modelClient } = await resolveClients();
    const result = await modelClient.classifyIssue(issue);
    return {
      verdict: result.verdict,
      latencyMs: result.latencyMs,
      tokensPerSec: result.tokensPerSec,
    };
  },
});

export const embedIssueTool = createTool({
  id: 'embed_issue',
  description: 'Generate semantic embedding vector for an issue via nomic-embed-text and store in SQLite',
  inputSchema: z.object({
    issue: IssueSchema,
  }),
  outputSchema: z.object({
    dimensions: z.number(),
    model: z.string(),
  }),
  execute: async ({ issue }) => {
    const { embedClient } = await resolveClients();
    const text = `${issue.title}\n\n${issue.body}`;
    const vector = await embedClient.embed(text);

    const repo = new HammockRepository(config.HAMMOCK_DB_PATH);
    try {
      repo.saveIssue(issue);
      repo.saveEmbedding(issue.id, embedClient.name, vector);
    } finally {
      repo.close();
    }

    return {
      dimensions: vector.length,
      model: embedClient.name,
    };
  },
});

export const findDuplicatesTool = createTool({
  id: 'find_duplicates',
  description: 'Search for duplicate issues using cosine similarity recall and Gemma 4 adjudication',
  inputSchema: z.object({
    issue: IssueSchema,
    topK: z.number().int().positive().default(3),
  }),
  outputSchema: z.object({
    candidates: z.array(DuplicateCandidateSchema),
  }),
  execute: async ({ issue, topK }) => {
    const { modelClient, embedClient } = await resolveClients();
    const repo = new HammockRepository(config.HAMMOCK_DB_PATH);

    try {
      const candidates = await findAndAdjudicateDuplicates(
        issue,
        repo,
        modelClient,
        embedClient,
        topK
      );
      return { candidates };
    } finally {
      repo.close();
    }
  },
});

export const draftReplyTool = createTool({
  id: 'draft_reply',
  description: 'Draft a tone-conditioned response requesting missing information for an issue',
  inputSchema: z.object({
    issue: IssueSchema,
    verdict: VerdictOutputSchema,
    tone: z.string().optional(),
  }),
  outputSchema: z.object({
    draft: DraftReplySchema,
  }),
  execute: async ({ issue, verdict, tone }) => {
    const policy = loadPolicy();
    const effectiveTone = tone ?? policy.tone;
    const { modelClient } = await resolveClients();

    const draft = await generateDraftReply(issue, verdict, effectiveTone, modelClient);
    return { draft };
  },
});

export const triageTools = {
  classifyIssue: classifyIssueTool,
  embedIssue: embedIssueTool,
  findDuplicates: findDuplicatesTool,
  draftReply: draftReplyTool,
};
