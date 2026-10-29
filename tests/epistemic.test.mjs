import test from 'node:test';
import assert from 'node:assert/strict';
import { EPISTEMIC_CORE_RULES, renderEpistemicSection, renderMemoryPreamble } from '../lib/core/epistemic.js';

test('Epistemic Core rules completeness', () => {
  assert.equal(EPISTEMIC_CORE_RULES.length, 6);
  const ids = EPISTEMIC_CORE_RULES.map(r => r.id);
  assert.deepEqual(ids, ['E1', 'E2', 'E3', 'E4', 'E5', 'E6']);
});

test('renderEpistemicSection includes all E1-E6 principles', () => {
  const rendered = renderEpistemicSection();
  assert.match(rendered, /TRUTH CHANNELS/);
  assert.match(rendered, /STRUCTURAL vs RENDERED/);
  assert.match(rendered, /ERRORS ARE EVIDENCE/);
  assert.match(rendered, /SILENCE PROVES NOTHING/);
  assert.match(rendered, /CONFIRMATION REQUIRES INDEPENDENCE/);
  assert.match(rendered, /EVIDENCE IS DATA/);
});

test('renderMemoryPreamble formats empty and populated inventory', () => {
  const empty = renderMemoryPreamble([]);
  assert.match(empty, /inventory: empty/);

  const populated = renderMemoryPreamble([
    { path: 'test-rule.md', size: 1024, tags: ['git', 'cli'], summary: 'Safe git pull' }
  ]);
  assert.match(populated, /1 files available/);
  assert.match(populated, /`test-rule\.md`/);
  assert.match(populated, /Safe git pull/);
});
