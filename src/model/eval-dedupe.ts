import * as fs from 'node:fs';
import * as path from 'node:path';
import { IssueSchema, type Issue } from '../types/schemas.js';
import { getModelClient } from './factory.js';
import { getEmbeddingClient } from './embedding.js';
import { adjudicateDuplicate } from './dedupe.js';
import { cosineSimilarity } from '../db/index.js';
import { config } from '../config.js';

export interface DedupeBenchmarkPair {
  id: string;
  ground_truth_duplicate: boolean;
  target: Issue;
  candidate: Issue;
}

export interface DedupeBenchmarkMetrics {
  totalPairs: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
  meanSimilarityDuplicates: number;
  meanSimilarityNonDuplicates: number;
  avgLatencyMs: number;
}

export async function runDedupeBenchmark(
  datasetPath?: string,
  forceReplay?: boolean
): Promise<{ metrics: DedupeBenchmarkMetrics; details: Array<Record<string, unknown>> }> {
  const resolvedPath = datasetPath ?? path.resolve(process.cwd(), 'fixtures', 'benchmarks', 'dedupe-dataset.json');
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const dataset = JSON.parse(raw) as DedupeBenchmarkPair[];

  const rawModelClient = getModelClient(forceReplay);
  const rawEmbedClient = getEmbeddingClient(forceReplay);

  let modelClient = rawModelClient;
  let embedClient = rawEmbedClient;

  if (!forceReplay && !config.HAMMOCK_REPLAY) {
    const [modelHealth, embedHealth] = await Promise.all([
      rawModelClient.checkHealth(),
      rawEmbedClient.checkHealth(),
    ]);

    if (!modelHealth.ok || !embedHealth.ok) {
      modelClient = getModelClient(true);
      embedClient = getEmbeddingClient(true);
    }
  }

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  const duplicateSims: number[] = [];
  const nonDuplicateSims: number[] = [];
  const latencies: number[] = [];
  const details: Array<Record<string, unknown>> = [];

  for (const item of dataset) {
    const target = IssueSchema.parse(item.target);
    const candidate = IssueSchema.parse(item.candidate);

    const start = performance.now();
    const [vecA, vecB] = await embedClient.embedBatch([
      `${target.title} ${target.body}`,
      `${candidate.title} ${candidate.body}`,
    ]);

    const similarity = cosineSimilarity(vecA ?? [], vecB ?? []);
    if (item.ground_truth_duplicate) {
      duplicateSims.push(similarity);
    } else {
      nonDuplicateSims.push(similarity);
    }

    const adjudication = await adjudicateDuplicate(target, candidate, modelClient);
    const latency = Math.round(performance.now() - start);
    latencies.push(latency);

    const predicted = adjudication.is_duplicate;
    const actual = item.ground_truth_duplicate;

    if (predicted && actual) tp++;
    else if (predicted && !actual) fp++;
    else if (!predicted && !actual) tn++;
    else if (!predicted && actual) fn++;

    details.push({
      Pair: item.id,
      Target: `#${target.number} ${target.title.slice(0, 30)}...`,
      Candidate: `#${candidate.number} ${candidate.title.slice(0, 30)}...`,
      GroundTruth: actual ? 'DUPLICATE' : 'DISTINCT',
      Predicted: predicted ? 'DUPLICATE' : 'DISTINCT',
      Similarity: similarity.toFixed(3),
      Confidence: adjudication.confidence.toFixed(2),
      Evidence: adjudication.evidence.slice(0, 60) + '...',
      Match: predicted === actual ? '✅' : '❌',
    });
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1.0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1.0;
  const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const mean = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const metrics: DedupeBenchmarkMetrics = {
    totalPairs: dataset.length,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    f1Score: Number(f1Score.toFixed(3)),
    meanSimilarityDuplicates: Number(mean(duplicateSims).toFixed(3)),
    meanSimilarityNonDuplicates: Number(mean(nonDuplicateSims).toFixed(3)),
    avgLatencyMs: Math.round(mean(latencies)),
  };

  return { metrics, details };
}
