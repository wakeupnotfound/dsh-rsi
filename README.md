# RSIAgent for DeepSeek Harness (dsh-rsi)

A **training-free recursive self-improvement (RSI)** plugin and runtime engine for **DeepSeek Harness (DSH)**.

Adapted from the core principles of the paper [**RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments**](https://arxiv.org/abs/2609.15364) (Aether AI, UCSD, UIC; 2026).

---

## 🎯 Problems Solved

When AI coding agents operate in complex software and desktop environments, they suffer from three fundamental limitations:
1. **False-Done / Self-Delusion**: An agent verifying its own work tends to inherit its own faulty initial assumptions.
2. **Loss of Hard-Won Lessons**: Once a session context resets, all debugging traces, scripts, and learned environment quirks disappear.
3. **Unreliable Memory Consolidation**: Agents often over-generalize single workarounds into universal rules, poisoning future decision-making.

**dsh-rsi** maintains frozen model weights while enabling empirical self-evolution through an **independent double-blind verifier** and an **evolvable, causally distilled memory bank**.

---

## 🧩 Architectural Mapping

| Academic Concept (RSIAgent) | DSH Plugin Implementation (`dsh-rsi`) | Responsibility |
| :--- | :--- | :--- |
| **Epistemic Core (E1-E6)** | `dsh-rsi:epistemic-core` prompt section | Enforces physical truth channels, code-based verification, and strict skepticism. |
| **Double-Blind Verifier** | `rsi_verify` tool & clean subagent session | Zero-history inspection of candidate deliverables using non-destructive probes. |
| **Memory Distillation** | `rsi_distill_memory` tool | Transforms raw execution traces into structured causal rules and pitfall alerts. |
| **Memory Reconciliation** | `rsi_reconcile_memory` tool | Resolves cross-corpus contradictions and marks superseded rules to prevent scope drift. |
| **Durable Memory Bank** | `~/.dsh/storages/rsi/` and `<workspace>/.rsi/` | Dual-scoped persistent storage with deterministic SHA-256 tree hashing. |

---

## 📦 Directory Structure

```text
dsh-rsi/
├── bin/
│   └── rsi.mjs                  # CLI executable (status, list, query, verify, prompt)
├── lib/
│   ├── index.js                 # DSH / Cordis plugin entry point (apply)
│   ├── core/
│   │   ├── epistemic.js         # Epistemic Core axioms (E1-E6) & prompt renderer
│   │   ├── verifier.js          # Double-blind verifier runtime & safety filtering
│   │   ├── memory.js            # Durable memory bank CRUD & tree hashing
│   │   ├── distillation.js      # Causal memory extraction & frontmatter parser
│   │   └── reconciliation.js    # Contradiction detection & conflict mitigation
│   └── tools/
│       └── definitions.js       # DSH tools catalog & JSON Schemas
├── tests/                       # Native Node 20 test suite (node --test)
├── docs/
│   └── ARCHITECTURE.md          # Technical architecture & design rationale
├── package.json
└── dsh-plugin.json              # DSH Plugin Manifest (v0.15)
```

---

## 🚀 Quickstart

### 1. Standalone CLI Usage

```bash
# Check memory bank status and Tree SHA-256
node bin/rsi.mjs status

# Inspect rendered Epistemic Core and memory inventory
node bin/rsi.mjs prompt

# Generate an independent double-blind audit prompt
node bin/rsi.mjs verify "Implement resilient HTTP client with exponential backoff"

# Search memory for proven procedures
node bin/rsi.mjs query "git"
```

### 2. Run Test Suite

Uses Node 20 native test runner:

```bash
npm test
```

Result:
```text
✔ 10 tests passed (66ms)
```

---

## 🔌 DeepSeek Harness Integration

Add the plugin to your DSH desktop profile (`~/.dsh/profiles/desktop/cordis.patch.yml`):

```yaml
- id: dsh-rsi-core
  name: "dsh-rsi"
  config:
    epistemicPromptOrder: 3100
    memoryPromptOrder: 3110
    probeTimeoutMs: 30000
    maxProbes: 10
```

Add local dependency to `package.json`:
```json
{
  "dependencies": {
    "dsh-rsi": "file:/Users/juheng/Documents/AgentProjects/dsh-rsi"
  }
}
```

---

## 🛠 Available Tools in DSH

- **`rsi_verify`**: Audits deliverables with read-only probes, enforces zero-history independence, and flags unresolved doubts.
- **`rsi_distill_memory`**: Extracts causal mechanisms and actionable procedures into markdown frontmatter.
- **`rsi_reconcile_memory`**: Analyzes the whole memory corpus to annotate or deprecate conflicting legacy rules.
- **`rsi_query_memory`**: Provides structured keyword and tag retrieval across active memory scopes.

---

## ⚖️ License

Licensed under the [Apache License 2.0](LICENSE).
