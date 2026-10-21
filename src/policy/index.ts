import * as fs from 'node:fs';
import * as yaml from 'yaml';
import { z } from 'zod';

export const PolicySchema = z.object({
  tone: z.enum(['warm-professional', 'terse', 'friendly']).default('warm-professional'),
  labels: z.object({
    auto: z.array(z.string()).default(['bug', 'question', 'feature', 'needs-info', 'duplicate']),
    never: z.array(z.string()).default(['security', 'good-first-issue']),
  }),
  approve: z.array(z.enum(['comment', 'close', 'lock', 'assign', 'label'])).default(['comment', 'close', 'lock', 'assign']),
  limits: z.object({
    max_labels_per_issue: z.number().int().positive().default(4),
    max_comments_per_run: z.literal(0).default(0), // Comments are ALWAYS approval gated
  }),
});

export type Policy = z.infer<typeof PolicySchema>;

export const DEFAULT_POLICY: Policy = {
  tone: 'warm-professional',
  labels: {
    auto: ['bug', 'question', 'feature', 'needs-info', 'duplicate'],
    never: ['security', 'good-first-issue'],
  },
  approve: ['comment', 'close', 'lock', 'assign'],
  limits: {
    max_labels_per_issue: 4,
    max_comments_per_run: 0,
  },
};

export function loadPolicy(filePath = './.hammock.yml'): Policy {
  if (!fs.existsSync(filePath)) {
    return DEFAULT_POLICY;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.parse(content);
  return PolicySchema.parse(parsed);
}
