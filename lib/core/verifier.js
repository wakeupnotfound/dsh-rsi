/**
 * Independent Double-Blind Verifier for RSIAgent in DSH.
 * Inspects completed candidate work with zero prior knowledge of Actor's internal thoughts.
 */

import { exec } from 'node:child_process';
import { renderEpistemicSection } from './epistemic.js';

export const VERDICTS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNVERIFIED: 'UNVERIFIED'
});

/** Maximum characters retained per probe stream (keeps tool results bounded). */
export const PROBE_OUTPUT_LIMIT = 20000;

/**
 * Heuristic filter for commands disallowed during verification to preserve candidate state.
 * This is a defense-in-depth static guard against common accidental mutations,
 * designed to complement DSH process sandboxing or ephemeral execution environments.
 */
const DESTRUCTIVE_PATTERNS = [
  // File deletion / mutation / archiving (POSIX)
  /(^|[\s;&|(`])(sudo\s+)?(rm|rmdir|unlink|shred|mv|cp|ln|mkdir|touch|chmod|chown|chgrp|truncate|mkfs(\.\w+)?|dd)(\s|$)/i,
  /(^|[\s;&|(`])(sudo\s+)?install\s+/i,
  /\brsync\b/i,
  /\btar\b[^|;&]*(\s-[a-zA-Z]*[xcurA]|--(extract|get|create|update|append))/i,
  /\bunzip\b/i,
  /\bsed\s+(-[a-zA-Z]*i|--in-place)/i,
  /\bperl\s+-[a-zA-Z]*i/i,
  /\bfind\b[^|;&]*\s-(delete|exec(dir)?\s|ok\s)/i,
  /(^|[\s;&|(])tee(\s|$)/i,
  /\bxargs\b[^|;&]*\b(rm|mv|cp|chmod|chown)\b/i,
  // Inline interpreter mutation commands
  /\bnode\s+(-e|--eval)\s+.*(writeFile|appendFile|unlink|rmSync|mkdir|rename)/i,
  /\bpython3?\s+-c\s+.*(open\s*\(.*['"][wxa\+]|os\.(remove|unlink|rmdir|mkdir)|shutil\.)/i,
  // Git state mutation
  /\bgit(\s+-C\s+\S+)?\s+(reset|clean|checkout|restore|stash|commit|push|pull|fetch|merge|rebase|rm|mv|add|apply|am|cherry-pick|revert|tag|switch|init|gc|prune|update-ref|filter-branch|worktree)\b/i,
  /\bgit(\s+-C\s+\S+)?\s+branch\s+-[dDmM]/i,
  // Package / environment mutation
  /\b(npm|pnpm|yarn|bun)\s+(install|i|add|remove|uninstall|rm|update|upgrade|up|publish|link|unlink|ci|prune|dedupe|exec|dlx|x)\b/i,
  /\bnpx\b/i,
  /\bpip3?\s+(install|uninstall)\b/i,
  /\bbrew\s+(install|uninstall|upgrade|reinstall|remove)\b/i,
  // Privilege, process control, remote execution
  /(^|[\s;&|(])(sudo|su|doas)(\s|$)/i,
  /(^|[\s;&|(])(kill|killall|pkill|shutdown|reboot|halt|launchctl|systemctl)(\s|$)/i,
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/i,
  // Windows cmd / PowerShell
  /\b(rd|del|erase|move|copy|xcopy|robocopy|format)\s/i,
  /\b(Remove-Item|Move-Item|Copy-Item|Rename-Item|New-Item|Set-Content|Add-Content|Clear-Content|Out-File|Stop-Process|Set-ItemProperty)\b/i,
  /(^[\s;|])ri\s/i
];

/** Remove harmless redirections/arrows before scanning for file-writing redirects. */
function stripBenignRedirects(command) {
  return command
    .replace(/[=-]>/g, ' ')                       // JS arrows, `->`
    .replace(/\d*>&\d/g, ' ')                     // 2>&1, >&2
    .replace(/&?\d*>{1,2}\s*\/dev\/null/g, ' ')    // >/dev/null, 2>/dev/null, &>/dev/null
    .replace(/\d*>{1,2}\s*\$null/gi, ' ')          // PowerShell > $null
    .replace(/\d*>{1,2}\s*NUL\b/g, ' ');           // cmd > NUL
}

/** Whether a doubts field is affirmatively attested as empty. Silence or blank is NOT affirmative (E4). */
export function isEmptyDoubts(text) {
  const t = String(text ?? '').trim().replace(/^[-*\s]+/, '').replace(/[.。!！\s]+$/, '');
  if (!t) return false;
  return /^(none|n\/a|na|nil|null|empty|no|no doubts?|nothing|无|没有|暂无|无疑点)$/i.test(t);
}

export class VerifierRuntime {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 30000;
    this.maxProbes = options.maxProbes || 10;
  }

  /** Check if a probe command violates read-only discipline. */
  isProbeSafe(command) {
    if (!command || typeof command !== 'string' || !command.trim()) return false;
    for (const pat of DESTRUCTIVE_PATTERNS) {
      if (pat.test(command)) return false;
    }
    // Any remaining output redirection would write a file.
    if (/>/.test(stripBenignRedirects(command))) return false;
    return true;
  }

  /**
   * Execute a single read-only probe.
   * @param {string} command
   * @param {string} [workdir]
   * @param {{signal?: AbortSignal}} [options]
   */
  async runProbe(command, workdir = process.cwd(), options = {}) {
    if (!this.isProbeSafe(command)) {
      return {
        command: String(command ?? ''),
        exitCode: 1,
        stdout: '',
        stderr: 'PROBE_REJECTED: Command matched destructive pattern. Verifier must remain read-only.',
        blocked: true,
        timedOut: false
      };
    }

    return new Promise(resolve => {
      exec(command, {
        cwd: workdir,
        timeout: this.timeoutMs,
        maxBuffer: 1024 * 1024 * 5,
        ...(options.signal ? { signal: options.signal } : {})
      }, (err, stdout, stderr) => {
        const clip = s => {
          const text = String(s ?? '').trim();
          return text.length > PROBE_OUTPUT_LIMIT
            ? `${text.slice(0, PROBE_OUTPUT_LIMIT)}\n… [truncated ${text.length - PROBE_OUTPUT_LIMIT} chars]`
            : text;
        };
        if (!err) {
          resolve({ command, exitCode: 0, stdout: clip(stdout), stderr: clip(stderr), blocked: false, timedOut: false });
          return;
        }
        const timedOut = Boolean(err.killed && !options.signal?.aborted);
        const aborted = err.name === 'AbortError' || Boolean(options.signal?.aborted);
        resolve({
          command,
          exitCode: typeof err.code === 'number' ? err.code : (timedOut ? 124 : 1),
          stdout: clip(stdout),
          stderr: clip(stderr || err.message),
          blocked: false,
          timedOut,
          ...(aborted ? { aborted: true } : {}),
          ...(err.signal ? { signal: String(err.signal) } : {})
        });
      });
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
