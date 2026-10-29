/**
 * Independent Double-Blind Verifier for RSIAgent in DSH.
 * Inspects completed candidate work with zero prior knowledge of Actor's internal thoughts.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { EPISTEMIC_CORE_RULES, renderEpistemicSection } from './epistemic.js';

const execAsync = promisify(exec);

export const VERDICTS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNVERIFIED: 'UNVERIFIED'
});

/**
 * Commands disallowed during verification to preserve candidate state.
 */
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[rf]+\s+|\s+--recursive)/i,
  /\bgit\s+(reset\s+--hard|clean\s+-f|checkout\s+\.)/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\btruncate\s+/i
];

export class VerifierRuntime {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 30000;
    this.maxProbes = options.maxProbes || 10;
  }

  /**
   * Check if a probe command violates read-only discipline
   */
  isProbeSafe(command) {
    if (!command || typeof command !== 'string') return false;
    for (const pat of DESTRUCTIVE_PATTERNS) {
      if (pat.test(command)) return false;
    }
    return true;
  }

  /**
   * Execute a single read-only probe
   */
  async runProbe(command, workdir = process.cwd()) {
    if (!this.isProbeSafe(command)) {
      return {
        command,
        exitCode: 1,
        stdout: '',
        stderr: 'PROBE_REJECTED: Command matched destructive pattern. Verifier must remain read-only.',
        blocked: true
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workdir,
        timeout: this.timeoutMs,
        maxBuffer: 1024 * 1024 * 5 // 5MB
      });

      return {
        command,
        exitCode: 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        blocked: false
      };
    } catch (err) {
      return {
        command,
        exitCode: err.code ?? 1,
        stdout: (err.stdout || '').trim(),
        stderr: (err.stderr || err.message || '').trim(),
        blocked: false
      };
    }
  }

  /**
   * Build the double-blind Verifier system prompt
   */
  buildVerifierPrompt(taskObjective, candidateContext = {}) {
    return [
      '# INDEPENDENT VERIFIER AGENT — DOUBLE-BLIND AUDIT',
      'You are an independent inspector examining candidate work completed on this machine.',
      'You have DELIBERATELY not been shown the actor\'s chain of thought, assumptions, or reasoning.',
      'Your sole responsibility is to verify whether the machine\'s current physical state satisfies the task.',
      '',
      renderEpistemicSection(),
      '',
      '## TASK OBJECTIVE (Binding Ground Truth)',
      taskObjective.trim(),
      '',
      '## CANDIDATE STATE & CLAIMED DELIVERABLES',
      candidateContext.deliverables ? JSON.stringify(candidateContext.deliverables, null, 2) : '(Inspect current workspace)',
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
      'Include a section for `DOUBTS: <any unresolved doubts>`. Note: PASS requires doubts to be strictly empty.'
    ].join('\n');
  }

  /**
   * Parse a verifier report into structured verdict
   */
  parseReport(reportText) {
    if (!reportText || typeof reportText !== 'string') {
      return {
        verdict: VERDICTS.UNVERIFIED,
        report: reportText || '',
        doubts: 'Empty or missing verifier output',
        reasons: ['No output received']
      };
    }

    const verdictMatch = reportText.match(/\bVERDICT:\s*(PASS|FAIL|UNVERIFIED)\b/i);
    let rawVerdict = verdictMatch ? verdictMatch[1].toUpperCase() : VERDICTS.UNVERIFIED;

    // Check doubts
    const doubtsMatch = reportText.match(/DOUBTS:\s*([\s\S]*?)(?:\n\n|\n[A-Z]+:|$)/i);
    const doubtsText = doubtsMatch ? doubtsMatch[1].trim() : '';

    // If verdict is PASS but has non-empty material doubts, enforce fail-safe downgrade
    if (rawVerdict === VERDICTS.PASS && doubtsText && doubtsText.toLowerCase() !== 'none' && doubtsText.toLowerCase() !== 'empty') {
      rawVerdict = VERDICTS.FAIL;
    }

    return {
      verdict: rawVerdict,
      report: reportText,
      doubts: doubtsText,
      isPass: rawVerdict === VERDICTS.PASS,
      isFail: rawVerdict === VERDICTS.FAIL
    };
  }
}
