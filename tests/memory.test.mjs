import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MemoryBank, memoryFileName } from '../lib/core/memory.js';

test('MemoryBank CRUD operations and tree hashing', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rsi-test-'));
  const bank = new MemoryBank({
    globalDir: path.join(tempDir, 'global'),
    workspaceDir: tempDir
  });

  t.after(async () => {
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  await bank.init();

  // Test save entry
  const entry = {
    id: 'git-merge-conflict-lesson',
    title: 'Handling Git Fast-Forward Failures',
    category: 'workflow',
    tags: ['git', 'cli'],
    content: 'Always run `git status` before pulling. If diverged, use `git pull --rebase`.'
  };

  const saved = await bank.save(entry, 'workspace');
  assert.equal(saved.id, 'git-merge-conflict-lesson');
  assert.ok(saved.sha256);

  // Test get
  const retrieved = await bank.get('git-merge-conflict-lesson');
  assert.ok(retrieved);
  assert.equal(retrieved.id, 'git-merge-conflict-lesson');
  assert.equal(retrieved.category, 'workflow');
  assert.deepEqual(retrieved.tags, ['git', 'cli']);
  assert.match(retrieved.content, /git pull --rebase/);

  // Test listAll
  const all = await bank.listAll();
  assert.equal(all.length, 1);

  // Test search
  const found = await bank.search({ query: 'fast-forward' });
  assert.equal(found.length, 1);
  const notFound = await bank.search({ query: 'nonexistent-string-xyz' });
  assert.equal(notFound.length, 0);

  // Test tree SHA256
  const hash1 = await bank.computeTreeSha256();
  assert.ok(hash1);
  assert.equal(hash1.length, 64);

  // Test delete
  const deleted = await bank.delete('git-merge-conflict-lesson');
  assert.equal(deleted, true);
  const afterDelete = await bank.listAll();
  assert.equal(afterDelete.length, 0);

  // Test Windows reserved device names in memoryFileName
  assert.equal(memoryFileName('con'), '_con.md');
  assert.equal(memoryFileName('CON'), '_CON.md');
  assert.equal(memoryFileName('NUL'), '_NUL.md');
  assert.equal(memoryFileName('aux'), '_aux.md');
  assert.equal(memoryFileName('com1'), '_com1.md');
  assert.equal(memoryFileName('lpt3'), '_lpt3.md');
  assert.equal(memoryFileName('normal-rule'), 'normal-rule.md');
});
