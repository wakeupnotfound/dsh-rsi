# Double-Blind Verification Protocol

The primary cause of failure in LLM coding agents is **Semantic Entanglement** and **Confirmation Bias** leading to the **False-Done** phenomenon: the agent believes its own solution works because its self-evaluation shares the same flawed assumptions that produced the bug.

---

## The Verifier Isolation Principle

To guarantee objective truth, the Verifier must be:
1. **Context-Free (Zero-History)**: The Verifier starts with a pristine context window. It has NOT seen the Actor's thinking process, discarded attempts, or self-reassurance.
2. **Authority-Grounded**: The Verifier only receives:
   - The original user objective (binding requirements).
   - Deliverable paths (the tangible output to audit).
   - Safe, read-only probes (test scripts, linters, commands).
3. **Double-Blind**: The Verifier doesn't know who wrote the code or what struggles occurred; it only evaluates reality.

---

## Designing Safe Probes

Probes are read-only physical checks executed against the deliverables.

### Allowed Probes:
- Running standard test suites: `npm test`, `pytest`, `cargo test`.
- Syntax and typing checks: `tsc --noEmit`, `node --check <file>`, `flake8`.
- Bounded file reads and greps: reading entry points, checking export structures.
- Health checks: `curl -f http://127.0.0.1:port/health`.

### Prohibited Probes (Destructive):
- File deletions: `rm`, `del`, `unlink`.
- Overwrites / in-place modifications: `sed -i`, `echo "..." > file`.
- State mutation / package modifications: `npm install`, `pip install`, `git checkout`.

---

## The Doubt Invariant

Every Verifier report must conform to this schema:

```
FINDINGS:
- <Physical evidence observed from running probes or inspecting files>

DOUBTS:
- None
(OR: explicitly list any edge cases, missing assertions, unverified configurations, or warnings)

VERDICT:
PASS (or FAIL)
```

### Invariant Rules:
- If `VERDICT` is claimed as `PASS`, the `DOUBTS` line MUST explicitly state `None` (or `无`).
- If `DOUBTS` contains any unresolved concern, or if the `DOUBTS` section is omitted or blank (Axiom E4: Silence proves nothing), the engine/protocol **automatically downgrades the verdict to FAIL**.
- On `FAIL`, execution returns immediately to the Actor to diagnose and fix the identified flaw.
