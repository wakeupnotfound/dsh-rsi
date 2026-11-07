# Autonomous Exploration & Deliberate Practice

When an agent enters an unfamiliar repository or encounters a problem that repeatedly resists standard solutions, RSIAgent provides two structured autonomous workflows: **Phase 1 Broad Self-Exploration** and **Phase 2 Deliberate Practice**.

---

## Phase 1: Broad Self-Exploration

**Objective**: Rapidly construct a grounded, verified map of a new repository across 5 core facets without waiting for user commands.

### The 5 Facets:
1. **build-and-run**: How is the software compiled, bundled, and run? What are the entry points?
2. **test-suite**: How is the test suite structured, invoked, and how does it report coverage or failure?
3. **toolchain**: Package managers, linters, compilers, environment variables, lockfiles.
4. **architecture**: Module boundaries, contracts, state stores, communication protocols.
5. **failure-modes**: Known edge cases, sandboxing limits, flaky tests.

### Exploration Workflow (Two Waves):
```
Wave 1 (Survey):
  Spawn 5 parallel subagents (one per facet).
  Each conducts read-only inspection and produces a preliminary report + follow-up questions.
        ↓
Wave 2 (Deep Probes):
  Spawn targeted probe subagents to answer specific follow-up questions via execution.
        ↓
Double-Blind Audit:
  Every candidate lesson is evaluated by an independent verifier.
  Unaudited or doubtful lessons are strictly discarded.
        ↓
Commit:
  Only audited, verified lessons are committed to the memory bank.
```

---

## Phase 2: Deliberate Practice

**Objective**: Overcome a difficult, repeatedly failing task through a closed-loop state machine.

### The State Machine:
```
[START]
   ↓
[ACTOR ATTEMPT] → Submit deliverable + probes
   ↓
[DOUBLE-BLIND AUDIT]
   ├── PASS (with DOUBTS: None) ──→ [DISTILL] ──→ [SUCCESS]
   └── FAIL (or unresolved doubts)
          ↓
       [DISTILL FAILURE LESSON] (Why did this attempt fail?)
          ↓
       [RETRY / PRACTICE] (Adjust hypothesis, apply new constraint)
          ↓
       (Loop until PASS or Attempt Budget exhausted)
```

### Deliberate Practice Principles:
- **Seed from Memory**: Start each retry by explicitly injecting the distilled failure lesson from the previous attempt.
- **Vary Strategy, Not Just Syntax**: If strategy A failed twice, do NOT make minor cosmetic tweaks. Change the underlying approach or tool.
- **Budget Discipline**: Limit attempts to 3–5 cycles to prevent runaway token usage.
