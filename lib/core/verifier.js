/**
 * Independent Double-Blind Verifier for RSIAgent in DSH.
 * Inspects completed candidate work with zero prior knowledge of Actor's internal thoughts.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { renderEpistemicSection } from './epistemic.js';
import { ProbePolicy, captureWorkspaceSnapshot, compareWorkspaceSnapshots } from './probe-policy.js';
import { loadRegressionProbes } from './distillation.js';

export const VERDICTS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNVERIFIED: 'UNVERIFIED'
});

/** Maximum characters retained per probe stream (keeps tool results bounded). */
export const PROBE_OUTPUT_LIMIT = 20000;

/** Default timeout for each replayed regression probe (60s per M3 specification). */
export const REGRESSION_PROBE_TIMEOUT_MS = 60000;

export const GUIDANCE_BEGIN = '---RSI-GUIDANCE-BEGIN---';
export const GUIDANCE_END = '---RSI-GUIDANCE-END---';

/**
 * Strip or neutralize any spoofed guidance markers inside untrusted data outputs
 * (memory bodies, probe stdout/stderr) so data can never close or forge a guidance block.
 */
export function sanitizeGuidanceMarkers(text) {
  return String(text ?? '')
    .replace(/---RSI-GUIDANCE-BEGIN---/g, '[REDACTED-GUIDANCE-BEGIN]')
    .replace(/---RSI-GUIDANCE-END---/g, '[REDACTED-GUIDANCE-END]');
}

/**
 * Render a fixed static guidance block for CLI outputs (Prompt Injection Guard).
 * Only static template text, sanitized receiptId, and strict enum verdict are permitted inside.
 * Dynamic data (target paths, probe commands, memory titles/bodies) NEVER enters this block.
 */
export function renderCliGuidance({ step = 'verify', receiptId = '', verdict = '' } = {}) {
  const safeId = String(receiptId || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 64);
  const safeVerdict = ['PASS', 'FAIL', 'UNVERIFIED'].includes(verdict) ? verdict : '';
  const lines = [GUIDANCE_BEGIN];
  if (safeId) {
    lines.push(`Receipt: ${safeId}${safeVerdict ? ` (${safeVerdict})` : ''}`);
  }
  switch (step) {
    case 'verify':
      if (safeVerdict === 'PASS') {
        lines.push('Next Action: Execute distill to persist the verified causal lesson into durable memory:');
        lines.push('  rsi distill --target "<same-target>" --title "<title>" --preconditions "<pre>" --rule "<rule>" --evidence "<ev>"');
      } else {
        lines.push('Next Action: Do NOT blindly retry edits. Distill failure mode and execute practice loop:');
        lines.push('  rsi practice --target "<target>" --failure "<failure-summary>" --probe "<probe-cmd>"');
      }
      break;
    case 'distill':
      lines.push('Next Action: Run regression probes to verify historical rules remain intact:');
      lines.push('  rsi regression');
      break;
    case 'regression':
      lines.push('Next Action: If any regression probe failed, inspect the violated rule and run verify/practice.');
      break;
    case 'context':
    case 'query':
      lines.push('Next Action: Apply recalled rules during implementation, then run verify with --memory-ids.');
      break;
    case 'practice':
      lines.push('Next Action: Follow the 4-stage practice state machine and re-verify via rsi verify.');
      break;
    default:
      lines.push('Next Action: Complete verification via rsi verify before claiming task completion.');
      break;
  }
  lines.push(GUIDANCE_END);
  return lines.join('\n');
}

/** Hard cap on bytes buffered per probe stream before the probe is killed. */
const PROBE_BUFFER_LIMIT = 5 * 1024 * 1024;

/** Whether a doubts field is affirmatively attested as empty. Silence or blank is NOT affirmative (E4). */
export function isEmptyDoubts(text) {
  const t = String(text ?? '').trim().replace(/^[-*\s]+/, '').replace(/[.。!！\s]+$/, '');
  if (!t) return false;
  return /^(none|n\/a|na|nil|null|empty|no|no doubts?|nothing|无|没有|暂无|无疑点)$/i.test(t);
}

export class VerifierRuntime {
  /**
   * @param {object} [options]
   * @param {number} [options.timeoutMs=30000]
   * @param {number} [options.maxProbes=10]
   * @param {boolean} [options.allowTestRunners=true] - allow npm test / node --test / pytest / ... probes
   * @param {string[]} [options.extraProbePrograms] - operator-approved extra programs
   * @param {'host'|'docker'} [options.sandbox='host'] - optional docker escape hatch (read-only mount)
   * @param {string} [options.dockerImage='node:20-alpine'] - container image when sandbox='docker'
   */
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 30000;
    this.maxProbes = options.maxProbes || 10;
    this.sandbox = options.sandbox === 'docker' ? 'docker' : 'host';
    this.dockerImage = options.dockerImage || 'node:20-alpine';
    this.policy = new ProbePolicy({
      allowTestRunners: options.allowTestRunners,
      extraPrograms: options.extraProbePrograms
    });
  }

  /** Explain whether a probe is allowed: `{ ok, reason? }`. */
  checkProbe(command) {
    return this.policy.check(command);
  }

  /** Check if a probe command is allowed by the read-only allowlist. */
  isProbeSafe(command) {
    return this.policy.check(command).ok;
  }

  /**
   * Execute a single read-only probe. Probes are spawned directly (no shell),
   * with stdin closed, a timeout, bounded output, and workspace snapshot guard.
   * When `sandbox: 'docker'` is requested, the probe command STILL goes through
   * `this.policy.check(command)` first before mounting the workspace `:ro`.
   * @param {string} command
   * @param {string} [workdir]
   * @param {{signal?: AbortSignal, timeoutMs?: number, sandbox?: 'host'|'docker', dockerImage?: string, skipSnapshot?: boolean}} [options]
   */
  async runProbe(command, workdir = process.cwd(), options = {}) {
    const startTime = Date.now();
    const decision = this.policy.check(command);
    if (!decision.ok) {
      const snap = options.skipSnapshot ? null : await captureWorkspaceSnapshot(workdir);
      const snapState = options.skipSnapshot ? 'clean' : (snap?.isGit ? 'clean' : 'skipped_non_git');
      return {
        command: String(command ?? ''),
        exitCode: 1,
        durationMs: Date.now() - startTime,
        stdout: '',
        stderr: `PROBE_REJECTED: ${decision.reason}. Verifier probes must be read-only commands from the allowlist (no shell operators).`,
        blocked: true,
        timedOut: false,
        workspace_snapshot: snapState,
        workspace_polluted: false
      };
    }

    const beforeSnap = options.skipSnapshot ? null : await captureWorkspaceSnapshot(workdir);
    const effectiveTimeout = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : this.timeoutMs;
    const sandboxMode = (options.sandbox || this.sandbox) === 'docker' ? 'docker' : 'host';
    const dockerImage = options.dockerImage || this.dockerImage || 'node:20-alpine';

    let spawnFile = decision.file;
    let spawnArgs = decision.args;
    let spawnShell = decision.shell;
    if (sandboxMode === 'docker') {
      spawnFile = 'docker';
      spawnArgs = [
        'run',
        '--rm',
        '--read-only',
        '-v',
        `${path.resolve(workdir)}:/workspace:ro`,
        '--tmpfs',
        '/tmp',
        '-w',
        '/workspace',
        dockerImage,
        decision.file,
        ...decision.args
      ];
      spawnShell = false;
    }

    const rawResult = await new Promise(resolve => {
      const clip = s => {
        const text = String(s ?? '').trim();
        return text.length > PROBE_OUTPUT_LIMIT
          ? `${text.slice(0, PROBE_OUTPUT_LIMIT)}\n… [truncated ${text.length - PROBE_OUTPUT_LIMIT} chars]`
          : text;
      };
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let overflow = false;
      let settled = false;

      let child;
      try {
        child = spawn(spawnFile, spawnArgs, {
          cwd: workdir,
          shell: spawnShell,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          ...(options.signal ? { signal: options.signal } : {})
        });
      } catch (err) {
        resolve({ command, exitCode: 1, durationMs: Date.now() - startTime, stdout: '', stderr: clip(err.message), blocked: false, timedOut: false });
        return;
      }

      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, effectiveTimeout);
      const collect = (which) => (chunk) => {
        if (which === 'out') stdout += chunk; else stderr += chunk;
        if (stdout.length + stderr.length > PROBE_BUFFER_LIMIT && !overflow) {
          overflow = true;
          child.kill('SIGKILL');
        }
      };
      child.stdout.setEncoding('utf8').on('data', collect('out'));
      child.stderr.setEncoding('utf8').on('data', collect('err'));

      const finish = (exitCode, signal, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const aborted = Boolean(options.signal?.aborted) || error?.name === 'AbortError';
        const notes = [
          error && !aborted ? error.message : '',
          overflow ? `[output exceeded ${PROBE_BUFFER_LIMIT} bytes; probe killed]` : ''
        ].filter(Boolean).join('\n');
        resolve({
          command,
          exitCode: typeof exitCode === 'number' ? exitCode : (timedOut ? 124 : 1),
          durationMs: Date.now() - startTime,
          stdout: clip(stdout),
          stderr: clip([stderr, notes].filter(Boolean).join('\n')),
          blocked: false,
          timedOut,
          ...(sandboxMode === 'docker' ? { sandbox: 'docker' } : {}),
          ...(aborted ? { aborted: true } : {}),
          ...(signal ? { signal: String(signal) } : {})
        });
      };
      child.on('error', err => finish(null, null, err));
      child.on('close', (code, signal) => finish(code, signal, null));
    });

    if (options.skipSnapshot) {
      return rawResult;
    }

    const afterSnap = await captureWorkspaceSnapshot(workdir);
    const snapDiff = compareWorkspaceSnapshots(beforeSnap, afterSnap);
    return {
      ...rawResult,
      workspace_snapshot: snapDiff.workspace_snapshot,
      workspace_polluted: snapDiff.workspace_polluted,
      ...(snapDiff.polluted_entries ? { polluted_entries: snapDiff.polluted_entries } : {})
    };
  }

  /**
   * Run a probe batch sequentially, honoring maxProbes and cancellation.
   * Probes beyond the cap are reported as skipped, never silently dropped (E4).
   */
  async runProbes(commands = [], workdir = process.cwd(), options = {}) {
    const list = Array.isArray(commands) ? commands : [];
    const results = [];
    for (const [index, command] of list.entries()) {
      if (index >= this.maxProbes) {
        results.push({
          command: String(command ?? ''),
          exitCode: 1,
          stdout: '',
          stderr: `PROBE_SKIPPED: maxProbes (${this.maxProbes}) exceeded.`,
          blocked: true,
          timedOut: false
        });
        continue;
      }
      if (options.signal?.aborted) break;
      results.push(await this.runProbe(command, workdir, options));
    }
    return results;
  }

  /**
   * Replay all synthesized regression probes in `.rsi/probes/*.json` sequentially.
   * Every probe is re-checked against `this.policy` (no allowlist exemption),
   * with a default 60s timeout per probe. Failures, timeouts, or policy rejections
   * are recorded in the report without aborting subsequent probes.
   * @param {string} [workdir]
   * @param {{timeoutMs?: number, sandbox?: 'host'|'docker', signal?: AbortSignal}} [options]
   */
  async runRegression(workdir = process.cwd(), options = {}) {
    const probes = await loadRegressionProbes(workdir);
    const beforeSnap = await captureWorkspaceSnapshot(workdir);
    const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : REGRESSION_PROBE_TIMEOUT_MS;

    const results = [];
    let passed = 0;
    let failed = 0;
    let blocked = 0;
    let timedOut = 0;

    for (const probe of probes) {
      if (options.signal?.aborted) break;
      const execRes = await this.runProbe(probe.probeCommand, workdir, {
        ...options,
        timeoutMs
      });
      const isPass = !execRes.blocked && !execRes.timedOut && execRes.exitCode === probe.expectedExitCode;
      if (isPass) passed++;
      else failed++;
      if (execRes.blocked) blocked++;
      if (execRes.timedOut) timedOut++;

      results.push({
        memoryId: probe.memoryId,
        title: probe.title,
        target: probe.target,
        probeCommand: probe.probeCommand,
        expectedExitCode: probe.expectedExitCode,
        exitCode: execRes.exitCode,
        actualExitCode: execRes.exitCode,
        durationMs: execRes.durationMs ?? 0,
        passed: isPass,
        blocked: execRes.blocked,
        timedOut: execRes.timedOut,
        stdout: execRes.stdout,
        stderr: execRes.stderr,
        workspace_snapshot: execRes.workspace_snapshot,
        workspace_polluted: execRes.workspace_polluted
      });
    }

    const afterSnap = await captureWorkspaceSnapshot(workdir);
    const snapDiff = compareWorkspaceSnapshots(beforeSnap, afterSnap);

    return {
      total: probes.length,
      passed,
      failed,
      blocked,
      timedOut,
      allPassed: failed === 0,
      workspace_snapshot: snapDiff.workspace_snapshot,
      workspace_polluted: snapDiff.workspace_polluted,
      results
    };
  }

  /** Build the double-blind Verifier system prompt. */
  buildVerifierPrompt(taskObjective, candidateContext = {}) {
    const probes = Array.isArray(candidateContext.probes) ? candidateContext.probes : [];
    const probeLines = probes.length === 0 ? [] : [
      '',
      '## PRE-EXECUTED READ-ONLY PROBES (raw evidence, not conclusions)',
      ...probes.map((p, i) => [
        `### Probe ${i + 1}: \`${p.command}\``,
        `exitCode: ${p.exitCode}${p.blocked ? ' (BLOCKED)' : ''}${p.timedOut ? ' (TIMED OUT)' : ''}`,
        p.stdout ? `stdout:\n\`\`\`\n${p.stdout}\n\`\`\`` : 'stdout: (empty)',
        p.stderr ? `stderr:\n\`\`\`\n${p.stderr}\n\`\`\`` : 'stderr: (empty)'
      ].join('\n'))
    ];

    return [
      '# INDEPENDENT VERIFIER AGENT — DOUBLE-BLIND AUDIT',
      'You are an independent inspector examining candidate work completed on this machine.',
      'You have DELIBERATELY not been shown the actor\'s chain of thought, assumptions, or reasoning.',
      'Your sole responsibility is to verify whether the machine\'s current physical state satisfies the task.',
      'Stay read-only: never modify, delete, install, commit, or reset anything while auditing.',
      '',
      renderEpistemicSection(),
      '',
      '## TASK OBJECTIVE (Binding Ground Truth)',
      String(taskObjective ?? '').trim(),
      '',
      '## CANDIDATE STATE & CLAIMED DELIVERABLES',
      candidateContext.deliverables ? JSON.stringify(candidateContext.deliverables, null, 2) : '(Inspect current workspace)',
      ...probeLines,
      '',
      '## VERIFICATION PROCEDURE',
      '1. Derive every material requirement from the Task Objective.',
      '2. Run read-only probes (inspect file contents, run test suites, check exit codes, verify exports).',
      '3. Attempt to FALSIFY the candidate: look for edge cases, missing error handling, or regressions.',
      '4. Output your final audit report with exactly one standalone verdict line:',
      '   VERDICT: PASS   (Only if every material requirement is affirmatively evidenced and doubts is empty)',
      '   VERDICT: FAIL   (If any requirement is violated or refuted with concrete evidence)',
      '   VERDICT: UNVERIFIED (If evidence is incomplete, channels timed out, or state is ambiguous)',
      '',
      'Include a section for `DOUBTS: <any unresolved doubts, or None>`. Note: PASS requires doubts to be strictly empty.'
    ].join('\n');
  }

  /** Parse a verifier report into a structured verdict. */
  parseReport(reportText) {
    if (!reportText || typeof reportText !== 'string') {
      return {
        verdict: VERDICTS.UNVERIFIED,
        report: reportText || '',
        doubts: 'Empty or missing verifier output',
        reasons: ['No output received'],
        isPass: false,
        isFail: false
      };
    }

    const reasons = [];
    // Standalone verdict lines only (ignores echoed instructions mid-sentence).
    const verdicts = [...reportText.matchAll(/^[\s>*_#-]*VERDICT:\s*\**\s*(PASS|FAIL|UNVERIFIED)\b/gim)]
      .map(m => m[1].toUpperCase());
    let rawVerdict;
    if (verdicts.length === 0) {
      rawVerdict = VERDICTS.UNVERIFIED;
      reasons.push('No standalone VERDICT line found');
    } else if (new Set(verdicts).size > 1) {
      rawVerdict = VERDICTS.UNVERIFIED;
      reasons.push(`Conflicting verdict lines: ${verdicts.join(', ')}`);
    } else {
      rawVerdict = verdicts[0];
    }

    const doubtsMatch = reportText.match(/DOUBTS:[ \t]*([\s\S]*?)(?:\n\s*\n|\n[\s>*_#-]*[A-Z][A-Z_ ]*:|$)/i);
    let doubtsText = doubtsMatch ? doubtsMatch[1].trim() : '';

    if (rawVerdict === VERDICTS.PASS) {
      if (!doubtsMatch) {
        // Epistemic principle E4 (Silence proves nothing): auditor did not affirmatively attest to doubts
        rawVerdict = VERDICTS.FAIL;
        doubtsText = '(missing required DOUBTS section)';
        reasons.push('Doubt invariant: PASS without mandatory DOUBTS section downgraded to FAIL (E4: silence proves nothing)');
      } else if (!isEmptyDoubts(doubtsText)) {
        rawVerdict = VERDICTS.FAIL;
        reasons.push('Doubt invariant: PASS without affirmative empty doubts attestation downgraded to FAIL (E4: silence proves nothing)');
      }
    }

    return {
      verdict: rawVerdict,
      report: reportText,
      doubts: doubtsText,
      reasons,
      isPass: rawVerdict === VERDICTS.PASS,
      isFail: rawVerdict === VERDICTS.FAIL
    };
  }
}

export const RECEIPTS_DIR = '.rsi/receipts';
export const CONSUMED_DIR = '.rsi/receipts/.consumed';
export const LAST_RECEIPT_FILE = '.rsi/.last_receipt';

/**
 * Cache a verification receipt to .rsi/receipts/<receipt_id>.json and update .rsi/.last_receipt.
 */
export async function saveCachedReceipt(workdir = process.cwd(), { receipt, target, probe, verdict, report, receiptId, workspaceSnapshot, workspacePolluted }) {
  const receiptsDir = path.join(workdir, RECEIPTS_DIR);
  await fs.mkdir(receiptsDir, { recursive: true });

  let id = receiptId;
  if (!id && receipt && receipt.includes('.')) {
    try {
      const data = JSON.parse(Buffer.from(receipt.split('.')[0], 'base64url').toString('utf8'));
      id = data.id;
    } catch {}
  }
  if (!id) {
    id = `rcpt_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  const receiptPath = path.join(receiptsDir, `${id}.json`);
  const record = {
    receipt_id: id,
    receipt,
    target: target || '',
    probe: probe || '',
    verdict,
    workspace_snapshot: workspaceSnapshot || 'clean',
    workspace_polluted: Boolean(workspacePolluted),
    created_at: Date.now(),
    report: report || ''
  };

  await fs.writeFile(receiptPath, JSON.stringify(record, null, 2), 'utf-8');

  // Update .rsi/.last_receipt pointer
  const lastPath = path.join(workdir, LAST_RECEIPT_FILE);
  await fs.writeFile(lastPath, id, 'utf-8');

  return { receiptId: id, path: receiptPath, record };
}

/**
 * Load receipt data from .rsi/receipts/<receipt_id>.json or via .rsi/.last_receipt.
 */
export async function loadCachedReceipt(workdir = process.cwd(), receiptId) {
  let targetId = receiptId;
  if (!targetId) {
    const lastPath = path.join(workdir, LAST_RECEIPT_FILE);
    try {
      targetId = (await fs.readFile(lastPath, 'utf-8')).trim();
    } catch {
      return null;
    }
  }

  // Check if it exists in .consumed/
  const consumedPath = path.join(workdir, CONSUMED_DIR, `${targetId}.json`);
  try {
    const stat = await fs.stat(consumedPath);
    if (stat.isFile()) {
      return { consumed: true, receiptId: targetId };
    }
  } catch {}

  const activePath = path.join(workdir, RECEIPTS_DIR, `${targetId}.json`);
  try {
    const content = await fs.readFile(activePath, 'utf-8');
    const data = JSON.parse(content);
    return { consumed: false, receiptId: targetId, data, path: activePath };
  } catch {
    return null;
  }
}

/**
 * Archive a consumed receipt into .rsi/receipts/.consumed/<receipt_id>.json.
 */
export async function consumeCachedReceipt(workdir = process.cwd(), receiptId) {
  const activePath = path.join(workdir, RECEIPTS_DIR, `${receiptId}.json`);
  const consumedDir = path.join(workdir, CONSUMED_DIR);
  await fs.mkdir(consumedDir, { recursive: true });
  const consumedPath = path.join(consumedDir, `${receiptId}.json`);

  try {
    await fs.rename(activePath, consumedPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Garbage-collect expired receipts older than maxAgeMs (default: 24h).
 */
export async function gcReceipts(workdir = process.cwd(), maxAgeMs = 24 * 3600 * 1000) {
  const receiptsDir = path.join(workdir, RECEIPTS_DIR);
  let cleaned = 0;
  try {
    const files = await fs.readdir(receiptsDir);
    const now = Date.now();
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const fullPath = path.join(receiptsDir, f);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const data = JSON.parse(content);
        const age = now - (Number(data?.created_at) || 0);
        if (age > maxAgeMs) {
          await fs.unlink(fullPath);
          cleaned++;
        }
      } catch {}
    }
  } catch {}
  return cleaned;
}
