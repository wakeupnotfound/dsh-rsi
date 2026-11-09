<p align="center">
  <img src="icon.png" alt="dsh-rsi icon" width="120" height="120">
</p>

<h1 align="center">RSIAgent for DeepSeek Harness (dsh-rsi)</h1>

<p align="center">
  <strong>A training-free recursive self-improvement (RSI) plugin and runtime engine for DeepSeek Harness</strong>
</p>

<p align="center">
  <a href="README.md">简体中文</a> | <strong>English</strong>
</p>

<p align="center">
  <a href="https://arxiv.org/abs/2609.15364"><img src="https://img.shields.io/badge/Paper-arXiv%3A2609.15364-b31b1b?style=flat" alt="Paper: arXiv"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-blue.svg?style=flat" alt="License: Apache 2.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/DSH_Plugin-v0.3.0-6554c0?style=flat" alt="DSH Plugin v0.3.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js >= 20.0.0"></a>
</p>

---

## Overview

**dsh-rsi** is a **recursive self-improvement (RSI) engine and reference plugin** purpose-built for the **DeepSeek Harness (DSH)** desktop AI-agent environment.

It turns the core ideas of [**RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments**](https://arxiv.org/abs/2609.15364) (Aether AI, UCSD, and UIC, 2026) into production engineering. With model weights completely frozen, it combines an **independent double-blind verifier**, a **causal evolvable memory bank**, and **parallel self-exploration with deliberate practice**. Agents can learn from trial and error across sessions and tasks in new environments, complex software, and large engineering projects.

---

## v0.3.0 Release Notes

v0.3.0 delivers the standalone single-skill closed-loop and BM25F-based retrieval and lifecycle governance:

### 1. Standalone Single-Skill Closed-Loop (M1)
- **Automatic Receipt Caching & Task Binding**: `verify` now caches signed verification receipts into `.rsi/receipts/<receipt_id>.json` and updates `.rsi/.last_receipt`. Receipts cryptographically bind to the target's normalized hash (`target_hash = sha256(normalize(target))`) and creation timestamp.
- **Strict Distillation Attestation**: `distill` automatically reads the latest receipt, verifies the HMAC signature, confirms target binding, and enforces a 24-hour expiration window. Once consumed, the receipt is archived to `.rsi/receipts/.consumed/` to prevent replay attacks; validation failures preserve the receipt for retry.
- **Zero-Dependency Single-File Bundled CLI**: Added `skills/rsi/scripts/rsi-cli.mjs` bundled via esbuild (`npm run build:skill`). Runs on vanilla Node.js >= 20 with zero external dependencies and zero `node_modules` required for distribution.
- **Dual-Mode Dispatch & Skill Specification**: Refactored `skills/rsi/SKILL.md` with Node >= 20 preflight self-checks, `<SKILL_DIR>` auto-detection, and dual-mode routing between native DSH Tools (Mode A) and standalone CLI (Mode B).
- **Full-Lifecycle CLI Subcommands**: Extended `bin/rsi.mjs` with `context`, `distill`, and enhanced `verify`, `practice`, `query`, and `status` (`--gc` for receipt garbage collection, `--migrate` for schema migration).

### 2. BM25F Field-Weighted Retrieval & Lifecycle Quality (M2)
- **Pure JavaScript BM25F Search Engine (lib/core/bm25.js)**: Implemented field-weighted BM25F ranking with length normalization across title (3.0), provenRule (2.5), preconditions (2.0), tags (2.0), failureModes (1.0), and evidence (1.0). Blended with confidence weights W_conf (VERIFIED 1.2, OBSERVED 1.0, INFERRED 0.8, PROBATION 0.4, UNTRUSTED 0.3), logarithmic adoption utility ln(e + 0.2 * hit_count), and 90-day half-life decay.
- **Stats Sidecar Storage (.rsi/stats.json)**: Volatile usage statistics are stored separately from Markdown files via atomic temp-file replacement, preserving clean Git diffs and shared memory integrity. Search and query operations are strictly read-only and never alter file mtimes.
- **Adoption Tracking & Automated PROBATION Downgrade**: Passing `--memory-ids` to `verify` tracks rule adoption. Consecutive verification failures (streak >= 2) automatically downgrade memory status to `PROBATION` (weight 0.4), restored to `ACTIVE` upon any subsequent `PASS`.
- **Dynamic Top-K Context Injection**: DSH prompt assembly dynamically retrieves the Top-5 most relevant `ACTIVE` rules for the user's task, injecting core summaries while keeping prompt sizes bounded to prevent Context Bloat.
- **Legacy Memory Migration**: `rsi status --migrate` upgrades legacy v0.2.0 entries to v0.3.0 schema and re-signs them.

---

## Pain Points and Core Value

AI coding agents built on large models commonly face three problems in complex engineering work:

1. **False-Done / Semantic Entanglement**
   - *Problem*: An agent writes the code, runs its own checks, and keeps using the same flawed initial assumptions. It reaches a false sense of consistency and declares the task complete.
   - *Solution*: **Independent double-blind verifier.** A fresh, blank-session subagent runs independent physical probes, never reads the actor's chain of thought or scratchpad, and eliminates confirmation bias.

2. **Loss of Grounded Lessons Across Sessions**
   - *Problem*: When the interaction context ends, the hard-won parameters and environment pitfalls disappear. The next similar task repeats the same mistakes.
   - *Solution*: **Evolvable durable memory bank.** Every terminal outcome, pass or fail, triggers causal distillation into a reusable triple: preconditions -> proven procedure -> failure mechanism.

3. **Unreliable Experience Fixation (Scope Loss and Hallucination)**
   - *Problem*: A model may treat a one-off workaround, such as a flag added to bypass a bug, as a universal truth and pollute later tasks.
   - *Solution*: **Cross-corpus reconciliation.** New rules are compared with history. Direct contradictions, explicit supersedes, and same-title/same-category high-overlap procedure evolutions are marked `SUPERSEDED`. Generic titles, low-overlap entries, and long-title truncation differences are conservatively preserved, keeping the memory bank logically consistent.

---

## Modular Components (DSH Specification)

`dsh-rsi` follows the DSH Bundle and Component specifications and ships as **four independently enableable runtime components**:

```text
dsh-rsi (v0.3.0)
|
|-- dsh-rsi-verifier   [Independent Double-Blind Verifier]
|     └── Runs read-only probes against candidate deliverables under the Epistemic doctrine, preventing self-deception and False-Done.
|
|-- dsh-rsi-memory     [Evolvable Durable Memory Bank]
|     └── Cross-task memory for BM25F field-weighted retrieval, causal distillation, and global reconciliation.
|
|-- dsh-rsi-epistemic  [Epistemic Truth Channels (E1-E6)]
|     └── Injects E1-E6 into the system prompt and dynamically injects Top-5 active memory summaries.
|
└── dsh-rsi-explorer   [Recursive Self-Exploration and Practice Engine]
      └── Uses the DSH workflow engine for parallel-wave repository exploration (Phase 1) and failure-driven practice loops (Phase 2).
```

Each component can be enabled or disabled independently under DSH **Settings -> Plugins**, with localized titles, descriptions, and status indicators.

---

## Core Workflow: The Recursive Self-Improvement Loop

The self-improvement lifecycle follows one closed loop:

1. **Task start**: Inject E1-E6, dynamically inject Top-5 relevant memory summaries via BM25F, and let the actor write and execute code using Code-as-Policy.
2. **Double-blind acceptance**: After the work is produced, the agent calls `rsi_verify` (or CLI `verify`); runs read-only physical probes, applies a one-vote veto on unresolved doubts, and generates cryptographic receipts.
3. **Causal distillation**: The actor reviews the full trajectory and audit feedback, then extracts causal mechanisms and pitfalls.
4. **Reconciliation**: The reconciler scans the bank and identifies same-topic procedure evolution using four gates: full untruncated title equality, non-generic title, matching category, and Jaccard overlap > 35%. Polarity contradictions or explicit supersedes also mark old rules `SUPERSEDED`; generic titles, low overlap, and long-title truncation differences are preserved.
5. **Phase 1 broad exploration**: For an unfamiliar repository, `rsi_explore` runs parallel probe waves and commits audited lessons in bulk.
6. **Phase 2 failure-driven iteration**: For a difficult task, `rsi_practice` drives the `FAIL -> Distill -> Practice -> Retry` loop, validates the corrective procedure in isolation, and retries with the new knowledge.

### RSI Tool Protocol (Important)

DSH only injects prompt sections and registers tools; **it does not run verification or write memory automatically at task end**. For the engine to take effect, the agent must explicitly call:

1. `rsi_query_memory` before a nontrivial task to recall relevant lessons (or `rsi-cli.mjs context` in standalone mode).
2. `rsi_verify` before claiming the task is done; execute read-only physical probes and acquire an attestation receipt.
3. `rsi_distill_memory` after the verdict with a complete `rule_content` block and target binding; calling it with only the objective/verdict and no `rule_content` writes nothing.
4. `rsi_explore` for an unfamiliar repository, `rsi_practice` for a task that keeps failing, and `rsi_reconcile_memory` when rules conflict.

This protocol is injected as the `dsh-rsi:rsi-protocol` prompt section (order 3120) in every session.

---

## Six DSH Tools

The plugin registers six high-level tools that satisfy DSH's strict output-schema and lossless-JSON contracts:

### 1. `rsi_verify` (Independent Double-Blind Verification)
- **Purpose**: Run a read-only, independent probe audit against the current task's deliverables.
- **Mechanism**:
  - **Shell-free allowlist execution (`ProbePolicy`)**: Probe commands are tokenized into `argv` without a shell (rejecting pipes, redirection, chaining, and command substitution) and checked against an explicit allowlist of read-only inspection tools and test runners before running via `spawn(..., { shell: false })`.
  - **Cryptographic `verification_receipt`**: Parsing an audit report issues an HMAC-signed receipt bound to target hash and timestamp so `rsi_distill_memory` can verify that the verdict came from `rsi_verify` rather than self-reporting.
  - Enforces the **Doubt Invariant**: a missing or blank `DOUBTS` section (E4: silence proves nothing) or any unresolved doubt downgrades even a `PASS` to `FAIL`.

### 2. `rsi_distill_memory` (Causal Experience Distillation)
- **Purpose**: After a task, distill reusable causal rules from the verifier outcome and execution trajectory.
- **Mechanism**: Verifies `verification_receipt`, validates target binding, supports explicit `supersedes` lists, and signs written entries with a per-user HMAC key. Unsigned workspace entries inside cloned repositories are quarantined and never injected into the system prompt (until explicitly approved via `rsi trust <id>`).
- **Output**: Structured Markdown with YAML frontmatter (id, tags, category, verification marker, confidence, status, last_validated_at, signature) and four sections: Preconditions, Recommended Procedure, Failure Mechanism, and Evidence.

### 3. `rsi_reconcile_memory` (Global Memory Alignment)
- **Purpose**: Detect stale rules that conflict with, or have been superseded by, new experience.
- **Mechanism**: Uses the four gates (full untruncated title equality, non-generic title, matching category, Jaccard > 35%) to identify same-topic procedure evolution. High-overlap cross-topic rules are checked for direct polarity contradictions. Matching old rules receive a `[SUPERSEDED / CONFLICT NOTICE]` annotation; otherwise both are preserved and linked as `related_topic`. The original storage scope is always retained.

### 4. `rsi_query_memory` (Durable Memory Retrieval)
- **Purpose**: Provide field-weighted BM25F search, tag filtering, and category lookup so an agent can consult verified pitfalls and procedures when a new task starts.

### 5. `rsi_explore` (Phase 1 Parallel-Wave Broad Exploration)
- **Purpose**: For a new repository or environment, resolve the isolated workflow engine through `agentPresets.serviceFor(agent, 'workflowEngine')` and schedule parallel subagents for structured exploration.
- **Mechanism**: Wave 1 surveys multiple facets -> Wave 2 deep-probes follow-up questions -> an independent verifier performs a double-blind falsification audit -> only passing lessons are reconciled into memory.

### 6. `rsi_practice` (Phase 2 Failure-Driven Deep Practice)
- **Purpose**: Drive a difficult task through the `FAIL -> Distill -> Practice -> Retry` state machine.
- **Mechanism**: On failure, extract a root-cause rule, validate the corrective procedure with a minimal isolated experiment in a temporary directory, then retry with the refined knowledge.

---

## Terminal CLI Guide (bin/rsi.mjs)

`dsh-rsi` provides a full-featured standalone terminal CLI:

```bash
# 1. Show memory bank status, tree hash, and cached receipts
node bin/rsi.mjs status

# 2. Garbage-collect expired receipts older than 24 hours
node bin/rsi.mjs status --gc

# 3. Bulk-migrate legacy v0.2.0 memory files to v0.3.0 schema
node bin/rsi.mjs status --migrate

# 4. Context recall and Top-K relevant memory lookup
node bin/rsi.mjs context --task "Fix SQLite write-lock contention" --top-k 5

# 5. Search memories using BM25F ranking
node bin/rsi.mjs query "sqlite busy timeout" --top-k 5

# 6. Execute read-only probe and issue cached verification receipt
node bin/rsi.mjs verify --target "src/db.js" --probe "npm test" --memory-ids "mem_a1b2c3d4"

# 7. Distill verified lesson (automatically validates cached receipt and target binding)
node bin/rsi.mjs distill \
  --target "src/db.js" \
  --title "SQLite Concurrent Write busy_timeout Standard" \
  --preconditions "SQLite3, WAL mode, multi-process writes" \
  --rule "PRAGMA busy_timeout = 5000; enable WAL mode to avoid database is locked" \
  --evidence "verified under 10 concurrent writers with zero busy lock errors"

# 8. Emit Phase 1 broad exploration workflow request
node bin/rsi.mjs explore --goal "Survey core architecture and dependencies"

# 9. Emit Phase 2 deliberate practice instructions
node bin/rsi.mjs practice --target "src/db.js" --failure "SQLITE_BUSY error" --probe "npm test"

# 10. Re-sign and trust an unsigned workspace entry from a cloned repository
node bin/rsi.mjs trust <entry-id>
```

---

## Standalone RSIAgent Skill (skills/rsi/)

In addition to serving as a native DSH runtime plugin, the self-improvement loop is packaged as a standalone Agent Skill under `skills/rsi/`:

```text
skills/rsi/
|-- SKILL.md                          # Dual-mode adaptive routing instructions & protocol
|-- _meta.json                        # Skill metadata (v0.3.0)
|-- scripts/
|     └── rsi-cli.mjs                 # Zero-dependency single-file CLI (~103KB)
└── references/                       # Lazy-loaded references
      |-- epistemic-core.md           # E1-E6 axioms operational reference
      |-- double-blind-verification.md# Verifier runtime, probe allowlist & doubt invariant
      |-- causal-distillation.md      # Causal rule drafting & receipt binding guide
      └── exploration-and-practice.md # Autonomous exploration & deliberate practice state machine
```

### 1. Host Adaptation Matrix

| Host Environment | Representative Tools | Discovery & Activation | Commitment Level |
| :--- | :--- | :--- | :--- |
| Agent Skills Standard | Claude Code, DSH | Native recognition of `SKILL.md` frontmatter & lazy references | Zero-configuration auto-discovery |
| MCP Hosts | MCP-compatible IDE Agents | Registered via standard MCP server | One-time configuration |
| Rules-Based Hosts | Cursor, Windsurf | Add single-line rule (e.g., `Follow protocol in skills/rsi/SKILL.md`) | Single-line activation |

### 2. Standalone Single-Skill Invocation

Copy `skills/rsi/` into any workspace. Even without DSH or native tools, run the complete loop via Bash:

```bash
# 1. Context and memory recall
node "skills/rsi/scripts/rsi-cli.mjs" context --task "<task description>" --top-k 5

# 2. Repository exploration
node "skills/rsi/scripts/rsi-cli.mjs" explore --goal "<exploration goal>"

# 3. Independent double-blind verification
node "skills/rsi/scripts/rsi-cli.mjs" verify --target "<target file>" --probe "<test command>"

# 4. Causal distillation (automatically consumes cached receipt)
node "skills/rsi/scripts/rsi-cli.mjs" distill \
  --target "<target file>" \
  --title "<rule title>" \
  --preconditions "<preconditions>" \
  --rule "<proven rule>" \
  --evidence "<verification evidence>"

# 5. Deliberate practice
node "skills/rsi/scripts/rsi-cli.mjs" practice --target "<target file>" --failure "<error summary>" --probe "<test command>"
```

### 3. Build Single-File CLI

```bash
npm run build:skill
```

---

## Deployment and Installation Methods

### Option 1: Development Deployment (Symlink, Live Reload)

1. **Create a source symlink**:
   ```bash
   ln -s "$PWD" ~/.dsh/profiles/desktop/node_modules/dsh-rsi
   ```
2. **Register components in the desktop profile**:
   Add to `~/.dsh/profiles/desktop/cordis.patch.yml`:
   ```yaml
   - insert:
       - id: dsh-rsi-verifier
         name: dsh-rsi/verifier
         config:
           probeTimeoutMs: 30000
           maxProbes: 10
       - id: dsh-rsi-memory
         name: dsh-rsi/memory
         config:
           enabled: true
       - id: dsh-rsi-epistemic
         name: dsh-rsi/epistemic
         config:
           epistemicPromptOrder: 3100
           memoryPromptOrder: 3110
       - id: dsh-rsi-explorer
         name: dsh-rsi/explorer
         config: {}
   ```
3. **Restart DeepSeek Harness**.

---

### Option 2: Standard Offline Packaging and Distribution

1. **Build and pack `.tgz` archive**:
   ```bash
   npm run build:skill
   npm pack
   ```
   Generates `dsh-rsi-0.3.0.tgz`.
2. **Copy to plugin packages directory**:
   ```bash
   mkdir -p ~/.dsh/plugin-packages
   cp dsh-rsi-0.3.0.tgz ~/.dsh/plugin-packages/
   ```
3. **Associate archive in DSH desktop profile and restart**.

---

## Automated Test Suite

The project uses Node.js native test runner (`node:test`), with zero external test dependencies:

```bash
npm test
```

`npm test` automatically runs `npm run build:skill` and executes all unit and integration tests.

**Test Results (35/35 tests passing):**
```text
ok 1 - MemoryDistiller prompt creation and entry parsing
ok 2 - Comprehensive test of dsh-rsi components and workflows (E2E)
ok 3 - Epistemic Core rules completeness
ok 4 - renderEpistemicSection includes all E1-E6 principles
ok 5 - renderMemoryPreamble formats empty and populated inventory
ok 6 - ExplorationPlanner builds a valid workflow request
ok 7 - exploration script runs waves, audits double-blind, and enforces the doubt invariant
ok 8 - verify=false never yields committable lessons
ok 9 - lessonToEntry produces the four-section memory format
ok 10 - lessonToEntry and MemoryBank preserve distinct CJK titles without collision
ok 11 - MemoryBank CRUD operations and tree hashing
ok 12 - BM25F field-weighted retrieval benchmark (>= 25 labeled query-expected pairs across Chinese, English, Mixed, Partial)
ok 13 - Query and context operations are strictly read-only (mtimes unmodified)
ok 14 - Stats sidecar utility tracking and PROBATION downgrade on consecutive verify failures
ok 15 - System Prompt Top-K bounded memory inventory
ok 16 - Legacy memory migration to v0.3 schema
ok 17 - tool definitions declare DSH-compatible output schemas and renderers
ok 18 - DSH plugin lifecycle enforces strict host contracts (output, sync sections, disposers)
ok 19 - rsi_explore and rsi_practice execute via workflowEngine and commit only audited lessons
ok 20 - rsi_verify issues cryptographic receipt and rsi_distill_memory enforces receipt attestation
ok 21 - transition table rejects illegal moves
ok 22 - normalizeVerdict applies the doubt invariant
ok 23 - PracticeLoop: FAIL -> Distill -> Practice -> Retry -> PASS
ok 24 - PracticeLoop: exhausts the attempt budget
ok 25 - practice workflow script follows the same state machine, double-blind
ok 26 - practice workflow script ends EXHAUSTED when every attempt fails
ok 27 - MemoryReconciler contradiction detection and resolution
ok 28 - MemoryReconciler supersedes old entry when same lesson topic procedure evolves
ok 29 - MemoryReconciler avoids false-positive supersession on generic titles, low overlap, or truncated long titles
ok 30 - RSI Skill definitions and reference files integrity
ok 31 - Standalone Single-Skill CLI E2E: context -> explore -> verify -> distill -> practice
ok 32 - Security DoD: Stale receipt (target mismatch & expired >24h) and duplicate consumption rejected
ok 33 - VerifierRuntime probe safety checks
ok 34 - VerifierRuntime runProbe execution
ok 35 - VerifierRuntime parseReport handling and doubt enforcement
# tests 35 | pass 35 | fail 0 | duration ~460ms
```

---

## Project Layout

```text
dsh-rsi/
|-- bin/
|     └── rsi.mjs                  # CLI entry point (context/distill/verify/query/status)
|-- lib/
|     |-- index.js                 # DSH plugin entry (dynamic Top-K injection & tool registration)
|     |-- components/              # Four modular DSH components
|     |-- core/                    # Algorithm core
|     |     |-- bm25.js            # [v0.3.0] Field-weighted BM25F retrieval & decay scoring
|     |     |-- epistemic.js       # E1-E6 axioms and system prompt renderer
|     |     |-- probe-policy.js    # Shell-free read-only probe allowlist security policy
|     |     |-- integrity.js       # HMAC keyring, receipt signature & task binding validation
|     |     |-- verifier.js        # Double-blind verifier runtime & receipt caching
|     |     |-- memory.js          # Memory CRUD, BM25F integration, sidecar stats & lifecycle
|     |     |-- distillation.js    # Causal distillation prompt and parser
|     |     |-- reconciliation.js  # Tokenizer and cross-corpus consistency reconciler
|     |     |-- exploration.js     # Phase 1 parallel exploration scheduler
|     |     └── practice.js        # Phase 2 failure-driven deliberate practice state machine
|     └── tools/
|           └── definitions.js     # DSH tool contracts and JSON Schemas
|-- skills/
|     └── rsi/                     # Distributable standalone single skill bundle
|           |-- SKILL.md           # Dual-mode adaptive execution protocol & instructions
|           |-- _meta.json         # Skill metadata
|           |-- scripts/
|           |     └── rsi-cli.mjs  # [v0.3.0] Inlined zero-dependency bundled CLI
|           └── references/        # Lazy-loaded references
|-- locale/                        # Localization dictionaries (zh.json, en.json)
|-- tests/                         # Unit and integration tests (35 test cases)
|-- docs/
|     └── ARCHITECTURE.md          # Architecture and design rationale
|-- cordis.patch.yml               # Cordis component wiring
|-- dsh-plugin.json                # DSH manifest (v0.15)
|-- package.json                   # Project configuration
|-- README.md                      # Chinese README
|-- README-EN.md                   # English README
|-- icon.png                       # 256x256 vector icon
└── LICENSE                        # Apache-2.0
```

---

## Roadmap

- [x] **v0.1.0 MVP**: E1-E6 Epistemic Core injection, independent double-blind verifier probes, dual-scope memory bank, causal distillation, and cross-corpus reconciliation.
- [x] **v0.2.0 Autonomous Exploration & Practice**: Phase 1 parallel-wave exploration and Phase 2 failure-driven deliberate practice workflows.
- [x] **v0.3.0-alpha (M1) Standalone Single-Skill Closed-Loop**: Receipt caching & task binding, full CLI subcommands, zero-dependency bundled CLI, dual-mode adaptive routing.
- [x] **v0.3.0 (M2) BM25F Retrieval & Lifecycle Quality**: Pure JS field-weighted BM25F algorithm, stats sidecar, automated PROBATION downgrade, dynamic Top-K context injection.
- [ ] **v0.4.0 (M3) Regression Probes & Automated Guarding**: Standardized regression probe synthesizer, workspace pollution snapshot guards, task completion guarding hooks.
- [ ] **v0.5.0 ~ v1.0.0 (M4) Team Sharing & MCP Ecosystem**: Ed25519 team public-key attestation, adaptive tech-stack exploration, standard MCP Server distribution.

---

## License

This project is released under the [Apache License 2.0](LICENSE).

For academic citation, please refer to the original paper:
```bibtex
@misc{zhu2026rsiagentautonomousexplorationrecursive,
      title={RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments},
      author={Sibo Zhu and Shicheng Fan and Xinyue Wang and Wenyi Wu and Kun Zhou and Biwei Huang},
      year={2026},
      eprint={2609.15364},
      archivePrefix={arXiv},
      primaryClass={cs.AI},
      url={https://arxiv.org/abs/2609.15364},
}
```
