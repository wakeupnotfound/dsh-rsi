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
  <a href="package.json"><img src="https://img.shields.io/badge/DSH_Plugin-v0.1.0-6554c0?style=flat" alt="DSH Plugin v0.1.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js >= 20.0.0"></a>
</p>

---

## Overview

**dsh-rsi** is a **recursive self-improvement (RSI) engine and reference plugin** purpose-built for the **DeepSeek Harness (DSH)** desktop AI-agent environment.

It turns the core ideas of [**RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments**](https://arxiv.org/abs/2609.15364) (Aether AI, UCSD, and UIC, 2026) into production engineering. With model weights completely frozen, it combines an **independent double-blind verifier**, a **causal evolvable memory bank**, and **parallel self-exploration with deliberate practice**. Agents can learn from trial and error across sessions and tasks in new environments, complex software, and large engineering projects.

---

## Pain Points and Core Value

AI coding agents built on large models commonly face three problems in complex engineering work:

1. **False-Done / Semantic Entanglement**
   - *Problem*: An agent writes the code, runs its own checks, and keeps using the same flawed initial assumptions. It reaches a false sense of consistency and declares the task complete.
   - *Solution*: **Independent double-blind verifier.** A fresh, blank-session subagent runs independent physical probes, never reads the actor's chain of thought or scratchpad, and eliminates confirmation bias.

2. **Loss of Grounded Lessons Across Sessions**
   - *Problem*: When the interaction context ends, the hard-won parameters and environment pitfalls disappear. The next similar task repeats the same mistakes.
   - *Solution*: **Evolvable durable memory bank.** Every terminal outcome, pass or fail, triggers causal distillation into a reusable triple: preconditions → proven procedure → failure mechanism.

3. **Unreliable Experience Fixation (Scope Loss and Hallucination)**
   - *Problem*: A model may treat a one-off workaround, such as a flag added to bypass a bug, as a universal truth and pollute later tasks.
   - *Solution*: **Cross-corpus reconciliation.** New rules are compared with history. Direct contradictions, explicit supersedes, and same-title/same-category high-overlap procedure evolutions are marked `SUPERSEDED`. Generic titles, low-overlap entries, and long-title truncation differences are conservatively preserved, keeping the memory bank logically consistent.

---

## Modular Components (DSH Specification)

`dsh-rsi` follows the DSH Bundle and Component specifications and ships as **four independently enableable runtime components**:

```text
dsh-rsi (v0.1.0)
│
├── dsh-rsi-verifier   [Independent Double-Blind Verifier]
│     └── Runs read-only probes against candidate deliverables under the Epistemic doctrine, preventing self-deception and False-Done.
│
├── dsh-rsi-memory     [Evolvable Durable Memory Bank]
│     └── Cross-task memory for causal distillation, precondition capture, and global reconciliation.
│
├── dsh-rsi-epistemic  [Epistemic Truth Channels (E1-E6)]
│     └── Injects E1-E6 into the system prompt: trust real probes, never guess, and treat errors as evidence.
│
└── dsh-rsi-explorer   [Recursive Self-Exploration and Practice Engine]
      └── Uses the DSH workflow engine for parallel-wave repository exploration (Phase 1) and failure-driven practice loops (Phase 2).
```

Each component can be enabled or disabled independently under DSH **Settings → Plugins**, with localized titles, descriptions, and status indicators.

---

## Core Workflow: The Recursive Self-Improvement Loop

The self-improvement lifecycle follows one closed loop:

1. **Task start**: Inject E1-E6, mount the current durable-memory inventory, and let the actor write and execute code using Code-as-Policy.
2. **Double-blind acceptance**: After the work is produced, the verifier starts a zero-history subagent, runs read-only physical probes, and applies a one-vote veto on unresolved doubts.
3. **Causal distillation**: The actor reviews the full trajectory and audit feedback, then extracts the causal mechanism and pitfalls.
4. **Reconciliation**: The reconciler scans the bank and identifies same-topic procedure evolution using four gates: full untruncated title equality, non-generic title, matching category, and Jaccard overlap > 35%. Polarity contradictions or explicit supersedes also mark old rules `SUPERSEDED`; generic titles, low overlap, and long-title truncation differences are preserved.
5. **Phase 1 broad exploration**: For an unfamiliar repository, `rsi_explore` runs parallel probe waves and commits audited lessons in bulk.
6. **Phase 2 failure-driven iteration**: For a difficult task, `rsi_practice` drives the `FAIL ➔ Distill ➔ Practice ➔ Retry` loop, validates the corrective procedure in isolation, and retries with the new knowledge.

### Memory Identity and Conflict Governance (Recent Hardening)

- **Content-addressed IDs**: `lessonToEntry` hashes the full title, category, semantic tags, preconditions, procedure, pitfall, evidence, and verifyCommand into the first 10 hexadecimal characters of SHA-256. `verdict`, `outcome-*`, `rsi-*`, `deprecated`, and `superseded` do not participate in identity, so a failure → success re-audit updates the same entry in place.
- **CJK / punctuation / long titles**: `slugify` and `memoryFileName` preserve Unicode letters and numbers. The hash covers the full title and content fields, so punctuation differences or long titles that differ after character 80 do not overwrite each other.
- **Windows compatibility**: Reserved device names such as `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, and `LPT1-9` are prefixed with an underscore.
- **Four-guard same-topic evolution**: A rule is treated as a procedure evolution only when the full untruncated title matches, the title is non-generic, the category matches, and Jaccard overlap exceeds 35%. Otherwise both rules are kept or recorded as `related_topic`, preventing false supersession of generic titles, low-overlap entries, and truncated long titles.

---

## Deployment Methods

### Option 1: Development Deployment (Recommended, Live Reload)

**Use case**: day-to-day development, debugging, and rapid iteration.

1. **Create a source symlink**:
   ```bash
   ln -s "$PWD" ~/.dsh/profiles/desktop/node_modules/dsh-rsi
   ```
2. **Register the components in the desktop profile**:
   Add the following rows to `~/.dsh/profiles/desktop/cordis.patch.yml`:
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
3. **Restart DeepSeek Harness**: fully quit and reopen the application.
   > **Benefit**: changes under `lib/` load without repackaging; a refresh or restart picks up the latest code.

---

### Option 2: Standard Offline Packaging and Distribution

**Use case**: stable delivery, cross-machine deployment, or archived distribution.

1. **Build the `.tgz` archive** (collect the `package.json` `files` whitelist explicitly; exclude tests, `.git`, `node_modules`, and `.DS_Store`):
   ```bash
   rm -rf /tmp/dsh-rsi-pkg && mkdir -p /tmp/dsh-rsi-pkg/package
   cp -R bin lib locale docs cordis.patch.yml dsh-plugin.json package.json icon.png LICENSE README.md README-EN.md /tmp/dsh-rsi-pkg/package/
   find /tmp/dsh-rsi-pkg -name '.DS_Store' -delete
   tar -czf ~/.dsh/plugin-packages/dsh-rsi-0.1.0.tgz -C /tmp/dsh-rsi-pkg package
   tar -tzf ~/.dsh/plugin-packages/dsh-rsi-0.1.0.tgz | grep -c '.DS_Store'   # expected: 0
   ```
2. **Confirm the archive path**:
   `~/.dsh/plugin-packages/dsh-rsi-0.1.0.tgz`
3. **Associate the archive with the DSH desktop profile.**
4. **Restart DSH.**

---

## 🛠 Six DSH Tools

The plugin registers six high-level tools that satisfy DSH's strict output-schema and lossless-JSON contracts.

### 1. `rsi_verify` (Independent Double-Blind Verification)
- **Purpose**: Run a read-only, independent probe audit against the current task's deliverables.
- **Mechanism**:
  - Applies a heuristic static filter to common destructive commands (e.g. `rm`, `git reset --hard`, `sed -i`, file redirection, code writes, and package changes), complementing the DSH read-only process sandbox with defense in depth.
  - Enforces the **Doubt Invariant**: a missing or blank `DOUBTS` section (E4: silence proves nothing) or any unresolved doubt downgrades even a `PASS` to `FAIL`.

### 2. `rsi_distill_memory` (Causal Experience Distillation)
- **Purpose**: After a task, distill reusable causal rules from the verifier outcome and execution trajectory.
- **Output**: Structured Markdown with YAML frontmatter (id, tags, category, verification marker) and four sections: Preconditions, Recommended Procedure, Failure Mechanism, and Evidence.

### 3. `rsi_reconcile_memory` (Global Memory Alignment)
- **Purpose**: Detect stale rules that conflict with, or have been superseded by, new experience.
- **Mechanism**: Uses the four gates (full untruncated title equality, non-generic title, matching category, Jaccard > 35%) to identify same-topic procedure evolution. High-overlap cross-topic rules are checked for direct polarity contradictions. Matching old rules receive a `> ⚠️ SUPERSEDED / CONFLICT NOTICE` annotation; otherwise both are preserved and linked as `related_topic`. The original storage scope is always retained.

### 4. `rsi_query_memory` (Durable Memory Retrieval)
- **Purpose**: Provide keyword search, tag filtering, and category lookup so an agent can consult verified pitfalls and procedures when a new task starts.

### 5. `rsi_explore` (Phase 1 Parallel-Wave Broad Exploration)
- **Purpose**: For a new repository or environment, resolve the isolated workflow engine through `agentPresets.serviceFor(agent, 'workflowEngine')` and schedule parallel subagents for structured exploration.
- **Mechanism**: Wave 1 surveys multiple facets ➔ Wave 2 deep-probes follow-up questions ➔ an independent verifier performs a double-blind falsification audit ➔ only passing lessons are reconciled into memory.
- *Environment note*: In automatic mode (`mode: 'auto'`), the current DSH preset must enable the workflow engine (for example, the PTC preset). If the preset disables it (for example, the default standard preset), the tool returns a structured workflow-request script and instructions; run it with the workflow tool and submit the returned value through `workflow_result`.

### 6. `rsi_practice` (Phase 2 Failure-Driven Deep Practice)
- **Purpose**: Drive a difficult task through the `FAIL ➔ Distill ➔ Practice ➔ Retry` state machine.
- **Mechanism**: On failure, extract a root-cause rule, validate the corrective procedure with a minimal isolated experiment in a temporary directory, then retry with the refined knowledge.

---

## Quick Start and CLI

In addition to running as a DSH plugin in the background, `dsh-rsi` provides a standalone terminal CLI named `rsi`:

```bash
cd /path/to/dsh-rsi

# 1. Show memory-bank status and the SHA-256 tree hash
node bin/rsi.mjs status

# 2. Inspect the injected epistemic doctrine and memory inventory
node bin/rsi.mjs prompt

# 3. Generate an independent double-blind audit prompt for a task objective
node bin/rsi.mjs verify "Implement an HTTP request helper with timeout and retry"

# 4. Search existing causal rules
node bin/rsi.mjs query "git"

# 5. List all distilled experience files
node bin/rsi.mjs list

# 6. Emit the Phase 1 parallel exploration workflow request
node bin/rsi.mjs explore

# 7. Emit the Phase 2 failure-driven practice workflow request
node bin/rsi.mjs practice "Resolve SQLite write-lock contention under high concurrency"
```

---

## Automated Test Suite

The project uses the native Node.js test runner (`node:test`), with no external test framework and no flaky dependencies:

```bash
cd /path/to/dsh-rsi
npm test
```

**Result (26/26 unit and end-to-end tests passing):**
```text
TAP version 13
ok 1 - MemoryDistiller prompt creation and entry parsing
ok 2 - tests/e2e_simulation.test.mjs
ok 3 - Epistemic Core rules completeness
ok 4 - renderEpistemicSection includes all E1-E6 principles
ok 5 - renderMemoryPreamble formats empty and populated inventory
ok 6 - ExplorationPlanner builds a valid workflow request
ok 7 - exploration script runs waves, audits double-blind, and enforces the doubt invariant
ok 8 - verify=false never yields committable lessons
ok 9 - lessonToEntry produces the four-section memory format
ok 10 - lessonToEntry and MemoryBank preserve distinct CJK titles without collision
ok 11 - MemoryBank CRUD operations and tree hashing
ok 12 - tool definitions declare DSH-compatible output schemas and renderers
ok 13 - DSH plugin lifecycle enforces strict host contracts (output, sync sections, disposers)
ok 14 - rsi_explore and rsi_practice execute via workflowEngine and commit only audited lessons
ok 15 - transition table rejects illegal moves
ok 16 - normalizeVerdict applies the doubt invariant
ok 17 - PracticeLoop: FAIL -> Distill -> Practice -> Retry -> PASS
ok 18 - PracticeLoop: exhausts the attempt budget
ok 19 - practice workflow script follows the same state machine, double-blind
ok 20 - practice workflow script ends EXHAUSTED when every attempt fails
ok 21 - MemoryReconciler contradiction detection and resolution
ok 22 - MemoryReconciler supersedes old entry when same lesson topic procedure evolves
ok 23 - MemoryReconciler avoids false-positive supersession on generic titles, low overlap, or truncated long titles
ok 24 - VerifierRuntime probe safety checks
ok 25 - VerifierRuntime runProbe execution
ok 26 - VerifierRuntime parseReport handling and doubt enforcement
1..26
# tests 26 | pass 26 | fail 0 | duration ~115ms
```

---

## Project Layout

```text
dsh-rsi/
├── bin/
│   └── rsi.mjs                  # CLI entry point
├── lib/
│   ├── index.js                 # DSH / Cordis plugin entry (apply / applyComponent)
│   ├── components/              # Four modular DSH components
│   │   ├── verifier/            # Independent double-blind verifier
│   │   ├── memory/              # Evolvable durable memory bank
│   │   ├── epistemic/           # Epistemic truth channels
│   │   └── explorer/            # Recursive exploration and practice
│   ├── core/                    # Algorithm core
│   │   ├── epistemic.js         # E1-E6 axioms and prompt renderer
│   │   ├── verifier.js          # Double-blind verifier and read-only probe guard
│   │   ├── memory.js            # Memory CRUD, tree hash, dual-scope handling
│   │   ├── distillation.js      # Causal distillation prompt and parser
│   │   ├── reconciliation.js    # Consistency checks and supersession
│   │   ├── exploration.js       # Phase 1 parallel exploration and audit
│   │   └── practice.js          # Phase 2 failure-driven practice state machine
│   └── tools/
│       └── definitions.js       # Six DSH tool contracts and JSON Schemas
├── locale/                      # Bundle locales (zh.json, en.json)
├── tests/                       # Unit and integration tests
│   ├── epistemic.test.mjs
│   ├── memory.test.mjs
│   ├── verifier.test.mjs
│   ├── distillation.test.mjs
│   ├── reconciliation.test.mjs
│   ├── exploration.test.mjs
│   ├── practice.test.mjs
│   ├── plugin.test.mjs
│   └── e2e_simulation.test.mjs
├── docs/
│   └── ARCHITECTURE.md          # Architecture and design rationale
├── cordis.patch.yml             # Cordis component wiring
├── dsh-plugin.json              # DSH manifest (v0.15)
├── package.json                 # Node ESM configuration
├── README.md                    # Chinese README
├── README-EN.md                 # English README
├── icon.png                     # 256x256 plugin icon
└── LICENSE                      # Apache-2.0
```

---

## Roadmap

- [x] **MVP**: E1-E6 Epistemic Core injection, independent double-blind verifier probes, dual-scope memory bank, causal distillation, and cross-corpus reconciliation.
- [x] **DSH component packaging**: four independent component packages, dedicated 256px icons, and localization.
- [x] **Deployment and architecture docs**: development symlink, offline packaging, icon switching, and uninstall guidance.
- [x] **Phase 1 parallel exploration**: broad recursive self-exploration with parallel waves on the DSH `workflow` API.
- [x] **Phase 2 automated iteration**: failure-driven deep recursive self-exploration, running the full `FAIL -> Distill -> Practice -> Retry` state machine.
- [x] **Memory identity and same-topic evolution guards**: content-addressed identity (CJK, long titles, Windows reserved names) and four-guard sameTopic checks, enabling in-place re-audits without false supersession.

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
