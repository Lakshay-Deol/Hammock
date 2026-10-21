import * as fs from 'node:fs';
import * as path from 'node:path';
import { Octokit } from 'octokit';
import { config } from '../config.js';
import { IssueSchema, type Issue } from '../types/schemas.js';

export interface FetchIssuesOptions {
  repo: string;
  since?: string;
  etag?: string;
  octokit?: Octokit;
  forceReplay?: boolean;
}

export interface FetchIssuesResult {
  issues: Issue[];
  etag?: string;
  notModified: boolean;
  fetchedAt: string;
}

/**
 * Idempotent GitHub issue fetch using conditional requests (ETag and since).
 * Reads from fixtures directory when in replay mode or offline.
 */
export async function fetchUpdatedIssues(
  options: FetchIssuesOptions
): Promise<FetchIssuesResult> {
  const { repo, since, etag, octokit, forceReplay } = options;
  const isReplay = forceReplay || config.HAMMOCK_REPLAY || !config.GITHUB_TOKEN;

  if (isReplay) {
    return fetchIssuesReplay(repo, since);
  }

  const client = octokit ?? new Octokit({ auth: config.GITHUB_TOKEN });
  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) {
    throw new Error(`Invalid repo format "${repo}". Expected "owner/repo".`);
  }

  const headers: Record<string, string> = {};
  if (etag) {
    headers['if-none-match'] = etag;
  }

  try {
    const res = await client.rest.issues.listForRepo({
      owner,
      repo: repoName,
      state: 'all',
      since,
      per_page: 50,
      headers,
    });

    const newEtag = res.headers.etag;
    const issues: Issue[] = res.data
      .filter((item) => !item.pull_request) // filter out pull requests
      .map((item) =>
        IssueSchema.parse({
          id: `${repo}#${item.number}`,
          repo,
          number: item.number,
          title: item.title,
          body: item.body ?? '',
          author: item.user?.login ?? 'ghost',
          state: item.state === 'closed' ? 'closed' : 'open',
          labels: item.labels.map((l) => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean),
          created_at: item.created_at,
          updated_at: item.updated_at,
          etag: newEtag,
        })
      );

    return {
      issues,
      etag: newEtag,
      notModified: false,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 304) {
      return {
        issues: [],
        etag,
        notModified: true,
        fetchedAt: new Date().toISOString(),
      };
    }
    throw err;
  }
}

/**
 * Deterministic replay fetcher reading fixture issues.
 */
export function fetchIssuesReplay(repo: string, since?: string): FetchIssuesResult {
  const fixturesDir = path.resolve(process.cwd(), 'fixtures');
  if (!fs.existsSync(fixturesDir)) {
    return { issues: [], notModified: true, fetchedAt: new Date().toISOString() };
  }

  const files = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('recorded') && !f.includes('dataset'))
    .sort();

  const issues: Issue[] = [];
  for (const file of files) {
    const filePath = path.join(fixturesDir, file);
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = IssueSchema.parse(JSON.parse(raw));

    // Filter by since if provided
    if (since && new Date(parsed.updated_at) < new Date(since)) {
      continue;
    }

    issues.push({
      ...parsed,
      repo: repo || parsed.repo,
    });
  }

  return {
    issues,
    etag: '"fixture-etag-v1"',
    notModified: false,
    fetchedAt: new Date().toISOString(),
  };
}
