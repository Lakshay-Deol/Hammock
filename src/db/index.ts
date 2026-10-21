import Database from 'better-sqlite3';
import type { Issue, VerdictRecord, Proposal, Receipt } from '../types/schemas.js';

export function getDatabase(dbPath = './hammock.db'): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize tables according to PLAN.md §5
  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author TEXT NOT NULL,
      state TEXT NOT NULL,
      labels_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      etag TEXT,
      embedded_at TEXT,
      UNIQUE(repo, number)
    );

    CREATE TABLE IF NOT EXISTS verdicts (
      issue_id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      confidence REAL NOT NULL,
      missing_info_json TEXT NOT NULL,
      suggested_labels_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      injection_suspected INTEGER NOT NULL,
      raw_json TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      risk TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      issue_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      outcome TEXT NOT NULL,
      user_edit_diff TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_issues_repo_number ON issues(repo, number);
    CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
    CREATE INDEX IF NOT EXISTS idx_receipts_run_id ON receipts(run_id);
  `);

  return db;
}

export class HammockRepository {
  private db: Database.Database;

  constructor(dbOrPath: Database.Database | string = './hammock.db') {
    if (typeof dbOrPath === 'string') {
      this.db = getDatabase(dbOrPath);
    } else {
      this.db = dbOrPath;
    }
  }

  saveIssue(issue: Issue): void {
    const stmt = this.db.prepare(`
      INSERT INTO issues (id, repo, number, title, body, author, state, labels_json, created_at, updated_at, etag, embedded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        state = excluded.state,
        labels_json = excluded.labels_json,
        updated_at = excluded.updated_at,
        etag = excluded.etag,
        embedded_at = excluded.embedded_at
    `);

    stmt.run(
      issue.id,
      issue.repo,
      issue.number,
      issue.title,
      issue.body,
      issue.author,
      issue.state,
      JSON.stringify(issue.labels),
      issue.created_at,
      issue.updated_at,
      issue.etag ?? null,
      issue.embedded_at ?? null
    );
  }

  getIssue(id: string): Issue | null {
    const stmt = this.db.prepare('SELECT * FROM issues WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: String(row['id']),
      repo: String(row['repo']),
      number: Number(row['number']),
      title: String(row['title']),
      body: String(row['body']),
      author: String(row['author']),
      state: row['state'] === 'closed' ? 'closed' : 'open',
      labels: JSON.parse(String(row['labels_json'] || '[]')) as string[],
      created_at: String(row['created_at']),
      updated_at: String(row['updated_at']),
      etag: row['etag'] ? String(row['etag']) : undefined,
      embedded_at: row['embedded_at'] ? String(row['embedded_at']) : undefined,
    };
  }

  saveVerdict(record: VerdictRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO verdicts (
        issue_id, model, type, severity, confidence,
        missing_info_json, suggested_labels_json, summary,
        injection_suspected, raw_json, latency_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        model = excluded.model,
        type = excluded.type,
        severity = excluded.severity,
        confidence = excluded.confidence,
        missing_info_json = excluded.missing_info_json,
        suggested_labels_json = excluded.suggested_labels_json,
        summary = excluded.summary,
        injection_suspected = excluded.injection_suspected,
        raw_json = excluded.raw_json,
        latency_ms = excluded.latency_ms,
        created_at = excluded.created_at
    `);

    stmt.run(
      record.issue_id,
      record.model,
      record.type,
      record.severity,
      record.confidence,
      JSON.stringify(record.missing_info),
      JSON.stringify(record.suggested_labels),
      record.summary,
      record.injection_suspected ? 1 : 0,
      record.raw_json,
      record.latency_ms,
      record.created_at
    );
  }

  getVerdict(issueId: string): VerdictRecord | null {
    const stmt = this.db.prepare('SELECT * FROM verdicts WHERE issue_id = ?');
    const row = stmt.get(issueId) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      issue_id: String(row['issue_id']),
      model: String(row['model']),
      type: row['type'] as VerdictRecord['type'],
      severity: row['severity'] as VerdictRecord['severity'],
      confidence: Number(row['confidence']),
      missing_info: JSON.parse(String(row['missing_info_json'] || '[]')) as string[],
      suggested_labels: JSON.parse(String(row['suggested_labels_json'] || '[]')) as string[],
      summary: String(row['summary']),
      injection_suspected: Boolean(row['injection_suspected']),
      raw_json: String(row['raw_json']),
      latency_ms: Number(row['latency_ms']),
      created_at: String(row['created_at']),
    };
  }

  saveProposal(proposal: Proposal): void {
    const stmt = this.db.prepare(`
      INSERT INTO proposals (id, issue_id, action, payload_json, risk, status, created_at, decided_at, decided_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        decided_at = excluded.decided_at,
        decided_by = excluded.decided_by
    `);

    stmt.run(
      proposal.id,
      proposal.issue_id,
      proposal.action,
      proposal.payload_json,
      proposal.risk,
      proposal.status,
      proposal.created_at,
      proposal.decided_at ?? null,
      proposal.decided_by ?? null
    );
  }

  saveReceipt(receipt: Receipt): void {
    const stmt = this.db.prepare(`
      INSERT INTO receipts (id, run_id, issue_id, action, payload_json, evidence_json, outcome, user_edit_diff, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      receipt.id,
      receipt.run_id,
      receipt.issue_id,
      receipt.action,
      receipt.payload_json,
      receipt.evidence_json,
      receipt.outcome,
      receipt.user_edit_diff ?? null,
      receipt.created_at
    );
  }

  close(): void {
    this.db.close();
  }
}
