import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDistiller } from '../lib/core/distillation.js';

test('MemoryDistiller prompt creation and entry parsing', () => {
  const distiller = new MemoryDistiller();

  const prompt = distiller.buildDistillationPrompt({
    taskObjective: 'Export STEP file from FreeCAD',
    verdict: 'FAIL',
    verifierReport: 'Export failed: Part.export was called before recompute().',
    trajectorySummary: 'Attempted Part.export(objs, path), got empty file.'
  });

  assert.match(prompt, /VERIFIED FAIL/);
  assert.match(prompt, /Export STEP file from FreeCAD/);
  assert.match(prompt, /Part\.export was called before recompute/);

  // Test parsing markdown with frontmatter
  const sampleMarkdown = `
\`\`\`markdown
---
id: "freecad-step-export-recompute"
title: "Always recompute doc before Part.export in FreeCAD"
category: "tool-pitfall"
tags: ["freecad", "cad", "python"]
---
### Preconditions & Context
When generating geometry and exporting STEP in FreeCAD headless scripts.

### Proven Rule / Recommended Action
Always call \`doc.recompute()\` immediately before calling \`Part.export([obj], filepath)\`.

### Pitfall / Failure Mechanism
Exporting without recomputing leaves the geometric shape unmeshed or empty.
\`\`\`
`;

  const parsed = distiller.parseDistilledEntry(sampleMarkdown);
  assert.ok(parsed);
  assert.equal(parsed.id, 'freecad-step-export-recompute');
  assert.equal(parsed.title, 'Always recompute doc before Part.export in FreeCAD');
  assert.equal(parsed.category, 'tool-pitfall');
  assert.deepEqual(parsed.tags, ['freecad', 'cad', 'python']);
  assert.match(parsed.content, /doc\.recompute\(\)/);
});
