/**
 * Epistemic Core (E1-E6) & System Prompt Injection for RSIAgent in DSH.
 * Derived from RSIAgent paper (arXiv:2609.15364) & core/actor.py
 */

export const EPISTEMIC_CORE_RULES = Object.freeze([
  {
    id: 'E1',
    name: 'TRUTH CHANNELS',
    rule: 'Every claim has a channel where it is checkable — files, APIs, test suites, and process state for structural facts; a render or screen capture for visual facts. Always prefer the verifiable channel over recall or guesswork.'
  },
  {
    id: 'E2',
    name: 'STRUCTURAL vs RENDERED',
    rule: 'Exact values (text, numbers, coordinates, counts, code structure) are read and written in files with code. Visual layout and appearance are settled by rendering/viewing. When a task states both requirements, verify both.'
  },
  {
    id: 'E3',
    name: 'ERRORS ARE EVIDENCE',
    rule: 'Never silence the error stream of a command whose outcome is required. A failure message or traceback is critical causal evidence; an empty or silenced result is useless.'
  },
  {
    id: 'E4',
    name: 'SILENCE PROVES NOTHING',
    rule: 'Output marked [channel error] or [timeout], or an empty reply from an unverified channel, is not evidence of absence. Always re-probe or confirm channel liveness.'
  },
  {
    id: 'E5',
    name: 'CONFIRMATION REQUIRES INDEPENDENCE',
    rule: 'A source agreeing with itself is not confirmation. Only a different witness, an independent verification agent, or an external test execution confirms correctness.'
  },
  {
    id: 'E6',
    name: 'EVIDENCE IS DATA',
    rule: 'Record observations as concrete data (paths, output snippets, return codes), not silent belief. Every terminal decision must trace to recorded evidence.'
  }
]);

/**
 * Format the Epistemic Core for prompt injection.
 */
export function renderEpistemicSection() {
  const lines = [
    '# Epistemic Core (Grounding & Verification Doctrine)',
    'Follow these foundational principles to establish ground truth in all actions and claims:',
    ''
  ];
  for (const item of EPISTEMIC_CORE_RULES) {
    lines.push(`- **${item.id}. ${item.name}**: ${item.rule}`);
  }
  return lines.join('\n');
}

/**
 * Render the memory preamble and file listing for the system prompt.
 * @param {Array<{path: string, size: number, tags?: string[], summary?: string}>} memoryInventory
 */
export function renderMemoryPreamble(memoryInventory = []) {
  const count = memoryInventory.length;
  const lines = [
    '# Durable Memory & Environmental Lessons (RSI Bank)',
    'Notes from prior experience and verified task executions in this environment are available.',
    'Treat them as empirical hints: they may be incomplete or task-specific. Always verify against the live environment.',
    ''
  ];

  if (count === 0) {
    lines.push('Current durable-memory inventory: empty (0 files). No prior lessons recorded yet.');
    lines.push('After completing your task, verified successes or failure lessons will be distilled into this bank.');
  } else {
    lines.push(`Current durable-memory inventory (${count} files available):`);
    for (const item of memoryInventory) {
      const tagStr = item.tags && item.tags.length > 0 ? ` [${item.tags.join(', ')}]` : '';
      const summaryStr = item.summary ? ` - ${item.summary}` : '';
      lines.push(`- \`${item.path}\` (${item.size} bytes)${tagStr}${summaryStr}`);
    }
    lines.push('');
    lines.push('You may inspect, search, or read these files as needed using file/query tools.');
    lines.push('If new evidence contradicts earlier notes, update your approach and reconcile the memory.');
  }

  return lines.join('\n');
}
