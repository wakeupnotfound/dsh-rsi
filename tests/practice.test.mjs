import test from 'node:test';
import assert from 'node:assert/strict';
import { PracticeLoop, PracticePlanner, TRANSITIONS, nextState, validateTransitions, normalizeVerdict } from '../lib/core/practice.js';
import { runWorkflowScript } from './helpers/workflow-sim.mjs';

const failureLesson = { title: 'Await server before tests', category: 'workflow', tags: ['test'], preconditions: 'integration tests', procedure: 'wait-on port', pitfall: 'race', evidence: 'ECONNREFUSED', verifyCommand: '' };

test('transition table rejects illegal moves', () => {
  assert.equal(nextState('ATTEMPT', 'attempted'), 'VERIFY');
  assert.equal(nextState('DISTILL_FAILURE', 'exhausted'), 'EXHAUSTED');
  assert.throws(() => nextState('ATTEMPT', 'pass'), /Illegal/);
  assert.throws(() => nextState('DONE', 'retry'), /Illegal/);
  assert.deepEqual(Object.keys(TRANSITIONS.DONE), []);
  assert.equal(validateTransitions([{ from: 'ATTEMPT', event: 'attempted', to: 'DONE' }]).valid, false);
});

test('normalizeVerdict applies the doubt invariant', () => {
  assert.equal(normalizeVerdict({ verdict: 'PASS', doubts: 'None', evidence: '' }).verdict, 'PASS');
  assert.equal(normalizeVerdict({ verdict: 'PASS', doubts: 'edge case unchecked', evidence: '' }).verdict, 'FAIL');
  assert.equal(normalizeVerdict(null).verdict, 'UNVERIFIED');
});

test('PracticeLoop: FAIL -> Distill -> Practice -> Retry -> PASS', async () => {
  const seen = [];
  const loop = new PracticeLoop({
    maxAttempts: 3,
    drivers: {
      attempt: async ({ attempt, lessons }) => { seen.push(lessons.length); return { summary: 'try ' + attempt }; },
      verify: async ({ attempt }) => attempt === 1 ? { verdict: 'FAIL', doubts: '', evidence: 'ECONNREFUSED' } : { verdict: 'PASS', doubts: 'none', evidence: 'ok' },
      distill: async ({ outcome }) => outcome === 'failure' ? { ...failureLesson } : { ...failureLesson, title: 'Success rule' },
      practice: async () => ({ confirmed: true, refinedProcedure: 'npx wait-on tcp:3000 before npm test', evidence: 'ok' })
    }
  });
  const result = await loop.run();
  assert.equal(result.finalVerdict, 'PASS');
  assert.equal(result.finalState, 'DONE');
  assert.equal(result.attemptsUsed, 2);
  assert.deepEqual(seen, [0, 1], 'the practiced lesson feeds the retry');
  assert.equal(result.lessons[0].procedure, 'npx wait-on tcp:3000 before npm test');
  assert.equal(result.lessons[0].practiced, true);
  assert.equal(result.lessons[1].outcome, 'success');
  assert.equal(validateTransitions(result.transitions).valid, true);
});

test('PracticeLoop: exhausts the attempt budget', async () => {
  const result = await new PracticeLoop({
    maxAttempts: 2,
    drivers: {
      attempt: async () => ({}),
      verify: async () => ({ verdict: 'PASS', doubts: 'not sure about Windows', evidence: '' }),
      distill: async () => ({ ...failureLesson }),
      practice: async () => ({ confirmed: false, refinedProcedure: '', evidence: 'refuted' })
    }
  }).run();
  assert.equal(result.finalState, 'EXHAUSTED');
  assert.equal(result.finalVerdict, 'FAIL', 'PASS with doubts is downgraded');
  assert.equal(result.attemptsUsed, 2);
  assert.equal(result.lessons.length, 2);
  assert.equal(result.lessons[0].practiced, false);
  assert.equal(validateTransitions(result.transitions).valid, true);
  assert.throws(() => new PracticeLoop({ drivers: {} }), /drivers/);
});

test('practice workflow script follows the same state machine, double-blind', async () => {
  const req = new PracticePlanner().buildWorkflow({ objective: 'Make integration tests pass', workdir: '/repo', maxAttempts: 3, priorLessons: [{ title: 'Old rule', content: 'use node 20' }] });
  assert.equal(req.args.priorLessons[0].procedure, 'use node 20');
  let attempt = 0;
  const { value, calls } = await runWorkflowScript(req.script, req.args, (prompt) => {
    if (prompt.startsWith('# RSI DEEP PRACTICE — ACTOR')) {
      attempt++;
      assert.ok(prompt.includes('Old rule'), 'seeded lessons reach the actor');
      if (attempt === 2) assert.ok(prompt.includes('Await server before tests'), 'distilled lesson reaches the retry');
      return { summary: 'secret actor reasoning ' + attempt, deliverables: ['src/app.js'], commands: ['npm test'], claimedDone: true };
    }
    if (prompt.startsWith('# INDEPENDENT VERIFIER AGENT')) {
      assert.ok(!prompt.includes('secret actor reasoning'), 'verifier never sees actor reasoning');
      assert.ok(prompt.includes('src/app.js'));
      return attempt === 1 ? { verdict: 'FAIL', doubts: '', evidence: 'ECONNREFUSED' } : { verdict: 'PASS', doubts: 'None', evidence: '11 passing' };
    }
    if (prompt.startsWith('# RSI CAUSAL DISTILLATION — FAILURE')) return { ...failureLesson };
    if (prompt.startsWith('# RSI CAUSAL DISTILLATION — VERIFIED SUCCESS')) return { ...failureLesson, title: 'Success rule' };
    if (prompt.startsWith('# RSI DELIBERATE PRACTICE')) return { confirmed: true, refinedProcedure: 'wait-on tcp:3000', evidence: 'ok' };
    throw new Error('unexpected prompt ' + prompt.slice(0, 50));
  });
  assert.equal(value.kind, 'rsi-practice');
  assert.equal(value.finalVerdict, 'PASS');
  assert.equal(value.finalState, 'DONE');
  assert.equal(value.attemptsUsed, 2);
  assert.equal(value.lessons[0].procedure, 'wait-on tcp:3000');
  assert.deepEqual(validateTransitions(value.transitions), { valid: true, finalState: 'DONE' });
  assert.equal(calls.length, 7);
});

test('practice workflow script ends EXHAUSTED when every attempt fails', async () => {
  const req = new PracticePlanner().buildWorkflow({ objective: 'x', workdir: '/repo', maxAttempts: 2 });
  const { value } = await runWorkflowScript(req.script, req.args, (prompt) => {
    if (prompt.startsWith('# RSI DEEP PRACTICE — ACTOR')) return { summary: 's', deliverables: [], commands: [], claimedDone: false };
    if (prompt.startsWith('# INDEPENDENT VERIFIER AGENT')) return null; // verifier crashed -> UNVERIFIED
    if (prompt.startsWith('# RSI CAUSAL DISTILLATION')) return { ...failureLesson };
    if (prompt.startsWith('# RSI DELIBERATE PRACTICE')) return { confirmed: false, refinedProcedure: '', evidence: 'no' };
    throw new Error('unexpected');
  });
  assert.equal(value.finalState, 'EXHAUSTED');
  assert.equal(value.finalVerdict, 'UNVERIFIED');
  assert.equal(validateTransitions(value.transitions).valid, true);
});
