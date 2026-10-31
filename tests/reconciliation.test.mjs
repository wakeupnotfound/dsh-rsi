import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MemoryBank } from '../lib/core/memory.js';
import { MemoryReconciler } from '../lib/core/reconciliation.js';

test('MemoryReconciler contradiction detection and resolution', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rsi-recon-'));
  const bank = new MemoryBank({ workspaceDir: tempDir });
  const reconciler = new MemoryReconciler();

  t.after(async () => {
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  await bank.init();

  // Seed older entry with broad affirmative rule
  await bank.save({
    id: 'git-pull-rule',
    title: 'Git synchronization standard',
    category: 'workflow',
    tags: ['git'],
    content: 'Always use git pull with force merge on production branches.'
  }, 'workspace');

  // New conflicting entry
  const newEntry = {
    id: 'git-pull-safe-rebase',
    title: 'Git synchronization safe practice',
    category: 'workflow',
    tags: ['git'],
    content: 'Never use force merge on production branches; always use rebase or fast-forward.'
  };

  const commitResult = await reconciler.reconcileAndCommit(bank, newEntry, 'workspace');

  assert.ok(commitResult.committed);
  assert.equal(commitResult.reconciliationReport.conflictsResolved, 1);

  // Check that old entry was annotated with SUPERSEDED notice
  const updatedOld = await bank.get('git-pull-rule');
  assert.match(updatedOld.content, /SUPERSEDED \/ CONFLICT NOTICE/);
  assert.ok(updatedOld.tags.includes('deprecated'));
});

test('MemoryReconciler supersedes old entry when same lesson topic procedure evolves', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rsi-recon-topic-'));
  const bank = new MemoryBank({ workspaceDir: tempDir });
  const reconciler = new MemoryReconciler();

  t.after(async () => {
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  await bank.init();

  // Old rule with legacy build procedure (no negation keywords)
  await bank.save({
    id: 'exploration-build-legacy',
    title: 'run npm run build',
    category: 'workflow',
    tags: ['build'],
    content: 'run npm run build --legacy-peer-deps on release builds'
  }, 'workspace');

  // Evolved rule with modern procedure (no negation keywords)
  const evolvedEntry = {
    id: 'exploration-build-modern',
    title: 'run npm run build',
    category: 'workflow',
    tags: ['build'],
    content: 'run npm run build --modern-deps on release builds'
  };

  const commitResult = await reconciler.reconcileAndCommit(bank, evolvedEntry, 'workspace');

  assert.ok(commitResult.committed);
  assert.equal(commitResult.reconciliationReport.conflictsResolved, 1);
  assert.ok(commitResult.reconciliationReport.conflicts[0].reason.includes('Same lesson topic'));

  // Old rule must be annotated as superseded despite absence of negation words
  const oldEntry = await bank.get('exploration-build-legacy');
  assert.match(oldEntry.content, /SUPERSEDED \/ CONFLICT NOTICE/);
  assert.ok(oldEntry.tags.includes('deprecated'));
  assert.ok(oldEntry.tags.includes('superseded'));

  // New rule is active without deprecated tag
  const newEntry = await bank.get('exploration-build-modern');
  assert.ok(!newEntry.tags.includes('deprecated'));
});

test('MemoryReconciler avoids false-positive supersession on generic titles, low overlap, or truncated long titles', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rsi-recon-guards-'));
  const bank = new MemoryBank({ workspaceDir: tempDir });
  const reconciler = new MemoryReconciler();

  t.after(async () => {
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  await bank.init();

  // 1. Generic title with zero overlap
  const gen1 = { id: 'gen-1', title: 'Untitled lesson', category: 'workflow', content: 'alpha beta gamma delta epsilon' };
  const gen2 = { id: 'gen-2', title: 'Untitled lesson', category: 'workflow', content: 'zeta eta theta iota kappa lambda' };
  await bank.save(gen1, 'workspace');
  const resGen = await reconciler.reconcileAndCommit(bank, gen2, 'workspace');
  assert.equal(resGen.reconciliationReport.conflictsResolved, 0, 'Generic titles must not trigger auto-supersession');
  const checkGen1 = await bank.get('gen-1');
  assert.ok(!checkGen1.tags.includes('deprecated'), 'Generic title rule 1 must remain active');

  // 2. Long titles differing only after 80 chars
  const long1 = { id: 'long-1', title: 'A'.repeat(100) + '1', category: 'workflow', content: 'common test content for long title 1' };
  const long2 = { id: 'long-2', title: 'A'.repeat(100) + '2', category: 'workflow', content: 'common test content for long title 2' };
  await bank.save(long1, 'workspace');
  const resLong = await reconciler.reconcileAndCommit(bank, long2, 'workspace');
  assert.equal(resLong.reconciliationReport.conflictsResolved, 0, 'Long titles differing after 80 chars must not be treated as same topic');
  const checkLong1 = await bank.get('long-1');
  assert.ok(!checkLong1.tags.includes('deprecated'), 'Long title rule 1 must remain active');

  // 3. Same title but completely low overlap (unrelated tasks)
  const low1 = { id: 'low-1', title: 'Build script', category: 'workflow', content: 'compile rust backend binary with cargo build --release' };
  const low2 = { id: 'low-2', title: 'Build script', category: 'workflow', content: 'package electron desktop app with vite and electron-builder' };
  await bank.save(low1, 'workspace');
  const resLow = await reconciler.reconcileAndCommit(bank, low2, 'workspace');
  assert.equal(resLow.reconciliationReport.conflictsResolved, 0, 'Same title with low overlap must not trigger auto-supersession');
  const checkLow1 = await bank.get('low-1');
  assert.ok(!checkLow1.tags.includes('deprecated'), 'Unrelated build script rule 1 must remain active');
});
