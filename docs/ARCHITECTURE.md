# Architecture & Design Rationale

This document details the architectural mapping from the academic **RSIAgent** framework to the industrial **DeepSeek Harness (DSH)** plugin runtime.

---

## 1. The Core Philosophy: Training-Free Self-Improvement

In traditional machine learning, model improvement requires updating neural network parameters $\theta \to \theta'$. In complex digital environments, gradient-based updates suffer from sample inefficiency, distribution shifts, and high compute overhead.

RSIAgent formalizes agent execution as:
$$a_t \sim \pi_\theta(\cdot \mid q, h_t, M)$$

Where:
- $\pi_\theta$: Frozen foundation model parameters.
- $q$: Task objective.
- $h_t$: Ephemeral interaction history (reset between tasks).
- $M$: **Durable evolvable memory** (persisted across tasks).

The goal of `dsh-rsi` is to provide the algorithmic and structural runtime that allows $M$ to safely accumulate, self-verify, and reconcile without human intervention.

---

## 2. Epistemic Independence & Verification

### The "False-Done" Problem
A major finding in agent failure audits is **semantic entanglement**: when an actor evaluates its own work, it inevitably uses the same flawed assumptions that caused the error in the first place.

### The Double-Blind Solution
In `dsh-rsi`, verification strictly adheres to:
1. **Zero-History Context**: The Verifier never receives the Actor's reasoning traces, self-checks, or scratchpad.
2. **Read-Only Discipline**: Probes are verified through `isProbeSafe()` to prevent mutation of candidate outputs.
3. **Doubt Invariant**: `VERDICT: PASS` requires the `doubts` field to be strictly empty. Any unresolved material doubt triggers an automatic downgrade to `FAIL`.

---

## 3. Causal Distillation vs. Mere Logging

A common pitfall of naive memory systems is storing raw logs or trivial summaries. In `dsh-rsi`, distillation requires:
- **Preconditions**: Under what exact operating system, library version, or task type does this apply?
- **Actionable Procedure**: The exact verified syntax, flag, or script pattern.
- **Failure Mechanism**: Why did the intuitive approach fail?
- **Concrete Evidence**: Specific error messages or exit codes.

---

## 4. Cross-Corpus Reconciliation

As memory grows, agents risk preserving contradictory advice (e.g., one rule advocating `--bail`, another warning that `--bail` suppresses vital error streams).

`MemoryReconciler` implements:
- Jaccard token overlap indexing to detect related entries.
- Semantic polarity analysis (affirmative vs. prohibitive phrases).
- Automated deprecation annotations (`SUPERSEDED / CONFLICT NOTICE`) on legacy rules.

---

## 5. DSH / Cordis Lifecycle Integration

```text
[DSH Boot / Profile Load]
          │
          ├──> Mount Prompt Sections:
          │      - epistemic-core (E1-E6 rules)
          │      - memory-inventory (scanned from ~/.dsh/storages/rsi)
          │
          └──> Mount Tool Handlers:
                 - rsi_verify
                 - rsi_distill_memory
                 - rsi_reconcile_memory
                 - rsi_query_memory
```

When a user task begins, the agent is already primed with ground-truth discipline and the current memory inventory. When a task completes, the agent invokes `rsi_verify` and `rsi_distill_memory` to commit the newly learned experience.
