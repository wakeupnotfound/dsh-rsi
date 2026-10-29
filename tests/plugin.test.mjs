import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

test('DSH plugin lifecycle mounts prompt sections and tools', () => {
  const registeredSections = [];
  const registeredTools = [];

  const mockCtx = {
    systemPrompt: {
      section: (def) => registeredSections.push(def)
    },
    tools: {
      register: (def) => registeredTools.push(def)
    },
    effect: (fn) => fn()
  };

  const mockRoot = {
    inject: (deps, callback) => {
      callback(mockCtx);
    }
  };

  const mounted = apply(mockRoot, {
    epistemicPromptOrder: 3100,
    memoryPromptOrder: 3110
  });

  assert.ok(mounted);
  assert.ok(mounted.memoryBank);
  assert.ok(mounted.verifierRuntime);

  // Check registered sections
  assert.equal(registeredSections.length, 2);
  const sectionNames = registeredSections.map(s => s.name);
  assert.ok(sectionNames.includes('dsh-rsi:epistemic-core'));
  assert.ok(sectionNames.includes('dsh-rsi:memory-inventory'));

  // Check registered tools
  assert.equal(registeredTools.length, 4);
  const toolNames = registeredTools.map(t => t.name);
  assert.ok(toolNames.includes('rsi_verify'));
  assert.ok(toolNames.includes('rsi_distill_memory'));
  assert.ok(toolNames.includes('rsi_reconcile_memory'));
  assert.ok(toolNames.includes('rsi_query_memory'));
});
