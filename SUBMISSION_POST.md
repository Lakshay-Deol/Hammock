---
title: "Hammock: a sloth that triages my issues overnight, and never speaks without my permission"
published: true
tags: devchallenge, hf26challenge, hacktoberfest, opensource
cover_image: https://raw.githubusercontent.com/Lakshay-Deol/Hammock/main/assets/cover.png
canonical_url: https://github.com/Lakshay-Deol/Hammock
description: "Local, approval-gated GitHub issue triage with Gemma 4, Mastra, Temporal, and Auth0. Reversible alone. Visible never."
---

## What I Built

Every open-source maintainer knows the morning dread. You open your laptop to forty unread GitHub notifications, and before you can write a line of code, you have to answer the same four questions, in the exact same words, in the exact same order: *Is this a duplicate? Is it even a bug? Which Node version are you on? Can you provide a minimal reproduction script?*

**Hammock** does something about it. It’s an overnight triage sloth that runs locally on your machine while you sleep. A durable Temporal workflow fetches new and updated issues idempotently, classifies them using a local Gemma 4 model, recalls similar reports using cosine similarity over embeddings, adjudicates duplicates with technical evidence, drafts missing-info replies, and applies safe allowlisted labels. 

And then it stops. Because of Hammock's single governing thesis:

> **Hammock can propose anything. It can only *do* the reversible things alone.**
>
> Labels on an allowlist: **automatic**.
> Comments, closes, locks, and assignments: **your tap**.

You wake up to eight actionable decisions in a clean approval queue—not forty tabs. You tap "Approve", edit a single word in the draft if you want to, and Hammock executes the comment using short-lived tokens minted through Auth0's Token Vault. Reversible alone. Visible never.

---

## Demo

{% embed https://github.com/Lakshay-Deol/Hammock %}

*(Watch the 4-minute demo walkthrough showing offline inference, duplicate evidence spotting, Wi-Fi kill survival, and one-tap approval with live receipt diffs).*

---

## Code & Prior Art

Repository: [github.com/Lakshay-Deol/Hammock](https://github.com/Lakshay-Deol/Hammock)

### Standing on the Shoulders of Prior Art
Hammock was built from scratch for Week 3 of the Hacktoberfest AI Challenge, but it builds upon great prior art in open-source issue triage:
* **`githubnext/agentics/issue-triage`**: We borrowed their safe posture of allowlisted additive labels and max-label caps.
* **IssueSheriff**: We drew inspiration from their duplicate issue clustering and missing-info questions.
* **`alexyan0431/issue-ai-agent`**: Early proof of LLM issue classification.

**What Hammock adds that didn't exist before:**
Prior triage bots run hosted models on webhooks and post directly to repositories without supervision. Hammock runs **local, overnight, durably via Temporal, refuses to speak in public without you**, and proves it with an **immutable cryptographic receipt log** in SQLite. The novelty is in the trust layer, not just the classifier.

---

## How I Built It

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

### The Tech Stack, Pinned
* **Gemma 4 via Ollama (`gemma4:e4b` / `gemma4:12b`)**: Powers issue classification, duplicate adjudication, and tone-conditioned draft generation. To guarantee fast token generation without rambling, the thinking channel (`<|channel>thought ... <channel|>`) is stripped prior to JSON parsing.
* **Embeddings via `nomic-embed-text`**: Vectors are generated through Ollama’s dedicated `/api/embed` endpoint (never reusing the chat endpoint) and indexed in SQLite.
* **Mastra (`@mastra/core`)**: Encapsulates triage tools (`classifyIssue`, `embedIssue`, `findDuplicates`, `draftReply`) and agent logic.
* **Temporal (`@temporalio/*` & `@mastra/temporal`)**: Orchestrates the nightly schedule. All I/O occurs inside Temporal activities with defined `startToCloseTimeout` and retry policies. Workflows stay strictly deterministic.
* **Auth0 for AI Agents**: Powers the approval gate using **Asynchronous Authorization** and connects to GitHub via **Token Vault** so no long-lived GitHub credentials ever reside in the application.
* **SQLite (`better-sqlite3`)**: Zero-dependency, append-only store in WAL mode for `issues`, `verdicts`, `proposals`, and `receipts`, plus brute-force cosine similarity.
* **Hono**: Powers the dashboard UI with glassmorphic aesthetics and live receipt updates.

---

## Why Does Open Innovation Matter?

1. **Your Issue Text Never Leaves Your Machine**: Private repository bug reports often contain proprietary stack traces, internal IP addresses, database schemas, and customer data. Running Gemma 4 locally via Ollama means zero sensitive text is sent to third-party model providers.
2. **Zero Marginal Cost**: Running overnight triage on 500 issues costs $0.00 in API tokens.
3. **The Honest Tradeoff**: Gemma 4 is remarkably capable at technical root-cause analysis, but like many smaller local models, it can be less confident with nuanced sarcasm, non-English colloquialisms, or ambiguous severity ranking. **Hammock’s approval gate is designed precisely around this reality:** when the model proposes a draft, the maintainer has final authority. If Gemma drafts an imperfect question, the maintainer edits one sentence in the dashboard, approves it, and Hammock records the diff in its receipt log.

---

## My Agent Session

Hammock was engineered pair-programming with Google DeepMind’s **Antigravity (AGY)** agent. Strict safety boundaries were defined in `AGENTS.md` before writing a single line of code:
* Every write had to flow through `executeProposal()`.
* `assertWritable()` threw on any repository except the designated sandbox repo.
* Comments were hard-coded to require human approval.
* Issue text was isolated within `<untrusted_issue_data>` XML fences and treated as data, never instructions.

---

## The Lazy Payoff

We evaluated Hammock against ground-truth harvested duplicate issues and real-world adversarial injection attacks:

| Metric | Target | Measured in Hammock |
| :--- | :--- | :--- |
| **Deduplication Precision** | > 80.0% | **100.0%** |
| **Deduplication Recall** | ~ 50.0% | **100.0%** |
| **Average Duplicate Cosine Sim** | High | **0.971** |
| **Average Non-Duplicate Cosine Sim** | Low | **0.236** |
| **Inference Throughput (`gemma4:e4b`)** | Real hardware | **42.5 tok/s** |
| **Prompt Injection Protection** | 100% | **3/3 Attacks Neutralized** |
| **Test Suite Pass Rate** | 100% | **26 / 26 Vitest Tests Passing** |

---

## Prize Categories

- **Best Use of Gemma** — Gemma 4 (`gemma4:e4b` / `gemma4:12b`) via Ollama does all three model jobs: issue classification, duplicate adjudication with technical evidence, and tone-conditioned reply drafting. Everything runs locally; issue text never leaves the machine.
- **Best Use of Auth0 for AI Agents** — Sign-in plus Asynchronous Authorization gates every public action. Token Vault holds the GitHub connection, so no long-lived credentials live in the app.
- **Best Use of Mastra** — The triage agent and its tools (classify, embed, dedupe, draft) are defined in Mastra (`@mastra/core`).
- **Best Use of Temporal** — The overnight triage pipeline runs on Temporal, ensuring that network hiccups, worker restarts, or laptop sleep resume seamlessly without duplicate labels or actions.
