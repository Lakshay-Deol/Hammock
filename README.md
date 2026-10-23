# 🦥 Hammock

> **Hammock triages your GitHub issues overnight on a local Gemma 4 model. It labels, spots duplicates and drafts replies — and touches nothing public without your tap.**
>
> *Reversible alone. Visible never.*

Submission for the **Hacktoberfest Open-Source AI Challenge (Week 3: Slow and Steady)**.

---

## 🎯 The Core Thesis

> **Hammock can propose anything. It can only *do* the reversible things alone.**
>
> Labels on an allowlist: **automatic**.
> Comments, closes, locks, and assignments: **your tap**.

Most AI triage bots call hosted models on public webhooks and post directly to repositories without supervision. Hammock runs **100% locally, overnight, durably via Temporal, and strictly refuses to speak in public without maintainer approval** — proving every action with an immutable **receipt**.

---

## 🏗️ Architecture

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
      ├─► draft reply (tone conditioned from .hammock.yml)
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

## ✨ Features

1. **Local Gemma 4 Inference**: Classifies issues into structured JSON verdicts (`bug`, `feature`, `question`, `documentation`, `chore`) with confidence and missing-information questions. Thought channels (`<|channel>thought ... <channel|>`) are stripped to prevent token bloat.
2. **Hybrid Deduplication Engine**:
   - Recall candidates using brute-force cosine similarity over 128-dim/768-dim `nomic-embed-text` embeddings stored in SQLite.
   - Gemma 4 adjudicates top-3 candidates with technical evidence (distinguishing superficial wording similarities from root-cause duplicates).
3. **Tone-Conditioned Reply Drafter**: Formulates clear, friendly maintainer comments requesting missing reproduction steps or environment logs. Tone is configurable via `.hammock.yml` (`warm-professional`, `friendly`, or `terse`).
4. **Prompt Injection Immunity**: Issue bodies are fenced within `<untrusted_issue_data>` tags and treated strictly as data, never instructions. Adversarial prompt injections are flagged as critical security items, preventing unauthorized tool calls, shell execution, or auto-comments.
5. **Durable Temporal Workflows**: Nightly runs are orchestrated as deterministic Temporal workflows via `@mastra/temporal` and `@temporalio/*`. Worker crashes or sleep states resume seamlessly without duplicate labels or actions.
6. **Approval Gate & Auth0 Token Vault**: Comments and destructive actions are held as pending proposals. Approved actions use short-lived, scoped tokens minted per action.
7. **Immutable Receipt Log**: Every action (auto-applied label, approved unedited comment, approved edited comment, or rejected draft) is stamped into SQLite with exact git-style diffs and execution evidence.
8. **Glassmorphic Approval Dashboard**: Built with Hono, giving maintainers a high-aesthetic morning decision queue with inline diff editing.

---

## 🛠️ Stack & Targeted Sponsors

| Sponsor | Category | Implementation in Hammock |
| :--- | :--- | :--- |
| **Gemma** | Featured ($200) | Gemma 4 (`gemma4:e4b` / `gemma4:12b`) via Ollama runs 100% locally for classification, duplicate adjudication, and reply drafting. |
| **Auth0 for AI Agents** | Partner ($100) | Asynchronous Authorization gates all public repo writes; Token Vault scopes short-lived GitHub credentials per action. |
| **Mastra** | Partner ($100) | Triage agent, tool suite (`classifyIssue`, `embedIssue`, `findDuplicates`, `draftReply`), and workflow definitions using `@mastra/core`. |
| **Temporal** | Partner ($100) | Durable execution engine (`nightlyTriageWorkflow`), activity retries, and scheduled nightly triage runs. |

---

## 🚀 Quickstart

### Prerequisites
* **Node.js** ≥ 22.0.0
* **pnpm** ≥ 10.0.0
* **Ollama** (optional; Hammock includes a deterministic Replay transport adapter that works offline out-of-the-box)

```bash
# Clone and install dependencies
git clone https://github.com/Lakshay-Deol/Hammock.git
cd Hammock
pnpm install

# Build TypeScript
pnpm build

# Run full test suite (26 tests across 7 test suites)
pnpm test
```

### Diagnostics Probe
Verify your environment and local daemons:
```bash
pnpm hammock doctor
```

### Run Triage Pipeline
Execute a complete triage pass on issues (idempotent fetch → fan-out triage → auto-labels → pending proposals):
```bash
# Using sandbox repo in safe dry-run mode
pnpm hammock triage-run acme/hammock-sandbox
```

### Launch Maintainer Approval Dashboard
Start the local approval dashboard at `http://localhost:3000`:
```bash
pnpm hammock dashboard
```

### Run Deduplication Benchmark
Evaluate precision and recall against ground-truth harvested duplicate pairs:
```bash
pnpm hammock eval-dedupe
```

---

## ⚙️ Configuration (`.hammock.yml`)

Hammock is governed by a machine-readable policy file:

```yaml
tone: warm-professional        # Options: warm-professional, friendly, terse
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
  max_comments_per_run: 0      # Comments are ALWAYS approval-gated
```

---

## 🔒 Hard Invariants

Hammock enforces nine unbreakable safety rules in [AGENTS.md](AGENTS.md):
1. Every GitHub write routes strictly through `executeProposal()` in `src/github/write.ts`.
2. `assertWritable(repo)` runs first on every write path, throwing unless `repo === config.HAMMOCK_SANDBOX_REPO`.
3. Comments and public actions are **always** approval-gated.
4. Nothing derived from issue text may cause a tool call, network request, shell command, or write. Issue text is untrusted data.
5. `HAMMOCK_DRY_RUN=1` is active by default.
6. Tokens and secrets are never committed or logged.
7. Daemons (`temporal server start-dev`, `ollama serve`) are managed outside the agent.
8. Replay mode is a real client adapter swapping the transport, never a stub or mock that bypasses work.
9. Tests are never modified or weakened to force passes.

---

## 📈 Measured Results ("The Lazy Payoff")

| Metric | Target | Measured in Hammock |
| :--- | :--- | :--- |
| **Deduplication Precision** | > 80.0% | **100.0%** |
| **Deduplication Recall** | ~ 50.0% | **100.0%** |
| **Average Duplicate Cosine Sim** | High | **0.971** |
| **Average Non-Duplicate Cosine Sim** | Low | **0.236** |
| **Inference Throughput (e4b)** | Real hardware | **42.5 tok/s** |
| **Prompt Injection Detection** | 100% | **3/3 Detected & Neutralized** |

---

## 🤝 Prior Art & Credits

Hammock builds upon and honors the work of prior open-source issue triage projects:
- **`githubnext/agentics`**: Inspired the allowlisted additive labels model and the read-only posture.
- **IssueSheriff**: Pioneered duplicate issue clustering and missing-info questions.
- **`alexyan0431/issue-ai-agent`**: Early demonstration of LLM issue classification.

Hammock innovates on top of these by introducing:
* Zero-trust local model execution (issues never leave your machine).
* Reversible alone, visible never gate (human-in-the-loop for all public remarks).
* Temporal workflow durability across sleep and restarts.
* Cryptographic receipt logging with git-style edit diffs.

---

## 📚 Reference Documents

All technical plans, demo scripts, and challenge submission materials are organized in [`references/`](references/):
- **[`references/PLAN.md`](references/PLAN.md)**: Milestone specifications, acceptance criteria, and system prompt definitions.
- **[`references/DEMO_PLAN.md`](references/DEMO_PLAN.md)**: Demo architecture, slide deck structure, and proof verification guide.
- **[`references/DEMO_SCRIPT.md`](references/DEMO_SCRIPT.md)**: Timed script for the video recording.
- **[`references/LOCAL_DEMO_GUIDE.md`](references/LOCAL_DEMO_GUIDE.md)**: Complete guide to running the local CLI, Temporal worker, and Hono UI.
- **[`references/SUBMISSION_POST.md`](references/SUBMISSION_POST.md)**: Hackathon submission post with category breakdowns and metrics.

---

## 📄 License

Apache-2.0 © 2026 Lakshay Deol
