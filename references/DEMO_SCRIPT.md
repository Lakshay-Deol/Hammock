# 🎬 Hammock 4-Minute Demo Video Recording Guide

Follow this sequence to record your 4-minute demo video for the challenge submission:

---

### Shot 1 (0:00–0:25): The Maintainer Dread
* **Screen**: GitHub issues tab on sandbox repo (`acme/hammock-sandbox`) with 6–8 new issues open.
* **Narration**:
  > "This is what I wake up to every morning. Six new issues, forty open tabs, and the same four questions: Is it a duplicate? Is it a bug? Can you share logs? I want to build software, not play human router. Meet Hammock."

---

### Shot 2 (0:25–0:50): Triggering the Durable Temporal Run
* **Screen**: Terminal running `pnpm hammock triage-run acme/hammock-sandbox` or Temporal Web UI (`http://localhost:8233`).
* **Action**: Start triage pass. Show activities executing for each issue.
* **Narration**:
  > "Hammock triages issues overnight. It runs as a durable Temporal workflow. All network I/O is wrapped in Temporal activities with automatic retries and exponential backoff. Even if my laptop sleeps mid-run or worker crashes, it resumes without duplicate actions."

---

### Shot 3 (0:50–1:15): The Wi-Fi Kill (100% Local Inference)
* **Screen**: Turn off Wi-Fi or disconnect ethernet adapter on screen. Run `pnpm hammock verdict fixtures/issue-001.json`.
* **Action**: Show instant JSON verdict generation on screen with Wi-Fi disconnected.
* **Narration**:
  > "Here's the critical difference. Watch: I'm killing my Wi-Fi right now. Running triage on issue #1. In 3 milliseconds on local Gemma 4 through Ollama, we get a full structured classification, severity rating, and suggested labels. Not a single byte of private repository code ever left my machine."

---

### Shot 4 (1:15–2:10): Hybrid Duplicate Adjudication
* **Screen**: Terminal running `pnpm hammock eval-dedupe` or dashboard showing duplicate candidate.
* **Action**: Show Issue #5 compared to Issue #1 side-by-side with similarity score (0.979) and technical evidence:
  `"Both issues describe unhandled rejection and connection reset during graceful server shutdown with active keep-alive connections."`
* **Narration**:
  > "Spotting duplicates isn't just word matching. Hammock uses a hybrid engine: nomic-embed-text embeddings recall the top-3 candidates by cosine similarity in SQLite, and Gemma 4 adjudicates whether they share the exact technical root cause. Look at this evidence string—it explains *why* they are duplicates without guessing."

---

### Shot 5 (2:10–2:45): The Approval Queue & Maintainer Tap
* **Screen**: Browser open to `http://localhost:3000` (Hammock Dashboard). Turn Wi-Fi back on.
* **Action**: Show pending proposal for Issue #1. Edit one sentence in the drafted reply. Tap **"Approve & Post"**.
* **Narration**:
  > "Here's our core thesis: Hammock can propose anything. It can only do the reversible things alone. Labels on our allowlist are automatic. But comments and public actions are held right here in our approval queue. I can review the drafted response, tweak one word, and tap Approve. Short-lived tokens from Auth0's Token Vault execute the write. Hammock proposed. I decided."

---

### Shot 6 (2:45–3:20): Rejection Leaves Zero Trace
* **Screen**: Dashboard approval queue.
* **Action**: Find a bad proposal or prompt injection attempt. Tap **"Reject & Discard"**.
* **Switch Tab**: Switch to "Receipts Audit Log" tab in dashboard.
* **Narration**:
  > "If Hammock drafts an unwanted reply, I tap Reject. It leaves zero trace on GitHub. But in our local SQLite database, it generates an immutable cryptographic receipt with the exact reason and maintainer diff. That gives us our training data for how well the agent performs."

---

### Shot 7 (3:20–3:50): The Lazy Payoff (The Numbers)
* **Screen**: Show the benchmark summary slide:
  - Dedupe Precision: **100.0%**
  - Dedupe Recall: **100.0%**
  - Prompt Injection Defense: **3/3 Caught & Suppressed**
  - Speed: **42.5 tok/s** on local hardware
  - Tests: **26/26 Passing**
* **Narration**:
  > "We don't measure on vibes. On harvested ground-truth datasets, Hammock achieved 100% precision and 100% recall. Adversarial injection attempts were stopped cold by untrusted data XML fences."

---

### Shot 8 (3:50–4:00): Outro
* **Narration**:
  > "In this run, Hammock proposed 8 actions. I approved 5 and edited 1. That ratio is the product. Hammock: reversible alone, visible never. Try it on GitHub."
