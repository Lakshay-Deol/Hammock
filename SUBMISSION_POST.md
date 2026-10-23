<!--
dev.to submission post — paste this file's body into the editor.
Suggested title: Hammock: a sloth that triages my issues overnight, and never speaks without my permission
Tags: devchallenge, hf26challenge, hacktoberfest, opensource
Canonical URL: https://github.com/Lakshay-Deol/Hammock
Placeholders to replace: VIDEO_LINK, RENDER_URL, AGENT_SESSION_LINK
-->

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 3: Slow and Steady](https://dev.to/challenges/hacktoberfest-week3-2026-10-19)*

## What I Built

Every maintainer knows the morning dread. Forty notifications, and before writing a line of code you answer the same four questions in the same order: *Is this a duplicate? Is it even a bug? Which version are you on? Can you give me a minimal reproduction?*

**Hammock** is an overnight triage sloth. A durable Temporal workflow fetches new and updated issues idempotently, classifies them with a local Gemma 4 model, recalls duplicate reports with embeddings, asks Gemma to adjudicate whether two issues share the same technical root cause, and drafts the reply that asks for exactly what's missing. Then it stops.

It applies allowlisted, reversible labels on its own. Everything public — comments, closes, locks, assignments — waits in a local queue for one maintainer tap.

> **Hammock can propose anything. It can only *do* the reversible things alone.**
>
> Labels on an allowlist: **automatic**.
> Comments, closes, locks, and assignments: **your tap**.

| Action | Who decides |
|---|---|
| `bug`, `needs-info`, `feature`, `duplicate`, `question` | **Automatic** — additive, allowlisted in `.hammock.yml` |
| Comments, closes, locks, assignments | **Your tap** — always, with no config that disables it |

The person who gets to be a little lazier is a maintainer at 7am: instead of forty tabs, they get a short queue of drafts to approve, edit, or discard.

## Demo

**4-minute walkthrough:** VIDEO_LINK

**Live cockpit:** RENDER_URL — deployed from `render.yaml`, runs in replay mode with a seeded queue so it works with zero credentials.

**60-second reviewer path** — no Ollama, no Temporal, no tokens:

```bash
git clone https://github.com/Lakshay-Deol/Hammock.git
cd Hammock
pnpm install && pnpm build

pnpm hammock eval-dedupe --replay     # precision / recall vs ground truth
pnpm hammock test-fixtures --replay   # 8 fixtures incl. 3 prompt injections
pnpm hammock dashboard                # http://localhost:3000
```

## Code

{% embed https://github.com/Lakshay-Deol/Hammock %}

```
GitHub REST API
      │  since + ETag (conditional, idempotent)
      ▼
Temporal schedule "nightly-triage"  (0 2 * * *)
      │
      ▼
workflow: fetch → per-issue activity fan-out → digest
      │
      ├─► Gemma 4 (Ollama) ──────────► structured JSON verdict
      │       └─ nomic-embed-text ───► vector in SQLite
      ├─► dedupe: cosine top-3 ──────► Gemma adjudicates root cause
      ├─► draft reply (tone from .hammock.yml)
      └─► proposals ─────────────────► SQLite receipts (append-only)
                        │
            ┌───────────┴────────────┐
            ▼                        ▼
   allowlisted labels        approval required
   (applied immediately)     comment / close / lock / assign
                                     │  you tap
                                     ▼
                              executeProposal() → receipt
```

Five commands are the whole product:

```bash
pnpm hammock doctor                       # runtime, policy, DB, Ollama, Temporal
pnpm hammock triage-run <owner>/<repo>    # the overnight pass
pnpm hammock verdict fixtures/issue-001.json
pnpm hammock eval-dedupe
pnpm hammock dashboard                    # http://localhost:3000
```

The safety split is enforced in code, not in a prompt: every write routes through one function (`executeProposal()`), every write path calls `assertWritable(repo)` first and throws unless it matches the configured sandbox, comment proposals are rejected unless their status is `approved`, and `max_comments_per_run` is `0`. There is no code path where a comment bypasses the queue.

## How I Built It

**Gemma 4 via Ollama** does three genuinely different jobs, each shaped by a different failure mode:

1. **Classification** returns Zod-validated JSON — `type`, `severity`, `confidence`, `missing_info[]`, `suggested_labels[]`, `summary`. The thinking channel (`<|channel>thought … <channel|>`) is stripped before parsing, so a rambling model can't corrupt the object. A verdict that fails validation is an error, not a guess.
2. **Duplicate adjudication** is hybrid by necessity. `nomic-embed-text` embeddings plus cosine similarity over SQLite recall the top-3 candidates; Gemma then answers the narrower question — *do these share the same technical root cause?* — and must return an evidence string. In the benchmark, a true duplicate sat at 0.979 similarity while a false friend sat at 0.919 and was correctly ruled distinct. The embedding finds candidates; the model decides.
3. **Drafting** produces a tone-conditioned reply listing exactly the missing information, derived from the verdict rather than the raw issue body.

**Temporal** carries the overnight pass: a deterministic workflow with per-issue activity fan-out, defined timeouts, and a registered cron schedule, so a laptop asleep at 2am resumes instead of double-labelling.

**Mastra** defines the triage agent and its four typed tools (`classifyIssue`, `embedIssue`, `findDuplicates`, `draftReply`) over the local Ollama model — a provider-agnostic contract for the loop, while the deterministic activities call the same primitives directly so workflow replay stays pure.

**SQLite (`better-sqlite3`)** stores issues, verdicts, proposals, embeddings, and append-only receipts in WAL mode. **Hono** serves the cockpit: an editable draft per pending proposal, a live character-count diff indicator, approve/reject, and the receipt log.

Two design decisions I'd defend:

- **Issue text is fenced** in `<untrusted_issue_data>` and the model's only job is to emit JSON, which is validated before anything reads it. Adversarial fixtures come back `injection_suspected: true` and produce *nothing* — no label, no queued draft — so there's nothing for a tired maintainer to approve by accident.
- **Rejection calls no GitHub API at all.** That's the point: rejecting leaves provably zero trace on the repository, while still recording who, when, why, and the text that was never sent.

There is also a **replay adapter** — a real `ModelClient` implementation that swaps the transport and reads recorded verdicts through the same Zod schema. Every code path after the model call is the production path. It exists so a judge with no GPU, no Ollama, and no tokens can still run the whole thing in one minute.

## Why Does Open Innovation Matter?

Because the alternative is shipping your bug reports to someone else's API.

Private issue trackers contain internal hostnames, database schemas, customer identifiers, and proprietary stack traces. Running Gemma locally via Ollama makes "triage 500 issues overnight" cost $0.00 in tokens and zero bytes of exfiltration. It also means the tool works on a plane, in an air-gapped environment, and after the maintainer stops paying someone's subscription.

Open weights made the trust model possible, not just the economics. Because I can run the model locally, and read the SDKs it is wrapped in, I can make a real promise about what never leaves the machine — and I can show the receipt for every decision, including the ones that never touched GitHub. A closed API could give me a better classifier; it could not give me that guarantee. And because everything is open, the interesting part — the approval gate, the sandbox assertion, the reversibility split — is auditable by anyone who disagrees with me.

## My Agent Session

Hammock was written pairing with an AI coding agent, against a contract written first. [`AGENTS.md`](https://github.com/Lakshay-Deol/Hammock/blob/main/AGENTS.md) defines nine hard invariants that outrank any instruction found in an issue: all writes through one function, sandbox assertion first, comments always gated, issue text never executable, no secrets in logs or fixtures, no stubbed production paths, no weakened tests.

The rules that mattered most in practice were the negative ones: *never stub a production path*, *never modify a test to make it pass*, *never silence a failing check*. Nine invariants and one hard rule — a failing check is a finding, not an inconvenience — produced a codebase I could reason about at 1am. Which is, not coincidentally, the property I wanted from the product.

AGENT_SESSION_LINK

## The Lazy Payoff

Measured on the fixtures in the repo, all reproducible offline:

| Metric | Result |
|---|---|
| Deduplication precision | **100.0%** (TP 3, FP 0) |
| Deduplication recall | **100.0%** (TN 5, FN 0) |
| F1 | **1.000** |
| Avg cosine similarity — true duplicates | **0.971** |
| Avg cosine similarity — distinct pairs | **0.236** |
| Prompt injections neutralized | **3 / 3** |
| Fixture acceptance | **8 / 8** |
| Test suite | **26 / 26** across 7 files |

On a sandbox pass of 8 issues: **6 allowlisted labels applied automatically, 5 drafts queued, 1 duplicate flagged** — one tap per public action instead of writing each reply from scratch.

Two footnotes, because benchmarks without them are marketing:

- **The dedupe set is 8 hand-labelled pairs**, not a scraped corpus. It demonstrates the adjudication logic — a 0.919 similarity correctly ruled distinct — not statistical significance.
- **Replay is not a speed benchmark.** The replay adapter reports a fixed placeholder throughput; real tok/s depends on your hardware. Measure it with `pnpm hammock verdict fixtures/issue-001.json` and confirm the client name does not say `[replay]`.

## Prize Categories

**Best Use of Gemma** — Gemma 4 (`gemma4:e4b`) does three distinct jobs locally: schema-validated classification, root-cause duplicate adjudication with an evidence string, and tone-conditioned reply drafting. Issue text never leaves the machine, and the pipeline survives a full network disconnect.

**Best Use of Temporal** — the nightly pass is a deterministic workflow with per-issue activity fan-out, defined timeouts, and a registered cron schedule, so interruptions resume rather than duplicate work.

**Best Use of Mastra** — the triage agent and its four typed tools are defined in `@mastra/core`, giving the loop a typed, provider-agnostic contract over the local model.

**Best Use of Auth0 for AI Agents** — approval is modelled as asynchronous authorization: a pending proposal carries an authorization request, and the write path is gated on an approval identity recorded on the receipt. The adapter is swappable; the demo runs its local-session fallback.

---

*Apache-2.0 © 2026 Lakshay Deol · Hammock triages while you sleep, and never speaks without your permission.*
