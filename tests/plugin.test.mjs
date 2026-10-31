import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { apply, applyComponent, COMPONENTS } from '../lib/index.js';
import { TOOL_DEFINITIONS, RSI_TOOLS } from '../lib/tools/definitions.js';
import { runWorkflowScript, schemaViolations } from './helpers/workflow-sim.mjs';

test('tool definitions declare DSH-compatible output schemas and renderers', () => {
  assert.equal(TOOL_DEFINITIONS.length, RSI_TOOLS.length);
  for (const def of TOOL_DEFINITIONS) {
    assert.ok(RSI_TOOLS.includes(def.name), def.name);
    assert.equal(typeof def.output, 'object', `${def.name} must declare output`);
    assert.equal(typeof def.output.render, 'function', `${def.name} must declare output.render`);
    assert.deepEqual(schemaViolations(def.output.schema), [], `${def.name} output.schema`);
    assert.deepEqual(schemaViolations(def.parameters), [], `${def.name} parameters`);
  }
});

test('DSH plugin lifecycle enforces strict host contracts (output, sync sections, disposers)', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rsi-plugin-'));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));

  const sections = new Map();
  const tools = new Map();
  const disposers = [];

  // Emulates @deepseek-ai/dsh-tools and @deepseek-ai/dsh-system-prompt contracts:
  // register() throws without output { schema, render }, and section text is not awaited.
  const mockCtx = {
    systemPrompt: {
      section: (def) => {
        sections.set(def.name, def);
        return () => sections.delete(def.name);
      }
    },
    tools: {
      register: (def) => {
        if (!def.output || typeof def.output.render !== 'function') {
          throw new TypeError(`tool "${def.name}" must declare output { schema, render }`);
        }
        tools.set(def.name, def);
        return () => tools.delete(def.name);
      }
    },
    effect: (fn) => {
      const dispose = fn();
      assert.equal(typeof dispose, 'function', 'ctx.effect callback must return a disposer');
      disposers.push(dispose);
    }
  };
  const mockRoot = { inject: (_deps, cb) => cb(mockCtx) };

  const mounted = apply(mockRoot, {
    workspaceDir: tmpDir,
    globalMemoryDir: path.join(tmpDir, 'global'),
    epistemicPromptOrder: 3100,
    memoryPromptOrder: 3110
  });

  assert.equal(COMPONENTS.length, 4);
  assert.equal(sections.size, 2);
  assert.deepEqual([...tools.keys()].sort(), [...RSI_TOOLS].sort());

  // Memory section text must be a synchronous string, never a Promise.
  const memSection = sections.get('dsh-rsi:memory-inventory');
  const emptyText = memSection.text({});
  assert.equal(typeof emptyText, 'string');
  assert.match(emptyText, /empty \(0 files\)/);

  await mounted.memoryBank.save({ id: 'rule-1', title: 'Test rule', content: 'body', tags: ['t'] }, 'workspace');
  const populatedText = memSection.text({});
  assert.equal(typeof populatedText, 'string');
  assert.match(populatedText, /1 files available/);
  assert.match(populatedText, /Test rule/);

  // Every disposer withdraws its registration cleanly.
  for (const d of disposers) d();
  assert.equal(sections.size, 0);
  assert.equal(tools.size, 0);
});

test('rsi_explore and rsi_practice execute via workflowEngine and commit only audited lessons', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rsi-wf-'));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));

  const tools = new Map();
  let engineAvailable = true;

  // Emulates DSH isolation: root plugin ctx does NOT see workflowEngine,
  // but exec.agent.ctx (inside the delegation group) DOES have it.
  const mockAgentWorkflowEngine = {
    start: ({ script, args }) => {
      const result = runWorkflowScript(script, args, (prompt) => {
        if (prompt.startsWith('# RSI BROAD EXPLORATION')) {
          return {
            summary: 'ok',
            lessons: [
              { title: 'Good rule', category: 'workflow', tags: ['a'], preconditions: 'p', procedure: 'do x', pitfall: 'y', evidence: 'e', verifyCommand: 'true' },
              { title: 'Doubtful rule', category: 'workflow', tags: ['a'], preconditions: 'p', procedure: 'do z', pitfall: 'y', evidence: 'e', verifyCommand: 'true' }
            ],
            followUps: []
          };
        }
        if (prompt.startsWith('# INDEPENDENT LESSON AUDIT')) {
          return prompt.includes('Good rule')
            ? { verdict: 'PASS', doubts: 'None', evidence: 'verified' }
            : { verdict: 'PASS', doubts: 'untested on Linux', evidence: 'partial' };
        }
        if (prompt.startsWith('# RSI DEEP PRACTICE — ACTOR')) {
          return { summary: 'done', deliverables: ['a.js'], commands: ['npm test'], claimedDone: true };
        }
        if (prompt.startsWith('# INDEPENDENT VERIFIER AGENT')) {
          return { verdict: 'PASS', doubts: 'None', evidence: 'tests green' };
        }
        if (prompt.startsWith('# RSI CAUSAL DISTILLATION')) {
          return { title: 'Practice rule', category: 'workflow', tags: ['p'], preconditions: 'w', procedure: 'run test', pitfall: 'none', evidence: 'ok', verifyCommand: 'npm test' };
        }
        return null;
      }).then(r => ({ stopReason: 'completed', agentsStarted: r.calls.length, value: r.value }));
      return { id: 'run-1', result, cancel: () => {}, dispose: async () => {} };
    }
  };

  // Emulates DSH delegation group isolation:
  // Root context and parent agent.ctx do NOT directly expose workflowEngine (it is isolated to the child delegation group).
  // The DSH agentPresets service provides serviceFor(agent, 'workflowEngine') to resolve services inside the isolated preset mount.
  const mockAgentPresets = {
    serviceFor: (agent, serviceName) => {
      if (serviceName === 'workflowEngine' && engineAvailable) {
        return mockAgentWorkflowEngine;
      }
      return undefined;
    }
  };

  const mockCtx = {
    get: (key) => {
      if (key === 'workingDirectory') return { get: () => tmpDir, ensure: async () => tmpDir };
      if (key === 'agentPresets') return mockAgentPresets;
      // Root context does NOT have workflowEngine
      return undefined;
    },
    tools: { register: (def) => { tools.set(def.name, def); return () => {}; } },
    effect: (fn) => fn()
  };

  applyComponent({ inject: (_d, cb) => cb(mockCtx) }, { globalMemoryDir: path.join(tmpDir, 'global') }, 'explorer');
  applyComponent({ inject: (_d, cb) => cb(mockCtx) }, { globalMemoryDir: path.join(tmpDir, 'global') }, 'memory');

  const exec = {
    agent: {
      id: 'agent-1',
      session: { header: { cwd: tmpDir } },
      // Parent agent.ctx does NOT have workflowEngine directly (due to delegation group isolate: true)
      ctx: {
        get: (key) => (key === 'agentPresets' ? mockAgentPresets : undefined)
      }
    },
    signal: new AbortController().signal
  };

  const exploreRes = await tools.get('rsi_explore').execute({ facets: ['test-suite'], waves: 1 }, exec);
  assert.equal(exploreRes.status, 'completed');
  assert.equal(exploreRes.committed.length, 1);
  assert.equal(exploreRes.committed[0].title, 'Good rule');
  assert.equal(exploreRes.rejected.length, 1);

  const practiceRes = await tools.get('rsi_practice').execute({ objective: 'Fix Good rule test' }, exec);
  assert.equal(practiceRes.status, 'completed');
  assert.equal(practiceRes.final_verdict, 'PASS');
  assert.equal(practiceRes.seeded_lessons, 1, 'seeds actor from matching memory entry');
  assert.equal(practiceRes.committed.length, 1);

  // Script fallback when workflowEngine is absent, then commit via workflow_result.
  engineAvailable = false;
  const fallback = await tools.get('rsi_explore').execute({ waves: 1 }, exec);
  assert.equal(fallback.status, 'workflow_script');
  assert.equal(fallback.workflow.meta.name, 'rsi-broad-exploration');

  // Boundary check: workflow_result with doubts MUST be rejected even if verdict is PASS
  const boundaryCheck = await tools.get('rsi_explore').execute({
    workflow_result: {
      kind: 'rsi-exploration',
      lessons: [
        { title: 'Suspicious rule', category: 'workflow', tags: ['s'], preconditions: 'p', procedure: 'do s', pitfall: 'pf', evidence: 'ev', verifyCommand: '', verification: { verdict: 'PASS', doubts: 'unresolved edge case on Windows', evidence: 'untested' } },
        { title: 'Clean manual rule', category: 'environment', tags: ['m'], preconditions: 'p', procedure: 'do m', pitfall: 'pf', evidence: 'ev', verifyCommand: '', verification: { verdict: 'PASS', doubts: 'None', evidence: 'ok' } }
      ],
      rejected: []
    }
  }, exec);
  assert.equal(boundaryCheck.status, 'committed');
  assert.equal(boundaryCheck.committed.length, 1, 'Only clean PASS without doubts is committed');
  assert.equal(boundaryCheck.committed[0].title, 'Clean manual rule');
  assert.equal(boundaryCheck.skipped_unaudited, 1, 'PASS-with-doubts is rejected at boundary');

  // Test practice workflow_result re-audit: failure advancing to success updates same ID in-place
  const practiceSpec = {
    title: 'Practice reaudit spec',
    category: 'workflow',
    tags: ['db'],
    preconditions: 'pre',
    procedure: 'proc',
    pitfall: 'pit',
    evidence: 'ev',
    verifyCommand: 'test'
  };

  const practiceFailResult = await tools.get('rsi_practice').execute({
    workflow_result: {
      kind: 'rsi-practice',
      lessons: [{ ...practiceSpec, outcome: 'failure', verification: { verdict: 'FAIL', doubts: 'failed', evidence: 'no' } }]
    }
  }, exec);
  assert.equal(practiceFailResult.status, 'committed');
  assert.equal(practiceFailResult.committed.length, 1);
  const failEntryId = practiceFailResult.committed[0].id;

  const practiceSuccessResult = await tools.get('rsi_practice').execute({
    workflow_result: {
      kind: 'rsi-practice',
      lessons: [{ ...practiceSpec, outcome: 'success', verification: { verdict: 'PASS', doubts: 'None', evidence: 'yes' } }]
    }
  }, exec);
  assert.equal(practiceSuccessResult.status, 'committed');
  assert.equal(practiceSuccessResult.committed.length, 1);
  const successEntryId = practiceSuccessResult.committed[0].id;

  assert.equal(failEntryId, successEntryId, 'Practice failure advancing to success must retain identical ID despite outcome tags');
  const allPracticeEntries = (await tools.get('rsi_query_memory').execute({ query: 'Practice reaudit spec' }, exec)).matches;
  assert.equal(allPracticeEntries.length, 1, 'In-place re-audit must not leave orphaned failure duplicates');
  assert.ok(allPracticeEntries[0].tags.includes('outcome-success'), 'Updated entry must have outcome-success tag');

  const queried = await tools.get('rsi_query_memory').execute({ query: '' }, exec);
  assert.equal(queried.count, 4);
});
