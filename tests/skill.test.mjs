import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('RSI Skill definitions and reference files integrity', () => {
  const skillMdPath = path.join(rootDir, 'skills', 'rsi', 'SKILL.md');
  const metaPath = path.join(rootDir, 'skills', 'rsi', '_meta.json');

  assert.ok(fs.existsSync(skillMdPath), 'skills/rsi/SKILL.md must exist');
  assert.ok(fs.existsSync(metaPath), 'skills/rsi/_meta.json must exist');

  const content = fs.readFileSync(skillMdPath, 'utf8');
  assert.ok(content.startsWith('---'), 'SKILL.md must have YAML frontmatter');
  assert.ok(content.includes('name: rsi'), 'Skill name must be rsi');
  assert.ok(content.includes('allowed-tools:'), 'SKILL.md must declare allowed-tools');
  assert.ok(content.includes('The RSI Pipeline'), 'SKILL.md must document the RSI pipeline');

  // Check all referenced files exist
  const referencesDir = path.join(rootDir, 'skills', 'rsi', 'references');
  const requiredRefs = [
    'epistemic-core.md',
    'double-blind-verification.md',
    'causal-distillation.md',
    'exploration-and-practice.md'
  ];

  for (const ref of requiredRefs) {
    const refPath = path.join(referencesDir, ref);
    assert.ok(fs.existsSync(refPath), `Reference document ${ref} must exist`);
    const refContent = fs.readFileSync(refPath, 'utf8');
    assert.ok(refContent.length > 100, `Reference document ${ref} must not be empty`);
  }

  // Check _meta.json
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.equal(meta.slug, 'rsi');
  assert.equal(meta.version, '0.2.0');
});
