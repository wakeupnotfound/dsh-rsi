/**
 * Independent Double-Blind Verifier for RSIAgent in DSH.
 * Inspects completed candidate work with zero prior knowledge of Actor's internal thoughts.
 */

import { spawn } from 'node:child_process';
import { renderEpistemicSection } from './epistemic.js';
import { ProbePolicy } from './probe-policy.js';

export const VERDICTS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNVERIFIED: 'UNVERIFIED'
});

/** Maximum characters retained per probe stream (keeps tool results bounded). */
export const PROBE_OUTPUT_LIMIT = 20000;

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
   */
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 30000;
    this.maxProbes = options.maxProbes || 10;
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
   * with stdin closed, a timeout and bounded output.
   * @param {string} command
   * @param {string} [workdir]
   * @param {{signal?: AbortSignal}} [options]
   */
  async runProbe(command, workdir = process.cwd(), options = {}) {
    const decision = this.policy.check(command);
    if (!decision.ok) {
      return {
        command: String(command ?? ''),
        exitCode: 1,
        stdout: '',
        stderr: `PROBE_REJECTED: ${decision.reason}. Verifier probes must be read-only commands from the allowlist (no shell operators).`,
        blocked: true,
        timedOut: false
      };
    }

    return new Promise(resolve => {
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
        child = spawn(decision.file, decision.args, {
          cwd: workdir,
          shell: decision.shell,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          ...(options.signal ? { signal: options.signal } : {})
        });
      } catch (err) {
        resolve({ command, exitCode: 1, stdout: '', stderr: clip(err.message), blocked: false, timedOut: false });
        return;
      }

      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, this.timeoutMs);
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
          stdout: clip(stdout),
          stderr: clip([stderr, notes].filter(Boolean).join('\n')),
          blocked: false,
          timedOut,
          ...(aborted ? { aborted: true } : {}),
          ...(signal ? { signal: String(signal) } : {})
        });
      };
      child.on('error', err => finish(null, null, err));
      child.on('close', (code, signal) => finish(code, signal, null));
    });
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
