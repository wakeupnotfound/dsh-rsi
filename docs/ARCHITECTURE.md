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
2. **Read-Only Discipline**: Probes are filtered through `isProbeSafe()` as a heuristic defense-in-depth layer against common accidental mutations (deletions, writes, in-place edits, installations), complementing DSH filesystem sandboxing.
3. **Doubt Invariant**: `VERDICT: PASS` requires an explicit, affirmative attestation in `DOUBTS:` (e.g., `None` or `无`). Any unresolved material doubt triggers an automatic downgrade to `FAIL`. Following Epistemic axiom E4 (*Silence proves nothing*), an omitted or blank `DOUBTS:` section is treated as absence of proof and automatically downgraded to `FAIL`.

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
- Jaccard token overlap indexing (supporting both ASCII keywords and CJK bigrams) to detect related entries.
- Semantic polarity analysis (affirmative vs. prohibitive phrases).
- Automated deprecation annotations (`SUPERSEDED / CONFLICT NOTICE`) on legacy rules while preserving their originating storage scope.

---

## 5. DSH / Cordis Lifecycle Integration

```text
[DSH Boot / Profile Load]
          │
          ├──> Mount Prompt Sections:
          │      - epistemic-core (E1-E6 rules, order 3100)
          │      - memory-inventory (scanned from ~/.dsh/storages/rsi and .rsi, order 3110)
          │
          └──> Mount Tool Handlers:
                 - rsi_verify
                 - rsi_distill_memory
                 - rsi_reconcile_memory
                 - rsi_query_memory
                 - rsi_explore  (Phase 1 Broad Exploration)
                 - rsi_practice (Phase 2 Deep Practice State Machine)
```

When a user task begins, the agent is already primed with ground-truth discipline and the current memory inventory. When a task completes, the agent invokes verification and memory tools to commit newly learned experience.

### Cordis Preset Delegation Isolation & Service Resolution
DSH isolates `workflowEngine` inside the Agent preset's `delegation` group (`cordis.yml` with `isolate: { workflowEngine: true }`). Top-level plugin contexts cannot resolve this isolated symbol directly through `ctx.get('workflowEngine')`.
To bridge this boundary, `dsh-rsi` resolves the engine through:
```javascript
const presets = service(agent.ctx, 'agentPresets') ?? service(ctx, 'agentPresets');
const engine = presets?.serviceFor?.(agent, 'workflowEngine')
  ?? service(agent.ctx, 'workflowEngine')
  ?? service(ctx, 'workflowEngine');
```
When running under presets where `workflowEngine` is disabled (such as the default `standard` desktop preset), the tools gracefully fall back to `status: 'workflow_script'` mode with complete runnable scripts.

---

## 6. Phase 1: Parallel-Wave Broad Self-Exploration (`rsi_explore`)

When an agent enters a new codebase or environment, exploring sequentially in a single turn is token-inefficient and prone to early hallucination. `ExplorationPlanner` generates a DSH workflow script that coordinates parallel subagents:

```text
[Wave 1: Parallel Survey by Facet]
  ├── Facet: build-and-run
  ├── Facet: test-suite
  ├── Facet: toolchain & deps
  ├── Facet: architecture & conventions
  └── Facet: failure-modes & pitfalls
          │
          ▼
   (Collect candidate lessons & deduplicate follow-up questions)
          │
          ▼
[Wave 2: Deep Probes on Follow-Ups]
  ├── Probe 1: Edge cases & flag verification
  └── Probe 2: Flaky test root-causes
          │
          ▼
[Double-Blind Audit Pipeline]
  └── Independent Verifier tests each candidate lesson with read-only probes
          │
          ▼ (Only PASS without doubts accepted)
[Memory Reconciliation & Persistence]
```

---

## 7. Phase 2: Failure-Driven Deep Practice (`rsi_practice`)

For challenging tasks where initial attempts fail, RSIAgent applies a closed-loop state machine:

```text
  ATTEMPT
     │
     ▼ (attempted)
  VERIFY ───[pass (clean)]───► DISTILL_SUCCESS ──► DONE
     │
   [fail]
     │
     ▼
  DISTILL_FAILURE ───[budget exhausted]───► EXHAUSTED
     │ (distilled)
     ▼
  PRACTICE (isolated scratch experiment confirming the rule)
     │
     ▼ (practiced)
  RETRY ──(retry)──► ATTEMPT (seeded with refined procedure)
```

Key invariants:
- **Zero-leaking Verifier**: The verifier only receives the task objective and declared deliverable paths.
- **Deliberate Practice**: Before attempting the full task again, the agent conducts an isolated test in a temporary directory to validate the corrective rule.
- **Full Traceability**: All state transitions (`transitions`) are recorded and auditable.
