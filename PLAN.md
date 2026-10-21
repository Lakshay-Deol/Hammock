# Hammock — final plan (reference doc)

> **Hammock triages your GitHub issues overnight on a local Gemma 4 model. It labels, spots duplicates and drafts replies — and touches nothing public without your tap.**
> Reversible alone. Visible never.

Submission for **Hacktoberfest Open-Source AI Challenge, Week 3: Slow and Steady**.
Due **Oct 25, 2026, 11:59 PM PDT** = **Oct 26, 12:29 PM IST**. Target internal freeze: **Oct 24, 18:00 IST**.

---

## 1. The idea, refined

**Who:** a solo maintainer or 2–3 person team with a steady trickle of issues.

**The dread:** every issue gets the same four questions, answered in the same words, in the same order. Is this a duplicate? Is it even a bug? Which version are you on? Can you send the logs?

**What Hammock does about it:** a durable nightly run fetches new and updated issues, classifies each with a local Gemma 4 model, finds likely duplicates with evidence, drafts the missing-info reply, applies safe labels, and leaves everything that another human would see in an approval queue. You wake up to about eight decisions, not forty tabs.

**The one design rule — this is the whole thesis, put it in the post twice:**

> Hammock can propose anything. It can only *do* the reversible things alone.
> Labels on an allowlist: automatic. Comments, closes, locks, assignments: your tap.

**What makes this different from the four AI triage bots that already exist** (credit all of them, `githubnext/agentics`, IssueSheriff, issue-ai-agent): theirs calls a hosted model on a webhook. Yours runs **local, overnight, durably, and refuses to speak in public without you**, and proves it with a **receipt** per action. Novelty lives in the trust layer, not the classifier.

---

## 2. Scope: what is in, what is out

| In | Out (say so in the post, it reads as discipline) |
|---|---|
| Gemma 4 via Ollama, structured JSON verdicts | Fine-tuning (Tinker) |
| Hybrid dedupe: embedding recall → Gemma adjudication | Auto-closing duplicates |
| Drafted replies with configurable tone | Posting anything without approval |
| Label allowlist + approval queue | Webhooks / public ingress |
| Temporal nightly workflow | Multi-repo org dashboards |
| Auth0 async authorization for approval | ElevenLabs, Sentry, .tech domain |
| Receipt log (JSONL + table) | MongoDB *and* Tiger — pick at most one, or neither |
| Fixture replay mode for the demo | Render-hosted *required* infra (optional only) |

**Categories:** claim exactly four — Gemma, Auth0 for AI Agents, Mastra, Temporal. Full rationale, prize math and the paste-ready post block are in **§13 Targeted sponsors**.
**Do not claim** categories you only touched. One project can enter many, but **you can only win once per challenge** — depth beats breadth here.

---

## 3. Stack, pinned

| Layer | Choice | Notes that matter |
|---|---|---|
| Model | `gemma4:e4b` (nightly volume) / `gemma4:12b` (demo quality), via Ollama | **Thinking off**: omit the `<|think|>` token from the system prompt. Strip any `<|channel>thought … <channel|>` block before JSON parsing. Sampling `temp 1.0, top_p 0.95, top_k 64`. |
| Embeddings | `nomic-embed-text` via Ollama `/api/embed` | Do **not** reuse the chat endpoint. |
| Agent | `@mastra/core` **≥ 1.32.0** + `@mastra/temporal` | `createWorkflow()` → Temporal workflow, `createStep()` → activity, via an import swap. Documented path, not custom glue. |
| Durability | Temporal (dev server locally; Temporal Cloud free tier if you deploy) | Activities do all I/O. Workflow stays deterministic. `startToCloseTimeout` per activity. |
| Approval + auth | Auth0 for AI Agents: GitHub connection + Token Vault + **Asynchronous Authorization** | Verify the exact async-auth flow in the docs on day 4 morning. Keep a local-session fallback so the demo never blocks. |
| Storage | SQLite (`better-sqlite3`) + brute-force cosine | Honest at <10k issues. Adapter interface so Mongo Atlas or Tiger can slot in later. |
| Runtime | Node 22, TypeScript, pnpm | |

**Credential-honesty note (do not overclaim):** the long-lived GitHub credential never lives in the app; short-lived, scoped tokens are minted per action. The agent *does* call GitHub with a token. Say it that way.

---

## 4. Architecture

```
GitHub REST API
      │  since + ETag (conditional, idempotent)
      ▼
Temporal schedule "nightly-triage"
      │
      ▼
workflow: fetch → per-issue activity fan-out → digest
      │
      ├─► Mastra agent ──► Ollama gemma4 ──► JSON verdict
      │                         └──► nomic-embed-text ──► vector
      ├─► dedupe: cosine top-3 ──► Gemma adjudicates with evidence
      ├─► draft reply (tone from config)
      └─► proposals ──► SQLite receipts (append-only)
                            │
              ┌─────────────┴──────────────┐
              ▼                            ▼
     auto: allowlisted labels      approval required:
     (additive, reversible)        comment / close / lock / assign
                                        │
                                 Auth0 async authorization
                                        │  you tap
                                        ▼
                                 action executed ──► receipt updated
```

---

## 5. Data model

```sql
issues(id, repo, number, title, body, author, state, labels_json,
       created_at, updated_at, etag, embedded_at)

verdicts(issue_id, model, type, severity, confidence, missing_info_json,
         suggested_labels_json, summary, injection_suspected,
         raw_json, latency_ms, created_at)

proposals(id, issue_id, action, payload_json, risk, status,
          created_at, decided_at, decided_by)

receipts(id, run_id, issue_id, action, payload_json, evidence_json,
         outcome, user_edit_diff, created_at)
```

`user_edit_diff` and `outcome` are the accuracy dataset: every edit or rejection of a draft is a labelled data point. That field is your "Lazy Payoff" section.

---

## 6. Per-repo policy file — `.hammock.yml`

```yaml
tone: warm-professional        # or terse, or friendly
labels:
  auto: [bug, question, feature, needs-info, duplicate]
  never: [security, good-first-issue]
approve:
  - comment
  - close
  - lock
  - assign
limits:
  max_labels_per_issue: 4
  max_comments_per_run: 0      # comments are always approval-gated
```

A machine-readable policy is a better answer to "is this safe?" than a paragraph, and it is ~40 lines of code.

---

## 7. How you will be measured (do this, it is your edge)

1. **Dedupe precision/recall** against ground truth, not vibes: harvest issues that maintainers actually closed as duplicate from 2–3 real public repos, run Hammock on the *pre-close* text, report precision/recall at your threshold. Target: precision > 0.8 at recall ~0.5. Report both; do not report accuracy alone.
2. **Classification agreement** on a 100-issue stratified sample vs. the labels humans applied.
3. **Draft acceptance rate**: approved unedited / approved with edit / rejected, from the receipt log.
4. **Wall-clock and tokens**: minutes per 25 issues on your hardware; `tok/s` for e4b and 12b. Give the number, it makes the "free after setup" claim concrete.

One table in the post, four numbers. Nothing else is persuasive.

---

## 8. Five-day plan, with cut lines

| Day | Build | Done when | If it slips |
|---|---|---|---|
| **1 (Oct 20)** | Repo, SQLite schema, Ollama + Gemma 4, JSON-schema verdicts, prompt, **fixture replay harness**, harvest 3 real repos | `pnpm hammock verdict fixtures/issue-001.json` prints schema-valid JSON in <60s; 8/8 fixtures pass incl. 3 injection ones; tok/s recorded | If JSON validity is flaky, stop everything — use constrained decoding / `format` and retry. Nothing else matters until this is boring. |
| **2 (Oct 21)** | Embeddings, hybrid dedupe, draft replies, Mastra agent + tools | Dedupe precision/recall computed on harvested data; drafts read like a human wrote them | Ship "related issues" instead of "duplicate". Weaker claim, still true. |
| **3 (Oct 22)** | Temporal workflow + schedule, idempotent fetch (`since` + ETag), label allowlist | Killing the worker mid-run and restarting resumes, no duplicate labels | Cron + job table, and *say so*. Never fake durability. |
| **4 (Oct 23)** | Auth0 async auth + approval UI, policy file, receipt log, optional deploy | Approving in the UI posts the comment; rejecting leaves zero trace on the repo | Local signed-session approval, Auth0 in the write-up as partially wired. Do not lie about it. |
| **5 (Oct 24)** | **Code freeze 18:00.** Measure, record demo, write post | Post published, video < 4 min, repo public | Publish the post even if the video is a screen recording with captions. |

Day 5 is the post. The post is weighted heaviest. Do not write it at 11pm on the 25th.

---

## 9. Demo shot list (4 minutes, record in this order)

1. **0:00–0:25** The repo with 6 new issues. "This is what I wake up to."
2. **0:25–0:50** Trigger the run. Show Temporal UI: workflow running, activities retrying. "It survives my laptop sleeping."
3. **0:50–1:15** **Kill Wi-Fi.** `ifconfig`/adapter off, visible in frame. Run classification on one issue: type, severity, missing info. "Local model. Nothing left this machine."
4. **1:15–2:10** Duplicate found: issue #412 vs #389, side-by-side text, the matching evidence, the similarity score.
5. **2:10–2:45** Draft reply appears in the queue. Edit one word. Approve. Wi-Fi back on. Comment appears on GitHub. "Hammock proposed. I decided."
6. **2:45–3:20** Approval queue: reject a bad draft, show the receipt log entry with `outcome: rejected`.
7. **3:20–3:50** Numbers slide: precision/recall, minutes saved per 25 issues, tok/s.
8. **3:50–4:00** "It proposed 31 actions. I approved 9 and edited 4. That ratio is the product."

Never film a live demo without the replay path armed.

---

## 10. Post skeleton (fill, don't compose)

Title: **Hammock: a sloth that triages my issues overnight, and never speaks without my permission**

- **What I Built** — open on the dread, in first person, one short paragraph. Then the morning-after outcome. Name who gets to be lazy.
- **Demo** — video + repo. Embed.
- **Code** — repo. **Credit section**: `githubnext/agentics/issue-triage`, IssueSheriff, issue-ai-agent, and say precisely what you took (the allowlisted-labels idea, the read-only posture) and what you added.
- **How I Built It** — Gemma 4 in Ollama with thinking off; Mastra + `@mastra/temporal` import swap; SQLite + cosine; Auth0 async authorization as the gate. One diagram, the one above.
- **Why Does Open Innovation Matter?** — private-repo issue text never leaves the machine; zero marginal cost per issue; swap or fine-tune the model later. Then the honest tradeoff: **say where Gemma 4 was weaker than a hosted model** (nuanced severity, sarcasm, non-English) and how the approval gate compensates. Name which partners are hosted (Auth0, Render if used).
- **My Agent Session** — DevRelay capture, `agent_session` tag. Cheap, judges like it. Verify the Entire category description before listing Entire.
- **The Lazy Payoff** — the four numbers.
- **Prize Categories** — Gemma, Auth0, Mastra, Temporal. Nothing else.
- Tags: `devchallenge`, `hf26challenge` (plus `hacktoberfest`, `opensource`).

---

## 11. Risk register

| Risk | Mitigation |
|---|---|
| JSON validity from a small model | Constrained decoding / `format`, one retry with the parse error, thinking off |
| CPU inference too slow | e4b for the nightly run, 12b only for the demo; report tok/s honestly |
| Dedupe noise | Hybrid recall + adjudication; show evidence, never auto-close |
| **Prompt injection** in issue text | Issue body fenced and labelled untrusted; output schema-validated; **no tool calls derived from issue text**; label allowlist; `max_comments_per_run: 0`; 3 injection fixtures in CI |
| Demo depends on 6 services | `HAMMOCK_REPLAY=1` walks fixtures end-to-end, no network, no model |
| Auth0 flow eats day 4 | Local fallback; document exactly what worked |
| Scope creep | The "Out" table is binding. Re-read it at the start of each day |
| Rules | New repo built inside Oct 19–25. Sandbox repo only. **Never comment on someone else's project.** |

---

## 12. The one-sentence answer to the skeptical judge

> "It could spam a repo, so I removed its ability to. On a repo I don't own, it can only add labels from a list I wrote, and everything else it does is a proposal waiting for a human. That constraint is the product, not a limitation of it."

---

## 13. Targeted sponsors

The prize pool is $2,850 across 21 winners: **$250** overall (1) + **$200** × 6 featured categories + **$100** × 14 partner categories. Because you can only win once per challenge, you are optimising for **best single fit**, not a portfolio. Every extra integration costs a day and adds roughly zero expected prize.

### Claim these four

| Sponsor | Tier / prize | Why it is legitimate, not sticker-slapping |
|---|---|---|
| **Gemma** | Featured — **$200** | Gemma 4 is the classifier, the dedupe adjudicator *and* the drafter. Nothing works without it. Strongest claim, most contested — every local-model entry will claim it. |
| **Auth0 for AI Agents** | Partner — **$100**, 🆕 new | The approval gate runs on Asynchronous Authorization; Token Vault holds the GitHub connection. The gate *is* the thesis, not a bolt-on. New category = thinnest pool = best actual odds. |
| **Mastra** | Partner — **$100** | Defines the agent and its tools; the nightly run is a Mastra `createWorkflow`/`createStep` chain. Free claim. |
| **Temporal** | Partner — **$100** | Genuinely wraps the run — retries, resume-after-restart. Free claim. |

### One near-free stretch

**Entire — $100**, *if and only if* the category description accepts a DevRelay-captured agent session. This is the cheapest ticket on the board. **Verify manually** — the hub renders the descriptions client-side and this was not readable during planning. If it qualifies, add it and spend 30 minutes on capture.

**Render — featured, $200**, but claim it only if the dashboard is *already* deployed there on day 4. Large pool, and free-tier cold starts are a live-demo hazard. Do not pick up a deploy just for the category.

### Do not claim

ElevenLabs · MongoDB Atlas · Tiger Data · Sentry Agent Tracing · .tech domain · Backboard · Browserbase · SerpApi · Ultramarine · GitHub Copilot.

Each is roughly a day of work for $100, competes for the same single win, and competes with the post — which is weighted heaviest.

### Paste-ready block for the submission

```markdown
## Prize Categories

- **Best Use of Gemma** — Gemma 4 (`gemma4:e4b` / `gemma4:12b`) via Ollama does all
  three model jobs: classification, duplicate adjudication, and reply drafting.
  Everything runs locally; issue text never leaves the machine.
- **Best Use of Auth0 for AI Agents** — sign-in plus Asynchronous Authorization
  gates every public action. Token Vault holds the GitHub connection, so no
  long-lived credential lives in the app.
- **Best Use of Mastra** — the triage agent and its tools (fetch, dedupe, label,
  draft) are defined in Mastra, and the nightly run is a Mastra workflow.
- **Best Use of Temporal** — that workflow runs on Temporal via `@mastra/temporal`,
  so a killed worker or a rate limit resumes instead of losing the run.
```

### Open verification items

- [ ] Read the **Entire** category description on the [HF26 hub](https://dev.to/challenges/hf26) — does a DevRelay agent session count?
- [ ] Confirm the **Auth0 Asynchronous Authorization** flow end-to-end in a browser before day 4. If it is not viable, Auth0 becomes a sign-in only claim and the post must say so.
- [ ] Re-read the contest rules page for eligibility (age, region, team rules) — not verified during planning.
- [ ] Re-confirm the deadline on the day you publish: Oct 25, 11:59 PM PDT = Oct 26, 12:29 PM IST.

---

## 14. Build-from-scratch decision (settled — do not relitigate on day 3)

**Decision: new repo, no base codebase, no fork.**

**Rules.** Each submission must be a new project built inside the Oct 19–25 window; pull requests to existing projects don't count. Forking a triage bot is the one move that could invalidate the entry.

**Architecture.** Existing bots assume webhook in → hosted model → GitHub Actions compute. All four differentiators (local inference, durable workflow, approval gate, receipt log) cut across every layer. There is no file worth keeping; retrofitting costs more than writing it.

**Agent behaviour.** Antigravity is most reliable in a clean tree with a tight brief. A fork with unfamiliar deps and stale versions burns day 1 on code the agent didn't write.

**Allowed:** official SDKs and scaffolding (`octokit`, `@mastra/core` as a library, `@temporalio/*`, Temporal dev server, any `tsconfig`), config shapes copied from docs, and small utilities copied verbatim *with the licence header and a `CREDITS.md` entry*.

**Not allowed:** cloning any prior-art repo into the tree, copying your own pre-Oct-19 code, or presenting borrowed source as new. Read, close the tab, write it yourself.

**Prior art to read and credit:** `githubnext/agentics/workflows/issue-triage.md` (allowlisted labels, `max: 4`, read-only posture), IssueSheriff, `alexyan0431/issue-ai-agent`.

**Exception that is not code:** seed the sandbox repo with 30–40 realistic issues — three duplicate pairs, two adversarial/injection issues. That is data, and it is needed on day 1.

**Bootstrap:**
```bash
mkdir hammock && cd hammock && git init && pnpm init
pnpm add @mastra/core @mastra/temporal @temporalio/client @temporalio/worker \
  @temporalio/envconfig octokit better-sqlite3 zod yaml commander hono
pnpm add -D typescript @types/node vitest tsx
ollama pull gemma4:e4b && ollama pull gemma4:12b && ollama pull nomic-embed-text
```

**Expected size:** ~1,500–1,800 lines of TypeScript across ~12 modules. That is a 5-day build only because the scope table in §2 is binding.
