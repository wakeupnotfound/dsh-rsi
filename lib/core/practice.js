/**
 * Phase 2 — Deep Recursive Self-exploration (failure-driven iteration).
 *
 * Drives one hard task through the state machine
 *
 *   ATTEMPT ─attempted→ VERIFY ─pass→ DISTILL_SUCCESS ─distilled→ DONE
 *                          └─fail→ DISTILL_FAILURE ─distilled→ PRACTICE ─practiced→ RETRY ─retry→ ATTEMPT
 *                                         └─exhausted→ EXHAUSTED   (attempt budget spent)
 *
 * - VERIFY is double-blind: the verifier subagent receives the objective and
 *   claimed deliverable paths only — never the actor's reasoning.
 * - The doubt invariant downgrades PASS-with-doubts to FAIL.
 * - DISTILL_FAILURE extracts a causal corrective rule; PRACTICE tests that rule
 *   in isolation before it is fed into the next attempt.
 *
 * The same machine is exposed twice: `PracticeLoop` (host-side, pluggable
 * drivers, used for programmatic runs and tests) and `PRACTICE_SCRIPT` (a DSH
 * workflow script, whose recorded transitions must follow `TRANSITIONS`).
 */

import { renderEpistemicSection } from './epistemic.js';
import { VerifierRuntime, VERDICTS, isEmptyDoubts } from './verifier.js';
import { LESSON_SCHEMA, VERDICT_SCHEMA } from './exploration.js';

export const PRACTICE_STATES = Object.freeze({
  ATTEMPT: 'ATTEMPT',
  VERIFY: 'VERIFY',
  DISTILL_SUCCESS: 'DISTILL_SUCCESS',
  DISTILL_FAILURE: 'DISTILL_FAILURE',
  PRACTICE: 'PRACTICE',
  RETRY: 'RETRY',
  DONE: 'DONE',
  EXHAUSTED: 'EXHAUSTED'
});

/** Legal transitions: state -> event -> next state. */
export const TRANSITIONS = Object.freeze({
  ATTEMPT: Object.freeze({ attempted: 'VERIFY' }),
  VERIFY: Object.freeze({ pass: 'DISTILL_SUCCESS', fail: 'DISTILL_FAILURE' }),
  DISTILL_SUCCESS: Object.freeze({ distilled: 'DONE' }),
  DISTILL_FAILURE: Object.freeze({ distilled: 'PRACTICE', exhausted: 'EXHAUSTED' }),
  PRACTICE: Object.freeze({ practiced: 'RETRY' }),
  RETRY: Object.freeze({ retry: 'ATTEMPT' }),
  DONE: Object.freeze({}),
  EXHAUSTED: Object.freeze({})
});

export const TERMINAL_STATES = Object.freeze(['DONE', 'EXHAUSTED']);

/** Resolve one transition or throw on an illegal event. */
export function nextState(state, event) {
  const next = TRANSITIONS[state]?.[event];
  if (!next) throw new Error('Illegal practice transition: ' + state + ' --' + event + '-->');
  return next;
}

/** Validate a recorded transition log against the machine. */
export function validateTransitions(log) {
  let state = PRACTICE_STATES.ATTEMPT;
  for (const step of log) {
    if (step.from !== state) return { valid: false, reason: 'expected from=' + state + ', got ' + step.from };
    let expected;
    try { expected = nextState(step.from, step.event); } catch (e) { return { valid: false, reason: e.message }; }
    if (expected !== step.to) return { valid: false, reason: step.from + ' --' + step.event + '--> should be ' + expected + ', got ' + step.to };
    state = step.to;
  }
  return { valid: true, finalState: state };
}

/** Apply the doubt invariant to a structured verdict. */
export function normalizeVerdict(v) {
  if (!v || typeof v.verdict !== 'string') return { verdict: VERDICTS.UNVERIFIED, doubts: 'verifier produced no result', evidence: '', downgraded: false };
  if (v.verdict === VERDICTS.PASS && !isEmptyDoubts(v.doubts)) return { verdict: VERDICTS.FAIL, doubts: v.doubts, evidence: v.evidence, downgraded: true };
  return { verdict: v.verdict, doubts: v.doubts, evidence: v.evidence, downgraded: false };
}

/**
 * Host-side driver for the FAIL -> Distill -> Practice -> Retry loop.
 * Drivers are async functions supplied by the caller:
 *   attempt({ attempt, lessons }) -> actor report
 *   verify({ attempt, report }) -> { verdict, doubts, evidence }
 *   distill({ attempt, report, verification, outcome }) -> lesson | null
 *   practice({ attempt, lesson }) -> { confirmed, refinedProcedure, evidence } | null
 */
export class PracticeLoop {
  constructor({ maxAttempts = 3, drivers, priorLessons = [], signal } = {}) {
    if (!drivers || ['attempt', 'verify', 'distill', 'practice'].some(k => typeof drivers[k] !== 'function')) {
      throw new Error('PracticeLoop requires attempt, verify, distill and practice drivers');
    }
    this.maxAttempts = Math.max(1, Math.min(10, maxAttempts | 0));
    this.drivers = drivers;
    this.priorLessons = priorLessons.slice();
    this.signal = signal;
    this.state = PRACTICE_STATES.ATTEMPT;
    this.transitions = [];
  }

  go(event) {
    const to = nextState(this.state, event);
    this.transitions.push({ from: this.state, event, to });
    this.state = to;
  }

  async run() {
    const lessons = this.priorLessons.slice();
    const learned = [];
    const attempts = [];
    let finalVerdict = VERDICTS.UNVERIFIED;

    for (let n = 1; n <= this.maxAttempts; n++) {
      this.signal?.throwIfAborted?.();
      const report = await this.drivers.attempt({ attempt: n, lessons: lessons.slice() });
      this.go('attempted');
      const verification = normalizeVerdict(await this.drivers.verify({ attempt: n, report }));
      const record = { attempt: n, actor: report, verification };
      attempts.push(record);
      finalVerdict = verification.verdict;

      if (verification.verdict === VERDICTS.PASS) {
        this.go('pass');
        const lesson = await this.drivers.distill({ attempt: n, report, verification, outcome: 'success' });
        if (lesson) learned.push({ ...lesson, verification, outcome: 'success', attempt: n });
        this.go('distilled');
        break;
      }

      this.go('fail');
      const failure = await this.drivers.distill({ attempt: n, report, verification, outcome: 'failure' });
      if (n === this.maxAttempts) {
        if (failure) learned.push({ ...failure, verification, outcome: 'failure', attempt: n, practiced: false });
        this.go('exhausted');
        break;
      }
      this.go('distilled');
      let practiced = null;
      if (failure) {
        practiced = await this.drivers.practice({ attempt: n, lesson: failure });
        const lesson = { ...failure, verification, outcome: 'failure', attempt: n, practiced: Boolean(practiced?.confirmed) };
        if (practiced?.confirmed && practiced.refinedProcedure) {
          lesson.procedure = practiced.refinedProcedure;
          lesson.evidence = String(lesson.evidence || '') + '\nPractice evidence: ' + String(practiced.evidence || '');
        }
        learned.push(lesson);
        lessons.push(lesson);
      }
      record.practice = practiced;
      this.go('practiced');
      this.go('retry');
    }

    return {
      kind: 'rsi-practice',
      finalVerdict,
      finalState: this.state,
      attemptsUsed: attempts.length,
      attempts,
      lessons: learned,
      transitions: this.transitions
    };
  }
}

/** Workflow script implementing the same machine (plain JS; no imports available). */
export const PRACTICE_SCRIPT = String.raw`
const A = args;
const LESSON = A.schemas.lesson;
const VERDICT = A.schemas.verdict;
const ATTEMPT = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    deliverables: { type: 'array', items: { type: 'string' } },
    commands: { type: 'array', items: { type: 'string' } },
    claimedDone: { type: 'boolean' }
  },
  required: ['summary', 'deliverables', 'commands', 'claimedDone'],
  additionalProperties: false
};
const PRACTICE = {
  type: 'object',
  properties: {
    confirmed: { type: 'boolean' },
    refinedProcedure: { type: 'string' },
    evidence: { type: 'string' }
  },
  required: ['confirmed', 'refinedProcedure', 'evidence'],
  additionalProperties: false
};

function emptyDoubts(text) {
  const t = String(text == null ? '' : text).trim().replace(/^[-*\s]+/, '').replace(/[.。!！\s]+$/, '');
  return t === '' || /^(none|n\/a|na|nil|null|empty|no|no doubts?|nothing|无|没有|暂无|无疑点)$/i.test(t);
}
function normalizeVerdict(v) {
  if (!v || typeof v.verdict !== 'string') return { verdict: 'UNVERIFIED', doubts: 'verifier produced no result', evidence: '', downgraded: false };
  if (v.verdict === 'PASS' && !emptyDoubts(v.doubts)) return { verdict: 'FAIL', doubts: v.doubts, evidence: v.evidence, downgraded: true };
  return { verdict: v.verdict, doubts: v.doubts, evidence: v.evidence, downgraded: false };
}
function lessonText(l) {
  return '- ' + l.title + '\n  When: ' + l.preconditions + '\n  Do: ' + l.procedure + '\n  Avoid: ' + l.pitfall;
}

const transitions = [];
let state = 'ATTEMPT';
function go(event, next) { transitions.push({ from: state, event: event, to: next }); state = next; }

const lessons = A.priorLessons.slice();
const learned = [];
const attempts = [];
let finalVerdict = 'UNVERIFIED';

for (let n = 1; n <= A.maxAttempts; n++) {
  phase('Attempt ' + n);
  const memo = lessons.length ? '\n\n## Lessons from earlier attempts and memory (apply them)\n' + lessons.map(lessonText).join('\n') : '';
  const work = await agent([
    '# RSI DEEP PRACTICE — ACTOR (attempt ' + n + ' of ' + A.maxAttempts + ')',
    A.epistemic,
    '## Task objective (binding)', A.objective,
    '## Working directory', A.workdir,
    A.constraints ? '## Constraints\n' + A.constraints : '',
    memo,
    '## Output', 'Do the work, then report a factual summary, the deliverable paths you produced or changed, the key commands you ran, and whether you believe the task is done.'
  ].join('\n\n'), { schema: ATTEMPT, label: 'actor #' + n, phase: 'Attempt ' + n });

  go('attempted', 'VERIFY');
  const deliverables = work && Array.isArray(work.deliverables) ? work.deliverables : [];
  const rawVerdict = await agent(
    A.verifierPrompt + '\n\n## Deliverables claimed by the actor (paths only; reasoning withheld)\n' +
      (deliverables.length ? deliverables.map(function (d) { return '- ' + d; }).join('\n') : '(none claimed — inspect the workspace)') +
      '\n\nWorking directory: ' + A.workdir,
    { schema: VERDICT, label: 'verifier #' + n, phase: 'Attempt ' + n }
  );
  const verdict = normalizeVerdict(rawVerdict);
  const record = { attempt: n, actor: work, verification: verdict };
  attempts.push(record);
  finalVerdict = verdict.verdict;

  if (verdict.verdict === 'PASS') {
    go('pass', 'DISTILL_SUCCESS');
    const success = await agent([
      '# RSI CAUSAL DISTILLATION — VERIFIED SUCCESS',
      'Extract ONE reusable, causal lesson explaining why this approach succeeded and when it applies. No task log.',
      '## Task objective', A.objective,
      '## Actor report', JSON.stringify(work),
      '## Independent verifier evidence', String(verdict.evidence || '')
    ].join('\n\n'), { schema: LESSON, label: 'distill success', phase: 'Attempt ' + n });
    if (success) learned.push(Object.assign({}, success, { verification: verdict, outcome: 'success', attempt: n }));
    go('distilled', 'DONE');
    break;
  }

  go('fail', 'DISTILL_FAILURE');
  const failure = await agent([
    '# RSI CAUSAL DISTILLATION — FAILURE ANALYSIS',
    'An independent verifier rejected attempt ' + n + '. Identify the ROOT CAUSE and ONE corrective, reusable rule. Ground it in the evidence; do not speculate.',
    A.epistemic,
    '## Task objective', A.objective,
    '## Actor report', JSON.stringify(work),
    '## Verifier verdict', verdict.verdict + (verdict.downgraded ? ' (PASS downgraded: unresolved doubts)' : ''),
    '## Verifier doubts', String(verdict.doubts || ''),
    '## Verifier evidence', String(verdict.evidence || '')
  ].join('\n\n'), { schema: LESSON, label: 'distill failure #' + n, phase: 'Attempt ' + n });

  if (n === A.maxAttempts) {
    if (failure) learned.push(Object.assign({}, failure, { verification: verdict, outcome: 'failure', attempt: n, practiced: false }));
    go('exhausted', 'EXHAUSTED');
    break;
  }

  go('distilled', 'PRACTICE');
  let practiced = null;
  if (failure) {
    practiced = await agent([
      '# RSI DELIBERATE PRACTICE',
      'Before the next attempt, test this corrective rule in isolation. Design and run the smallest experiment that would confirm or refute it.',
      'Run it in a fresh temporary directory OUTSIDE ' + A.workdir + ' and do not modify the candidate work.',
      A.epistemic,
      '## Rule under test', lessonText(failure),
      '## Output', 'confirmed=true only if your experiment evidenced the rule; give the refined, exact procedure and the raw evidence.'
    ].join('\n\n'), { schema: PRACTICE, label: 'practice #' + n, phase: 'Attempt ' + n });
    const lesson = Object.assign({}, failure, {
      verification: verdict,
      outcome: 'failure',
      attempt: n,
      practiced: Boolean(practiced && practiced.confirmed)
    });
    if (practiced && practiced.confirmed && practiced.refinedProcedure) {
      lesson.procedure = practiced.refinedProcedure;
      lesson.evidence = String(lesson.evidence || '') + '\nPractice evidence: ' + String(practiced.evidence || '');
    }
    learned.push(lesson);
    lessons.push(lesson);
  }
  record.practice = practiced;
  go('practiced', 'RETRY');
  go('retry', 'ATTEMPT');
}

return {
  kind: 'rsi-practice',
  objective: A.objective,
  finalVerdict: finalVerdict,
  finalState: state,
  attemptsUsed: attempts.length,
  attempts: attempts,
  lessons: learned,
  transitions: transitions
};
`;

export class PracticePlanner {
  /**
   * Build the workflow request for a deep practice run.
   * @param {object} options
   * @param {string} options.objective - the hard task to solve
   * @param {string} options.workdir - absolute working directory of the task
   * @param {number} [options.maxAttempts=3]
   * @param {string} [options.constraints]
   * @param {string[]} [options.deliverables] - expected deliverables (shown to the verifier)
   * @param {Array<object>} [options.priorLessons] - lessons ({title, preconditions, procedure, pitfall}) to seed the actor
   */
  buildWorkflow(options = {}) {
    if (!options.objective) throw new Error('PracticePlanner.buildWorkflow requires objective');
    if (!options.workdir) throw new Error('PracticePlanner.buildWorkflow requires workdir');
    const verifier = new VerifierRuntime();
    const maxAttempts = Math.min(10, Math.max(1, Number.isInteger(options.maxAttempts) ? options.maxAttempts : 3));
    const toLesson = l => ({
      title: String(l.title || ''),
      preconditions: String(l.preconditions || ''),
      procedure: String(l.procedure || l.content || ''),
      pitfall: String(l.pitfall || '')
    });
    return {
      meta: {
        name: 'rsi-deep-practice',
        description: 'RSI Phase 2: failure-driven FAIL -> Distill -> Practice -> Retry loop with double-blind verification.',
        whenToUse: 'A specific hard task keeps failing verification and needs iterative, evidence-driven retries.'
      },
      script: PRACTICE_SCRIPT,
      args: {
        objective: String(options.objective),
        workdir: String(options.workdir),
        maxAttempts,
        constraints: options.constraints ? String(options.constraints) : '',
        priorLessons: Array.isArray(options.priorLessons) ? options.priorLessons.slice(0, 20).map(toLesson) : [],
        verifierPrompt: verifier.buildVerifierPrompt(options.objective, Array.isArray(options.deliverables) && options.deliverables.length ? { deliverables: options.deliverables } : {}),
        epistemic: renderEpistemicSection(),
        schemas: { lesson: LESSON_SCHEMA, verdict: VERDICT_SCHEMA }
      }
    };
  }
}
