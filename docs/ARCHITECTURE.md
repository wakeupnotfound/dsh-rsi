# dsh-rsi Architecture and Verification Report (v0.4.0)

## 1. One-Core Dual-Dispatch Architecture

`dsh-rsi` implements the RSIAgent framework (arXiv:2609.15364) using a zero-external-dependency core (`lib/core/`) that powers two distribution surfaces:

1. **DSH Native Plugin Mode (`lib/index.js`)**:
   - Mounts onto the Cordis IoC runtime (`prompt`, `tool`, `agent`, `workflowEngine`).
   - Registers six native tools (`rsi_query_memory`, `rsi_verify`, `rsi_distill_memory`, `rsi_reconcile_memory`, `rsi_explore`, `rsi_practice`) and four prompt fragments (`epistemic-core`, `rsi-protocol`, `memory-preamble`, `verifier-blind`).
   - Spawns isolated sub-agents (`agent.createSession` with `history: []`) for zero-history double-blind verification.

2. **Standalone Single-Skill Mode (`skills/rsi/`)**:
   - Bundles `bin/rsi.mjs` and `lib/core/*` via `esbuild` into a single zero-dependency executable (`skills/rsi/scripts/rsi-cli.mjs` and `skills/rsi/scripts/rsi-cli.js`, ~120 KB unminified for source auditability, ~28 KB compressed inside `skills/rsi.zip`).
   - Allows any agent environment with `Bash` and `Node.js >= 20` (Claude Code, Cursor, Windsurf, OpenHands, Cline, Roo Code) to execute the full self-evolution closed loop (`context -> verify -> distill -> practice -> regression`) without an MCP server or plugin host.
   - **Workspace-Write Sandbox Resilience**: In restricted agent sandboxes where `~/.dsh/storages/rsi/memory` exists on disk (so `mkdir` succeeds) but creating files inside it returns `EPERM`/`EACCES`, `MemoryBank.withLock(fn, scope)` locks only the active target scope directory (`.rsi/memory` for `workspace` commits), and both `acquireFileLock` and `save` gracefully degrade to workspace-only mode while preserving read access to global memories.

---

## 2. Cordis Session Completion Hook Audit and Dual-End Gatekeeping

### 2.1 Audit Conclusion on Cordis Completion Lifecycle Hooks

During Milestone 3 (v0.4.0), we audited the Cordis lifecycle surface exposed to DSH plugins (`ctx.effect`, `ctx.on`, `ctx.prompt`, `ctx.tool`):

- **Finding**: Cordis provides event dispatch via `ctx.on(eventName, listener)` when the host runtime exposes lifecycle events such as `session:finish`, `agent:before-finish`, or `turn:end`. However, standard DSH presets do not guarantee a synchronous blocking `beforeSessionFinish` hook across all host adapters; in minimal presets (`standard` without full event bus hooks), `ctx.on` may either be absent or non-blocking.
- **Architectural Resolution (Dual-Defense Gatekeeping)**:
  1. **Event Hook Interception (`ctx.on('session:finish', ...)` in `lib/index.js`)**: When the host exposes `ctx.on`, `dsh-rsi` registers a `session:finish` listener backed by `SessionGatekeeper`. If the session has unverified state (`dirty: true` without a `PASS` `verification_receipt`), the listener returns `{ allowed: false, block: true, reason, reminder }` and attaches `event.gatekeeperWarning` to intercept premature completion.
  2. **Prompt-Fragment & Tool Output Fallback (`dsh-rsi:rsi-protocol` & `---RSI-GUIDANCE---`)**: For hosts where `session:finish` is non-blocking or unavailable, `SessionGatekeeper.evaluate()` dynamically injects an explicit `[GATEKEEPER WARNING]` into the `dsh-rsi:rsi-protocol` prompt fragment whenever `gatekeeper.dirty` is active, and CLI subcommands append a deterministic `---RSI-GUIDANCE-BEGIN--- / ---RSI-GUIDANCE-END---` state-machine block at the end of every command output.

### 2.2 Prompt Injection Guard on CLI Guidance Blocks

Because `.rsi/memory/*.md` and `.rsi/probes/*.json` are stored in the workspace and may originate from untrusted repositories (e.g., via `git clone`), rendering dynamic fields inside `---RSI-GUIDANCE-BEGIN---` / `---RSI-GUIDANCE-END---` could enable Indirect Prompt Injection.

`lib/core/verifier.js` enforces two strict invariants:
1. **Marker Stripping (`sanitizeGuidanceMarkers`)**: Any occurrences of `---RSI-GUIDANCE-BEGIN---` or `---RSI-GUIDANCE-END---` inside memory titles, bodies, target strings, or probe outputs are stripped (`---[SANITIZED-RSI-MARKER]---`) before printing to `stdout`.
2. **Zero Dynamic Interpolation (`renderCliGuidance`)**: The guidance block itself contains **only** static template instructions, a regex-sanitized `receiptId` (`[A-Za-z0-9_.-]`), and a strict enum `verdict` (`PASS | FAIL | INCONCLUSIVE`). Dynamic values (`target`, `probe`, `title`, `rule`, `failure`) are never interpolated inside the guidance block.

---

## 3. Regression Probe Synthesis and Replay Security Model

### 3.1 Automatic Probe Synthesis (`.rsi/probes/<memory_id>.json`)

Whenever a `VERIFIED` memory entry carrying a `verifyCommand` (or a `### Re-check Command` section, or a `probe` bound to a consumed `PASS` receipt) is committed to a workspace-backed `MemoryBank` via `MemoryReconciler.reconcileAndCommit`, `synthesizeRegressionProbe` automatically writes `.rsi/probes/<memory_id>.json`:

```json
{
  "memoryId": "always-check-null-input",
  "target": "src/parser.js",
  "probeCommand": "node --test tests/parser.test.mjs",
  "expectedExitCode": 0,
  "createdAt": "2026-11-10T00:00:00.000Z"
}
```

### 3.2 Mandatory Replay Safety Invariants

Executing `rsi regression` (CLI) or `rsi_verify({ run_regression: true })` (DSH Tool) replays all probes in `.rsi/probes/*.json` under `VerifierRuntime.runRegression(workdir, options)`:
- **Secondary Allowlist Enforcement**: Every `.rsi/probes/<id>.json` file is treated as untrusted input on disk. Before execution, `runProbe` re-validates `probeCommand` against `validateProbeCommand` (`probe-policy.js`). Any probe containing disallowed binaries, shell operators (`;`, `&&`, `||`, `|`, `` ` ``, `$()`), or dangerous flags (`node -e`, `git -c`, `python -c`) is rejected (`blocked: true`) and recorded in the regression report without spawning a process.
- **Sequential Execution & Bounded Timeout**: Probes execute sequentially with a default per-probe timeout of `REGRESSION_PROBE_TIMEOUT_MS = 60000` (60 seconds). A timeout or failure in one probe is recorded in `results[]` and does not abort the remaining probes.

---

## 4. Workspace Snapshot Guard and Optional Docker Escape Hatch

### 4.1 Workspace Snapshot Guard (`captureWorkspaceSnapshot` / `compareWorkspaceSnapshots`)

To prevent verification probes from silently mutating the repository (violating E3 read-only verification), `VerifierRuntime.runProbe` captures `git status --porcelain` before and after probe execution:

- **Clean Git Workspace (`workspace_snapshot: 'clean'`, `workspace_polluted: false`)**: The working tree status before and after the probe is identical.
- **Polluted Git Workspace (`workspace_snapshot: 'dirty'`, `workspace_polluted: true`)**: The probe modified tracked files or left untracked files behind. Both the probe result and the cryptographic `verification_receipt` embed `wp: true` and `ws: "dirty"`.
- **Non-Git Directory Fallback (`workspace_snapshot: 'skipped_non_git'`, `workspace_polluted: false`)**: When `workdir` is not inside a Git work tree (or `git` is unavailable), snapshot comparison is skipped and recorded honestly as `'skipped_non_git'` (never falsified as `'clean'`).

### 4.2 Optional Docker Read-Only Container Escape Hatch (`--sandbox=docker`)

For environments requiring OS-level filesystem isolation beyond command allowlisting, `VerifierRuntime` supports `sandbox: 'docker'` (`rsi verify --sandbox=docker` or `rsi regression --sandbox=docker`):
- Mounts the workspace read-only (`--read-only -v <workdir>:/workspace:ro --tmpfs /tmp --workdir /workspace`).
- **Invariant**: Even when `sandbox: 'docker'` is enabled, `validateProbeCommand` allowlist checks are still enforced prior to spawning `docker run`.
