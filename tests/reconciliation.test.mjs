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
