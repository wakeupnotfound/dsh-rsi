import test from 'node:test';
import assert from 'node:assert/strict';
import { ExplorationPlanner, DEFAULT_FACETS, LESSON_SCHEMA, VERDICT_SCHEMA, lessonToEntry, resolveFacets } from '../lib/core/exploration.js';
import { runWorkflowScript, schemaViolations } from './helpers/workflow-sim.mjs';

const lesson = (title, extra = {}) => ({
  title,
  category: 'workflow',
  tags: ['npm'],
  preconditions: 'Node 20 repo',
  procedure: 'Run npm test',
  pitfall: 'npm t without args hides output',
  evidence: 'exit 0, 11 tests',
  verifyCommand: 'npm test',
  ...extra
});

test('ExplorationPlanner builds a valid workflow request', () => {
  const req = new ExplorationPlanner().buildWorkflow({ repoPath: '/repo', facets: ['test-suite', 'custom focus'], waves: 9 });
  assert.equal(req.meta.name, 'rsi-broad-exploration');
  assert.equal(req.args.waves, 2, 'waves is clamped to 2');
  assert.equal(req.args.facets.length, 2);
  assert.equal(req.args.facets[0].id, 'test-suite');
  assert.equal(req.args.facets[1].id, 'custom-focus');
  assert.deepEqual(schemaViolations(LESSON_SCHEMA), []);
  assert.deepEqual(schemaViolations(VERDICT_SCHEMA), []);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(req.args)));
  assert.throws(() => new ExplorationPlanner().buildWorkflow({}), /repoPath/);
  assert.equal(resolveFacets().length, DEFAULT_FACETS.length);
});

test('exploration script runs waves, audits double-blind, and enforces the doubt invariant', async () => {
  const req = new ExplorationPlanner().buildWorkflow({ repoPath: '/repo', facets: ['build-and-run', 'test-suite'], maxFollowUps: 2 });
  const { value, calls, phases } = await runWorkflowScript(req.script, req.args, (prompt) => {
    if (prompt.startsWith('# RSI BROAD EXPLORATION — Build')) {
      return { summary: 's', lessons: [lesson('Use npm run build')], followUps: ['Why does build need Node 20?', 'why does build need node 20'] };
    }
    if (prompt.startsWith('# RSI BROAD EXPLORATION — Test')) {
      return { summary: 's', lessons: [lesson('Run single test with --test-name-pattern'), lesson('use npm run build')], followUps: ['Flaky tests?'] };
    }
    if (prompt.startsWith('# RSI DEEP PROBE')) {
      return prompt.includes('Flaky') ? null : { summary: 's', lessons: [lesson('Node 20 required for fetch')], followUps: [] };
    }
    if (prompt.startsWith('# INDEPENDENT LESSON AUDIT')) {
      assert.ok(!prompt.includes('RSI BROAD EXPLORATION'), 'auditor must not see explorer prompt');
      if (prompt.includes('single test')) return { verdict: 'PASS', doubts: 'flag may differ on Node 18', evidence: 'ran it' };
      if (prompt.includes('fetch')) return { verdict: 'FAIL', doubts: '', evidence: 'works on 18' };
      return { verdict: 'PASS', doubts: 'None', evidence: 'build exit 0' };
    }
    throw new Error('unexpected prompt: ' + prompt.slice(0, 60));
  });

  assert.deepEqual(phases, ['Wave 1: broad survey', 'Wave 2: deep probes', 'Audit: independent verification']);
  assert.equal(value.kind, 'rsi-exploration');
  assert.deepEqual(value.followUps, ['Why does build need Node 20?', 'Flaky tests?'], 'follow-ups are deduplicated');
  assert.equal(value.stats.candidates, 3, 'duplicate lesson titles are merged');
  assert.deepEqual(value.lessons.map(l => l.title), ['Use npm run build']);
  const downgraded = value.rejected.find(r => r.title.includes('single test'));
  assert.equal(downgraded.verification.verdict, 'FAIL');
  assert.equal(downgraded.verification.downgraded, true);
  assert.equal(value.waves[1].completed, 1, 'failed child resolves null and is counted');
  assert.equal(calls.filter(c => c.prompt.startsWith('# INDEPENDENT LESSON AUDIT')).length, 3);
});

test('verify=false never yields committable lessons', async () => {
  const req = new ExplorationPlanner().buildWorkflow({ repoPath: '/repo', facets: ['toolchain'], waves: 1, verify: false });
  const { value } = await runWorkflowScript(req.script, req.args, () => ({ summary: 's', lessons: [lesson('x rule')], followUps: ['q'] }));
  assert.equal(value.lessons.length, 0);
  assert.equal(value.rejected[0].verification.verdict, 'UNVERIFIED');
  assert.equal(value.waves.length, 1);
});

test('lessonToEntry produces the four-section memory format', () => {
  const entry = lessonToEntry({ ...lesson('Use npm run build!'), verification: { verdict: 'PASS', evidence: 'exit 0' } });
  assert.equal(entry.id, 'exploration-use-npm-run-build');
  assert.equal(entry.verified, true);
  assert.ok(entry.tags.includes('rsi-exploration'));
  for (const h of ['### Preconditions & Context', '### Proven Rule / Recommended Action', '### Pitfall / Failure Mechanism', '### Evidence', 'VERDICT: PASS']) {
    assert.ok(entry.content.includes(h), h);
  }
});

test('lessonToEntry and MemoryBank preserve distinct CJK titles without collision', async (t) => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');
  const { MemoryBank } = await import('../lib/core/memory.js');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rsi-cjk-'));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));

  const bank = new MemoryBank({ workspaceDir: tmpDir });
  await bank.init();

  const e1 = lessonToEntry({ title: '中文规则甲', category: 'workflow', preconditions: 'p1', procedure: 'do甲', pitfall: 'pf1', evidence: 'ev1' });
  const e2 = lessonToEntry({ title: '中文规则乙', category: 'workflow', preconditions: 'p2', procedure: 'do乙', pitfall: 'pf2', evidence: 'ev2' });

  assert.equal(e1.id, 'exploration-中文规则甲');
  assert.equal(e2.id, 'exploration-中文规则乙');
  assert.notEqual(e1.id, e2.id);

  const res1 = await bank.save(e1, 'workspace');
  const res2 = await bank.save(e2, 'workspace');

  assert.notEqual(res1.path, res2.path);
  assert.ok(res1.path.endsWith('exploration-中文规则甲.md'));
  assert.ok(res2.path.endsWith('exploration-中文规则乙.md'));

  const files = await fs.readdir(path.join(tmpDir, '.rsi', 'memory'));
  assert.equal(files.filter(f => f.endsWith('.md')).length, 2);

  const read1 = await bank.get(e1.id);
  const read2 = await bank.get(e2.id);
  assert.equal(read1.title, '中文规则甲');
  assert.equal(read2.title, '中文规则乙');
});
