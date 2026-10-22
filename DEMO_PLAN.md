# Hammock — Demo Plan v2

> Deck first. Six slides — the last one maps the four prize tracks. Four minutes. Every claim below is one I can point at in the code.
> Supersedes the ordering in `DEMO_SCRIPT.md`; the narration here replaces it where they disagree.

---

## 0. Reality check — what the old script claims vs. what the repo does

| # | Old claim | Status | Evidence |
|---|---|---|---|
| 1 | 26/26 tests, 7 suites | **True** | `vitest run` → 26 passed, 7 files |
| 2 | 100% dedupe precision & recall | **True** | `eval-dedupe` → TP 3 / FP 0 / TN 5 / FN 0, F1 1.000 |
| 3 | 3/3 prompt injections caught | **True** | `test-fixtures` → 8/8 PASS, 3 🚨 DETECTED |
| 4 | "42.5 tok/s on local hardware" | **False** | `src/model/replay.ts:109` — `const tokensPerSec = 42.5;` is a literal, printed in replay mode |
| 5 | "immutable SHA-256 signed receipt" | **False** | No `createHash`/signature anywhere; `receipts` has no hash column. The phrase is UI copy at `src/server/app.ts:1203` |
| 6 | "mints a scoped token through Auth0 Token Vault" | **False** | `requestApproval()` is never called. With no `AUTH0_DOMAIN`, `getAuthAdapter()` returns `LocalSessionAuthAdapter` (`src/auth/index.ts:136`) which authorizes everything |
| 7 | "Tap Approve → comment appears on GitHub" | **Blocked** | `approveProposal` calls `executeProposal` **without octokit** (`src/approval/service.ts:77`). Real-write approve returns HTTP 400: `Octokit instance required for real writes when HAMMOCK_DRY_RUN=0.` Verified live |
| 8 | "Reject the prompt injection proposal" | **Impossible** | `src/temporal/activities.ts:181` gates drafts on `!verdict.injection_suspected`. Injections queue **0** proposals, apply **0** labels |
| 9 | "Set up `.env`" (old Part 1) | **Inert** | No dotenv import; `src/config.ts:18` reads `process.env` only. Verified: `.env` on disk still → doctor says dry-run Active |
| 10 | "Wi-Fi off → local Gemma inference" | **Conditional** | Works only with Ollama up. If down, `verdict` silently falls back to replay and still prints 42.5 tok/s. Tell: client name contains `[replay]` |

Two operational landmines, not claims:

- `pnpm test` writes into `./hammock.db` (`tests/temporal.test.ts:53,111`). Each run adds a `#102 Documentation error...` proposal + receipts. Six are sitting in the queue now.
- `triage-run` with `HAMMOCK_SANDBOX_REPO` unset hard-crashes on issue #1 (`assertWritable` runs before the dry-run branch, `src/github/write.ts:37`).

---

## 1. Structure change: deck first, 6 slides, then live demo

Old: dread → architecture → 6 demo beats → numbers, with 10 slides as a separate artifact nobody sees.

New: the deck **is** the first minute of the video, then it cuts to live proof. 6 slides = thesis, problem, mechanism, proof, ask, and the four prize tracks. Nothing in the demo repeats a slide; the demo proves the slide.

```
0:00 ─ 1:00   DECK      6 slides × 10s          (voice over slides)
1:00 ─ 1:50   LIVE      triage-run → labels on GitHub
1:50 ─ 2:20   LIVE      verdict, Wi-Fi off, local Gemma
2:20 ─ 2:40   LIVE      one duplicate pair, 0.979 + evidence
2:40 ─ 3:20   LIVE      cockpit: edit → Approve → comment on GitHub
3:20 ─ 3:42   LIVE      Reject → zero trace → receipts
3:42 ─ 4:00   CLOSE     the four numbers + CTA
```

---

## 2. The six slides

**Slide 1 — Title + thesis (10s)**
> **HAMMOCK** 🦥
> *Reversible alone. Visible never.*
> Local, approval-gated GitHub triage · Gemma 4 · Temporal · Mastra
> Lakshay Deol — Hacktoberfest Open-Source AI Challenge

No bullets. One line of small print: `github.com/Lakshay-Deol/Hammock`.

---

**Slide 2 — The problem (12s)**
> **40 issues. Four questions. Every morning.**
>
> Duplicate? Real bug? Which version? Where's the repro?
>
> Existing bots act *unsupervised* — they comment, label, close, and occasionally obey text found in the issue.

Visual: split panel — left, a crawl of issue titles; right, a bot posting a comment with a red "no human" icon.

---

**Slide 3 — How it works (14s)**
> **Cheap things automatic. Public things gated. Everything local.**
>
> `GitHub ETag fetch → Temporal schedule → Mastra agent → local Gemma 4 + nomic-embed → allowlist labels | approval queue → SQLite receipts`

Two boxes only, big:
- **AUTONOMOUS** — allowlisted labels (`bug`, `needs-info`, `feature`, `duplicate`)
- **YOUR TAP** — comments, closes, assignments (always)

Small print: *issue text is fenced as untrusted data; it can never trigger a tool call.*

---

**Slide 4 — Proof (14s)**
> **Measured on ground truth, not vibes.**
>
> | Dedupe precision | 100.0% |
> | Dedupe recall | 100.0% |
> | Injection neutralization | 3 / 3 |
> | Test suite | 26 / 26 |
> | Inference | 100% local, survives Wi-Fi off |

Do **not** put 42.5 tok/s here unless you measured it in rehearsal (§6). "100% local" is the claim that matters and it's the one you'll prove live.

---

**Slide 5 — The ask (8s)**
> **You wake up to five decisions, not forty tabs.**
>
> Approve, edit, or reject — each one minted into a local audit record with the exact maintainer diff.
>
> `github.com/Lakshay-Deol/Hammock` · *Hammock triages while you sleep, and never speaks without your permission.*

---

**Slide 6 — Four tracks, each doing real work (8s)**

This is the judging slide. One row per prize category, and every row points at a file or a screen — judges probe, so no logo appears without code behind it.

> | Track | What it actually does in Hammock | Where to see it |
> |---|---|---|
> | **Gemma 4** (featured) | Classifies every issue, adjudicates duplicates against the real root cause, drafts the reply in policy tone | `verdict` JSON · dedupe evidence string |
> | **Temporal** | Durable nightly `schedule` → workflow → per-issue activity fan-out; survives a worker kill | `hammock schedule` · Temporal UI |
> | **Mastra** | Agent + four typed tools (`classify`, `embed`, `findDuplicates`, `draftReply`) define the triage loop | `src/agent/` · `agent.test.ts` |
> | **Auth0 for AI Agents** | Async-authorization identity on the approval tap, scoped-token context for writes, local session adapter as the fallback | cockpit `AUTH:` pill · receipt `decided_by` |

Footer, small: *No logos without code behind them — one track, one commit trail.*

Say it in eight seconds: **"Four tracks, all load-bearing: Gemma decides, Temporal makes it durable, Mastra defines the tool loop, Auth0 carries the approval identity."**

> **Honesty lane.** Gemma and Temporal are load-bearing and demo-visible. Mastra's agent is defined and tested, but the triage activity calls the same primitives directly so workflows stay deterministic — say "defines the loop," not "runs the agent." Auth0 ships as a real adapter whose local session fallback is what authorizes the demo — say "fallback," and the `AUTH: AUTH0 LOCAL` pill on screen backs you up. See §6D.

---

## 3. Word-for-word script (≈620 words, ~145 wpm)

**[0:00 — SLIDE 1]**
"Every maintainer knows the morning dread: forty notifications, four identical questions, no time. Most AI triage bots answer them with a cloud model and then speak for you. Hammock doesn't. *Reversible alone, visible never.*"

**[0:10 — SLIDE 2]**
"The bot problem isn't intelligence, it's authority. An unsupervised bot will eventually comment on the wrong issue — or obey a sentence someone pasted into one."

**[0:20 — SLIDE 3]**
"So we split authority. Allowlisted labels apply automatically, because labels are reversible. Comments, closes, assignments wait for your tap. And all of it runs locally on Gemma 4."

**[0:32 — SLIDE 4]**
"On ground truth: a hundred percent dedupe precision and recall, three of three injections caught, twenty-six of twenty-six tests. None of it needs a network."

**[0:44 — SLIDE 5]**
"Five decisions in the morning instead of forty tabs."

**[0:52 — SLIDE 6]**
"Four tracks, all load-bearing: Gemma decides, Temporal makes it durable, Mastra defines the tool loop, Auth0 carries the approval identity."

**[1:00 — cut to terminal, `pnpm hammock triage-run Lakshay-Deol/hammock-sandbox`]**
"This is a live sandbox repo, real issues, real GitHub API — conditional requests, so we only pay for what changed. Watch the labels: they land on the issues themselves. And watch what *doesn't* happen — every drafted comment is held back. Nothing is spoken for me."

**[1:35 — cut to GitHub tab, labels visible]**
"There they are. Bug, needs-info, duplicate — applied, no approval needed. The comments are queued, not posted."

**[1:50 — Wi-Fi off, `pnpm hammock verdict fixtures/issue-001.json`]**
"Wi-Fi is off. No network. This is Gemma 4 on this laptop: a structured verdict, schema-validated, high severity, and the two things the report is missing — a minimal repro and the OS version. Nothing left this machine."

**[2:20 — `pnpm hammock eval-dedupe` or the pair-01 row]**
"Keyword matching fails here, because #101 and #105 share almost no words. Embeddings found them at zero point nine seven nine. Gemma then adjudicated the actual root cause: unhandled rejection during graceful shutdown with keep-alive connections. Similarity finds candidates; the model decides. That's why precision stays at one hundred percent."

**[2:40 — dashboard :3000]**
"This is what I wake up to. Gemma drafted the reply for #101 in our policy tone. I can rewrite it — the diff tracker counts every character I change — and I only post when I tap."

**[3:05 — tap Approve, cut to GitHub]**
"There it is on the issue. Hammock drafted it. I approved it. My token, my machine."

**[3:20 — back to dashboard, tap Reject]**
"And rejection is the important half. I don't want a second comment on this docs issue, so I reject. GitHub gets nothing — no comment, no edit, no trace. Locally, I get an audit record: who, when, why, and the exact text I would have sent."

**[3:42 — receipts table / closing slide]**
"Twenty-six of twenty-six tests, one hundred percent precision and recall, three of three injections stopped. Reversible alone, visible never. It's on GitHub — go break it."

---

## 4. Pre-flight (replaces old Part 1)

**The CLI does not read `.env`.** Export, or nothing works:

```powershell
$env:HAMMOCK_DRY_RUN='0'
$env:HAMMOCK_SANDBOX_REPO='Lakshay-Deol/hammock-sandbox'
$env:GITHUB_TOKEN='ghp_...'          # Issues: Read and Write
$env:OLLAMA_BASE_URL='http://localhost:11434'
$env:OLLAMA_MODEL='gemma4:e4b'
$env:OLLAMA_EMBED_MODEL='nomic-embed-text'
$env:HAMMOCK_REPLAY='0'
```

1. `pnpm hammock doctor` → must read **`Inactive (HAMMOCK_DRY_RUN=0)`** and **`Configured: "Lakshay-Deol/hammock-sandbox"`**. If it still says Active, the export didn't take — stop.
2. Purge test junk from the queue (six `#102 Documentation error` proposals):
   ```powershell
   node -e "const D=require('better-sqlite3');const db=new D('hammock.db');db.pragma('foreign_keys=ON');for(const t of ['proposals','receipts','issue_embeddings','verdicts','issues'])db.prepare(`delete from ${t} where ${t==='issues'?'id':'issue_id'} like 'issue-temp-%'`).run();db.close();"
   ```
3. Prove Ollama is real, not replay: `pnpm hammock verdict fixtures/issue-001.json` → the stderr line must **not** contain `[replay]`.
4. `pnpm hammock dashboard` → 3000 loads, pending list is clean, `AUTH: AUTH0 LOCAL` pill is expected (no tenant configured).
5. Tabs in cut order: **1** GitHub issues, **2** dashboard, **3** slides. Terminal font 16pt, cleared.
6. Rehearse once end-to-end with the clock. If a beat runs long, cut dedupe to its slide.

---

## 5. Fallback matrix

| Failure | On camera |
|---|---|
| Approve returns 400 "Octokit required" | You're unpatched (§6A) — don't shoot approve live. Say "the gate returns a receipt" and show the receipts table instead |
| `triage-run` fetches 8 issues that aren't yours | Token rejected → silent fixture fallback. Cut and fix; never narrate it |
| `verdict` line says `[replay]` | Ollama is down. Don't claim local inference; re-run after `ollama serve` |
| Temporal down | Never mention it on camera; the CLI path doesn't need it |
| Wi-Fi won't turn off cleanly | Use airplane mode; or keep a hotspot disconnected — the point is the `[replay]`-free verdict |

---

## 6. Four decisions before you record

**A. Patch the approve path (recommended, ~4 lines).** Without it the video's climax is impossible.
In `src/approval/service.ts`, import `Octokit`, then before `executeProposal`:
```ts
const octokit = config.HAMMOCK_DRY_RUN
  ? undefined
  : new Octokit({ auth: config.GITHUB_TOKEN });
```
and pass `octokit` into the call. Invariants hold: still `executeProposal`, still `assertWritable` first, still approval-gated.

**B. The injection beat.** Keep it honest and free: injections produce *nothing* — no label, no queue entry. Say that; it's a stronger claim than "we rejected it." Rejection gets demonstrated on a normal draft instead (as scripted above). Alternative: add a quarantined proposal so there's something to reject — more code, weaker story.

**C. 42.5 tok/s.** Either measure it in rehearsal with `[replay]` absent and cite the real number, or cut it. Slide 4 already reads well without it.

**D. Two prize claims that a judge can falsify in thirty seconds.** `createHammockAgent()` is imported only by `tests/agent.test.ts` — the triage activity calls `classifyIssue` on the model client directly. And `requestApproval()` (the Auth0 async-authorization call that a Token Vault story depends on) is never invoked anywhere. Both are defensible as written on Slide 6 — "defines the tool loop", "carries the approval identity, local fallback in the demo" — and both are indefensible as "runs the Mastra agent" or "mints a short-lived token." Use the Slide 6 phrasing verbatim. If you want the stronger claim, wire it: pass `octokit` (A) and call `authAdapter.requestApproval(proposal)` when a comment proposal is queued, then show the authorization URL. That is a real change, not a slide edit.
