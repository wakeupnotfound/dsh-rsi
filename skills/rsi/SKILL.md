---
name: rsi
description: >
  Recursive Self-Improvement (RSI) workflow for engineering, debugging, and coding tasks, grounded in RSIAgent (arXiv:2609.15364).
  Enforces epistemic grounding (E1-E6), double-blind verification, causal experience distillation, and durable memory evolution.
  Use when:
  (1) Tackling non-trivial engineering tasks, bug investigations, refactoring, or critical deliverables;
  (2) Working in unfamiliar repositories or encountering unexpected build/test/runtime errors;
  (3) Completing a task where false-done (self-deception) must be prevented by an independent zero-history verifier;
  (4) User requests "run RSI", "verify thoroughly", "distill lesson", "explore repo", or "practice this task".
allowed-tools:
  - rsi_query_memory
  - rsi_verify
  - rsi_distill_memory
  - rsi_reconcile_memory
  - rsi_explore
  - rsi_practice
  - subagent
  - bash
  - ops_bash
  - read
  - write
  - edit
metadata:
  framework: RSIAgent
  paper: "arXiv:2609.15364"
  version: "0.2.0"
---

# RSIAgent — Recursive Self-Improvement Skill

A strict cognitive and operational workflow to prevent agent self-deception (**False-Done**), guarantee epistemic rigor, and distill verified empirical lessons into an evolvable cross-session memory bank.

---

## The RSI Pipeline

```
Task Ingestion
      ↓
[Phase 1] Recall Memory (经验召回：查询环境避坑与最佳实践)
      ↓
[Phase 2] Grounded Execution (认识论纪律 E1-E6：事实信道锚定)
      ↓
[Phase 3] Double-Blind Verification (独立双盲验证：零历史子智能体盲审)
      ↓
[Phase 4] Causal Distillation (因果提炼：前置条件 + 成功解法 + 避坑 + 证据)
      ↓
[Phase 5] Reconcile & Persist (调和冲突：更新跨会话记忆库)
```

---

## 4 Hard Gates (Non-Negotiable)

1. **NO SELF-CERTIFICATION**: Never announce "Task completed" based solely on your own reasoning or self-test in the same session context.
2. **ZERO-HISTORY BLIND AUDIT**: The Verifier MUST NOT receive the Actor's scratchpad, reasoning history, or subjective interpretations.
3. **THE DOUBT INVARIANT**: A `PASS` verdict without an explicit attestation of `DOUBTS: None` (or `无`) is automatically downgraded to `FAIL`.
4. **CAUSAL SPECIFICATION**: Memory distillation must produce structured causal rules (Preconditions, Proven Rule, Pitfalls, Evidence), never vague conversational summaries.

---

## Phase 1: Memory Recall (经验召回)

**Trigger:** Starting any non-trivial engineering task or entering an unfamiliar codebase.

1. Extract 2–5 specific keywords from the objective (library names, CLI flags, runtime environment, e.g., `["vite", "esbuild", "timeout"]`).
2. Search durable memory:
   - **Native mode**: Call `rsi_query_memory({ query: "..." })`.
   - **Fallback mode**: Inspect `.rsi/memory/` or search local rule markdown files.
3. Adopt relevant rules: check preconditions and apply past verified procedures to avoid known pitfalls.

---

## Phase 2: Grounded Execution (认识论执行纪律)

**Trigger:** Writing code, executing scripts, debugging, or diagnosing issues.

Follow the **Epistemic Core (E1–E6)** (see [references/epistemic-core.md](references/epistemic-core.md)):
- **E1 (Truth Channels)**: Ground all factual claims in physical files, live process output, or test suites. Do not guess file contents.
- **E2 (Structural vs Rendered)**: Verify exact text, counts, and syntax in source files; verify visual layout via rendered screens.
- **E3 (Errors Are Evidence)**: Never redirect errors to `/dev/null` or silence failing exit codes. Stack traces are primary causal evidence.
- **E4 (Silence Proves Nothing)**: Timeouts, network silent drops, or empty outputs are not proof of absence or success.
- **E5 (Confirmation Requires Independence)**: Self-agreement is not verification.
- **E6 (Evidence Is Data)**: Record actual exit codes, error snippets, and file paths.

---

## Phase 3: Double-Blind Verification (独立双盲验证)

**Trigger:** All code edits and local tests appear complete. You are ready to deliver.

**See:** [references/double-blind-verification.md](references/double-blind-verification.md)

### Protocol:
1. Formulate 1–3 **Safe, Read-Only Probes** (e.g., `npm test`, `node --check <file>`, test curl, or file state inspection).
   - Probes must NOT mutate files, delete data, or install packages.
2. Execute verification:
   - **Native mode**: Call `rsi_verify({ task_objective, deliverables, probes })`. Pass the returned `verifier_system_prompt` to a fresh independent `subagent` that has **zero actor history**.
   - **Fallback mode**: Spawn a fresh subagent with NO conversation history. Provide only:
     - Task Objective
     - Deliverable paths
     - Read-only probe commands
3. Subagent Verifier audits against the deliverable and outputs:
   ```
   FINDINGS: <Concrete evidence observed from probes>
   DOUBTS: None (or explicit unresolved doubts)
   VERDICT: PASS | FAIL
   ```
4. If `VERDICT: FAIL` or `DOUBTS` is not clean: Return to Phase 2, fix the root cause, and re-verify.

---

## Phase 4: Causal Distillation (因果经验提炼)

**Trigger:** Verification passed, OR a hard failure occurred after multiple debugging rounds.

**See:** [references/causal-distillation.md](references/causal-distillation.md)

Distill the experience into a durable rule with the strict 4-section schema:
1. **Preconditions**: Exact OS, Node/Python version, library version, architecture.
2. **Proven Rule**: The exact working command, configuration, or code pattern.
3. **Pitfalls**: Why the intuitive approach failed (counterfactuals).
4. **Evidence**: Exact error messages, stack traces, and exit codes observed.

Execute distillation:
- **Native mode**: Call `rsi_distill_memory({ task_objective, verdict, verifier_report, trajectory_summary, rule_content })`.
- **Fallback mode**: Write the drafted Markdown to `.rsi/memory/<kebab-case-slug>.md`.

---

## Phase 5: Reconcile & Persist (记忆调和与持久化)

**Trigger:** After committing a new rule.

1. Inspect for conflicts: Check if the new rule contradicts an older rule.
2. **Native mode**: Call `rsi_reconcile_memory({ entry_id })`.
3. If an older procedure has been superseded by a better one on the same topic, archive or update the obsolete entry.

---

## Autonomous Modes: Exploration & Practice

When the task is open-ended exploration of an unfamiliar repo or solving an exceptionally difficult challenge:
- **Phase 1 Broad Exploration**: Use [references/exploration-and-practice.md](references/exploration-and-practice.md) to launch multi-wave survey and deep probes.
- **Phase 2 Deliberate Practice**: Execute the state machine:
  $$	ext{FAIL} 	o 	ext{Distill} 	o 	ext{Practice} 	o 	ext{Retry}$$
  until `PASS` or the attempt budget is exhausted.
