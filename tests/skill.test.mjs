import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('RSI Skill definitions and reference files integrity', () => {
  const skillMdPath = path.join(rootDir, 'skills', 'rsi', 'SKILL.md');
  const metaPath = path.join(rootDir, 'skills', 'rsi', '_meta.json');
  const cliPath = path.join(rootDir, 'skills', 'rsi', 'scripts', 'rsi-cli.mjs');

  assert.ok(fs.existsSync(skillMdPath), 'skills/rsi/SKILL.md must exist');
  assert.ok(fs.existsSync(metaPath), 'skills/rsi/_meta.json must exist');
  assert.ok(fs.existsSync(cliPath), 'skills/rsi/scripts/rsi-cli.mjs must exist');

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
  assert.equal(meta.version, '0.4.0');
});

test('Standalone Single-Skill CLI E2E: context -> explore -> verify -> distill -> practice', async (t) => {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'dsh-rsi-standalone-'));
  t.after(async () => {
    try { await fsPromises.rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  const skillSrc = path.join(rootDir, 'skills', 'rsi');
  const skillDest = path.join(tempDir, 'skills', 'rsi');
  await fsPromises.mkdir(path.dirname(skillDest), { recursive: true });
  await fsPromises.cp(skillSrc, skillDest, { recursive: true });

  const cliPath = path.join(skillDest, 'scripts', 'rsi-cli.mjs');
  assert.ok(fs.existsSync(cliPath), 'Bundled rsi-cli.mjs must exist in standalone copy');

  const runCli = (args, options = {}) => {
    return spawnSync('node', [cliPath, ...args], {
      cwd: tempDir,
      encoding: 'utf-8',
      ...options
    });
  };

  // 1. Context recall
  const contextRes = runCli(['context', '--task', 'git fast-forward merge conflict', '--top-k', '5']);
  assert.equal(contextRes.status, 0, `context command failed: ${contextRes.stderr}`);
  assert.match(contextRes.stdout, /Epistemic Core Principles/);
  assert.match(contextRes.stdout, /Dynamic Top-K Memory Recall/);

  // 2. Explore
  const exploreRes = runCli(['explore', '--goal', 'survey unfamiliar project']);
  assert.equal(exploreRes.status, 0, `explore command failed: ${exploreRes.stderr}`);
  assert.match(exploreRes.stdout, /meta/);

  // 3. Verify
  const targetFile = 'src/app.js';
  const verifyRes = runCli(['verify', '--target', targetFile, '--probe', 'node -v']);
  assert.equal(verifyRes.status, 0, `verify command failed: ${verifyRes.stderr}`);
  assert.match(verifyRes.stdout, /Verdict:\s*PASS/);
  assert.match(verifyRes.stdout, /---RSI-GUIDANCE-BEGIN---/);

  // Check receipt cached in .rsi/receipts/ and pointer in .rsi/.last_receipt
  const receiptsDir = path.join(tempDir, '.rsi', 'receipts');
  assert.ok(fs.existsSync(receiptsDir));
  const receiptFiles = (await fsPromises.readdir(receiptsDir)).filter(f => f.endsWith('.json'));
  assert.equal(receiptFiles.length, 1);
  const lastReceipt = (await fsPromises.readFile(path.join(tempDir, '.rsi', '.last_receipt'), 'utf-8')).trim();
  assert.equal(lastReceipt, receiptFiles[0].replace('.json', ''));

  // 4. Distill (consumes receipt automatically from .last_receipt)
  const distillRes = runCli([
    'distill',
    '--target', targetFile,
    '--title', 'Standalone CLI Node Verification Rule',
    '--preconditions', 'Node.js >= 20 in isolated sandbox',
    '--rule', 'Always verify with node -v before declaring done',
    '--evidence', 'node -v exited 0'
  ]);
  assert.equal(distillRes.status, 0, `distill command failed: ${distillRes.stderr}`);
  assert.match(distillRes.stdout, /✅ Distilled and committed/);

  // Check memory saved on disk
  const memDir = path.join(tempDir, '.rsi', 'memory');
  assert.ok(fs.existsSync(memDir));
  const memFiles = await fsPromises.readdir(memDir);
  assert.ok(memFiles.some(f => f.includes('standalone-cli-node-verification-rule')));

  // Check regression probe automatically synthesized in .rsi/probes/
  const probesDir = path.join(tempDir, '.rsi', 'probes');
  assert.ok(fs.existsSync(probesDir), 'distill must automatically create .rsi/probes/ directory');
  const probeFiles = (await fsPromises.readdir(probesDir)).filter(f => f.endsWith('.json'));
  assert.equal(probeFiles.length, 1);
  assert.equal(probeFiles[0], 'standalone-cli-node-verification-rule.json');
  const probeData = JSON.parse(await fsPromises.readFile(path.join(probesDir, probeFiles[0]), 'utf8'));
  assert.equal(probeData.probeCommand, 'node -v');
  assert.equal(probeData.target, targetFile);

  // Check receipt archived to .consumed/
  const consumedDir = path.join(tempDir, '.rsi', 'receipts', '.consumed');
  assert.ok(fs.existsSync(consumedDir));
  const consumedFiles = await fsPromises.readdir(consumedDir);
  assert.equal(consumedFiles.length, 1);
  const activeReceiptFiles = (await fsPromises.readdir(receiptsDir)).filter(f => f.endsWith('.json'));
  assert.equal(activeReceiptFiles.length, 0, 'Consumed receipt must be removed from active receipts');

  // 5. Practice
  const practiceRes = runCli(['practice', '--target', targetFile, '--failure', 'Timeout in network test', '--probe', 'node -v']);
  assert.equal(practiceRes.status, 0, `practice command failed: ${practiceRes.stderr}`);
  assert.match(practiceRes.stdout, /Phase 2 Deliberate Practice Plan/);

  // 6. Regression replay (in non-git tempDir -> workspace_snapshot: skipped_non_git)
  const regRes = runCli(['regression']);
  assert.equal(regRes.status, 0, `regression command failed: ${regRes.stderr}`);
  assert.match(regRes.stdout, /Total Probes:\s*1/);
  assert.match(regRes.stdout, /Passed:\s*1/);
  assert.match(regRes.stdout, /Workspace Snapshot:\s*skipped_non_git/);
  assert.match(regRes.stdout, /\[PASS\] standalone-cli-node-verification-rule: node -v \(exit=0, \d+ms\)/);
});

test('Security DoD: Stale receipt (target mismatch & expired >24h) and duplicate consumption rejected', async (t) => {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'dsh-rsi-sec-'));
  t.after(async () => {
    try { await fsPromises.rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  const cliPath = path.join(rootDir, 'skills', 'rsi', 'scripts', 'rsi-cli.mjs');
  const runCli = (args) => spawnSync('node', [cliPath, ...args], { cwd: tempDir, encoding: 'utf-8' });

  // A. Generate a receipt bound to targetA
  const v1 = runCli(['verify', '--target', 'targetA.js', '--probe', 'node -v']);
  assert.equal(v1.status, 0);

  // B. Attempt distill with targetB (target mismatch) -> MUST BE REJECTED
  const dMismatch = runCli([
    'distill',
    '--target', 'targetB.js',
    '--title', 'Forged Target Rule',
    '--rule', 'Some unverified rule',
    '--evidence', 'Fake evidence'
  ]);
  assert.notEqual(dMismatch.status, 0, 'Distill with mismatched target must fail');
  assert.match(dMismatch.stderr, /target mismatch/i);

  // Active receipt must still exist in .rsi/receipts/ (retained for correct target retry)
  const receiptsDir = path.join(tempDir, '.rsi', 'receipts');
  const activeBefore = (await fsPromises.readdir(receiptsDir)).filter(f => f.endsWith('.json'));
  assert.equal(activeBefore.length, 1);

  // C. Now distill with matching targetA.js -> MUST SUCCEED
  const dMatch = runCli([
    'distill',
    '--target', 'targetA.js',
    '--title', 'Legitimate TargetA Rule',
    '--rule', 'Verified rule for A',
    '--evidence', 'Valid evidence'
  ]);
  assert.equal(dMatch.status, 0);
  assert.match(dMatch.stdout, /✅ Distilled and committed/);

  // D. Duplicate consumption test -> Attempting distill again without new verify MUST BE REJECTED
  const dDuplicate = runCli([
    'distill',
    '--target', 'targetA.js',
    '--title', 'Duplicate Consumption Attempt',
    '--rule', 'Should fail',
    '--evidence', 'None'
  ]);
  assert.notEqual(dDuplicate.status, 0, 'Duplicate consumption of consumed receipt must fail');
  assert.match(dDuplicate.stderr, /already been consumed|no cached verification receipt found/i);

  // E. Expired receipt test (>24h)
  // Issue fresh receipt for targetExp.js
  const vExp = runCli(['verify', '--target', 'targetExp.js', '--probe', 'node -v']);
  assert.equal(vExp.status, 0);

  const lastReceiptId = (await fsPromises.readFile(path.join(tempDir, '.rsi', '.last_receipt'), 'utf-8')).trim();
  const expReceiptFile = path.join(receiptsDir, `${lastReceiptId}.json`);
  const receiptObj = JSON.parse(await fsPromises.readFile(expReceiptFile, 'utf-8'));

  // Tamper timestamp in body to 25 hours ago
  const [b64Body, sig] = receiptObj.receipt.split('.');
  const payload = JSON.parse(Buffer.from(b64Body, 'base64url').toString('utf8'));
  payload.t = Date.now() - (25 * 3600 * 1000); // 25 hours ago

  // If signature fails or expiration fails, it must reject!
  // Re-encode body with expired timestamp:
  receiptObj.receipt = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
  receiptObj.created_at = payload.t;
  await fsPromises.writeFile(expReceiptFile, JSON.stringify(receiptObj, null, 2), 'utf-8');

  const dExpired = runCli([
    'distill',
    '--target', 'targetExp.js',
    '--title', 'Expired Receipt Rule',
    '--rule', 'Should not pass',
    '--evidence', 'None'
  ]);
  assert.notEqual(dExpired.status, 0, 'Distill with expired receipt must fail');
});

test('Sandbox & EPIPE resilience: workspace-only write sandbox (read-only globalDir) and broken pipe (head -n 5)', async (t) => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'dsh-rsi-sandbox-'));
  const fakeHome = path.join(tempRoot, 'home');
  const globalMemDir = path.join(fakeHome, '.dsh', 'storages', 'rsi', 'memory');
  const workspaceDir = path.join(tempRoot, 'workspace');
  await fsPromises.mkdir(globalMemDir, { recursive: true });
  await fsPromises.mkdir(workspaceDir, { recursive: true });

  // Pre-create .integrity-key so it is readable, then lock down globalMemDir to 0o500 (read+execute only, no write).
  // This reproduces a workspace-write sandbox where globalDir already exists (mkdir recursive succeeds)
  // but creating .rsi.lock inside globalDir fails with EACCES/EPERM.
  const keyFile = path.join(fakeHome, '.dsh', 'storages', 'rsi', '.integrity-key');
  await fsPromises.writeFile(keyFile, 'a'.repeat(64) + '\n', { mode: 0o600 });
  await fsPromises.chmod(globalMemDir, 0o500);

  t.after(async () => {
    try { await fsPromises.chmod(globalMemDir, 0o700); } catch {}
    try { await fsPromises.rm(tempRoot, { recursive: true, force: true }); } catch {}
  });

  const cliPath = path.join(rootDir, 'skills', 'rsi', 'scripts', 'rsi-cli.mjs');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const runCli = (args) => spawnSync('node', [cliPath, ...args], { cwd: workspaceDir, env, encoding: 'utf-8' });

  // 1. Verify + Distill in workspace-only sandbox must succeed without EPERM/EACCES on globalDir/.rsi.lock
  const vRes = runCli(['verify', '--target', 'sandboxTarget.js', '--probe', 'node -v']);
  assert.equal(vRes.status, 0, `verify failed in sandbox: ${vRes.stderr}`);

  const dRes = runCli([
    'distill',
    '--target', 'sandboxTarget.js',
    '--title', 'Sandbox Workspace Lock Rule',
    '--preconditions', 'Global memory dir is read-only under workspace-write sandbox',
    '--rule', 'Only lock and write to workspace memory scope',
    '--evidence', 'Distill exited 0 under 0500 globalDir'
  ]);
  assert.equal(dRes.status, 0, `distill failed in sandbox: ${dRes.stderr}`);
  assert.match(dRes.stdout, /✅ Distilled and committed/);

  // 2. EPIPE test: pipe CLI output to head -n 5 and verify no unhandled EPIPE error
  const pipeRes = spawnSync('/bin/sh', ['-c', `node "${cliPath}" context --task "sandbox" | head -n 5`], {
    cwd: workspaceDir,
    env,
    encoding: 'utf-8'
  });
  assert.equal(pipeRes.status, 0);
  assert.doesNotMatch(pipeRes.stderr, /EPIPE/);
});
