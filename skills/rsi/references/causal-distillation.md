# Causal Experience Distillation

A common pitfall of naive agent memory systems is saving unstructured conversational text or simple chat summaries. Such memories quickly pollute the prompt with noise, outdated assumptions, and hallucinations.

In RSIAgent, experience is distilled into **Causal Rules** using a strict 4-section format.

---

## The 4-Section Causal Rule Schema

Every durable memory file is stored as a Markdown document with YAML frontmatter:

```markdown
---
id: <kebab-case-slug>
title: <Precise, unambiguous title stating the causal finding>
category: workflow | tool-pitfall | environment | test-suite | architecture
tags:
  - <relevant-technology>
  - <error-keyword>
scope: workspace | global
created_at: <ISO-8601 timestamp>
---

## Preconditions
Under what exact operational environment does this rule apply?
- Operating System & Architecture (e.g., macOS Darwin arm64)
- Runtime & Versions (e.g., Node.js >= 20.0.0, Python 3.11)
- Trigger conditions / tool configurations

## Proven Rule
The verified, reproducible, step-by-step procedure or pattern that succeeds.
- Exact CLI flags, environment variables, or config snippets.
- Why this solution works.

## Pitfalls
The intuitive or default approaches that fail, and why they fail.
- Counterfactual reasoning: "One might attempt to do X, but X causes Y because Z."

## Evidence
Concrete physical evidence from verification:
- Exact terminal command executed.
- Exit code (e.g., `exitCode: 1`).
- Excerpt from stderr / stdout showing the error and subsequent fix.
```

---

## Distillation Triggers

1. **Post-Task Verification Success**: When a task that required trial-and-error passes double-blind verification, distill the non-obvious solution.
2. **Terminal Failure / Hard Debugging Lesson**: When an agent spent significant turns resolving a tricky configuration or dependency bug, distill the pitfall even if the overall task is still ongoing.

---

## Quality Checklist for a Good Rule

- [ ] **Specific, not generic**: Avoid "write unit tests carefully". Prefer "Use `--experimental-vm-modules` when running Jest with ESM in Node 20".
- [ ] **Actionable**: Does an agent reading this immediately know what command to run or flag to pass?
- [ ] **Falsifiable**: Can another agent independently check if the precondition holds?
- [ ] **Evidence-backed**: Does it cite a real command output rather than a theoretical assumption?
