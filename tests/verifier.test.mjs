import test from 'node:test';
import assert from 'node:assert/strict';
import { VerifierRuntime, VERDICTS } from '../lib/core/verifier.js';

test('VerifierRuntime probe safety checks', () => {
  const verifier = new VerifierRuntime();

  assert.equal(verifier.isProbeSafe('cat package.json'), true);
  assert.equal(verifier.isProbeSafe('git status --porcelain'), true);
  assert.equal(verifier.isProbeSafe('npm test -- --reporter=tap'), true);

  // Destructive commands must be blocked (POSIX + Windows)
  assert.equal(verifier.isProbeSafe('rm -rf ./dist'), false);
  assert.equal(verifier.isProbeSafe('git reset --hard HEAD~1'), false);
  assert.equal(verifier.isProbeSafe('git clean -fd'), false);
  assert.equal(verifier.isProbeSafe('rmdir /s /q C:\\temp'), false);
  assert.equal(verifier.isProbeSafe('del /f /q *.*'), false);
  assert.equal(verifier.isProbeSafe('Remove-Item -Recurse -Force ./build'), false);
});

test('VerifierRuntime runProbe execution', async () => {
  const verifier = new VerifierRuntime();

  // Safe probe execution
  const res = await verifier.runProbe('echo "verifier_probe_ok"');
  assert.equal(res.exitCode, 0);
  assert.match(res.stdout, /verifier_probe_ok/);
  assert.equal(res.blocked, false);

  // Destructive probe rejection
  const blockedRes = await verifier.runProbe('rm -rf /tmp/fake_dir');
  assert.equal(blockedRes.blocked, true);
  assert.equal(blockedRes.exitCode, 1);
  assert.match(blockedRes.stderr, /PROBE_REJECTED/);
});

test('VerifierRuntime parseReport handling and doubt enforcement', () => {
  const verifier = new VerifierRuntime();

  // Clean PASS
  const cleanPass = `
# Audit Report
Everything matches specifications.
DOUBTS: None
VERDICT: PASS
`;
  const resPass = verifier.parseReport(cleanPass);
  assert.equal(resPass.verdict, VERDICTS.PASS);
  assert.equal(resPass.isPass, true);

  // PASS with unevidenced doubts must downgrade to FAIL
  const doubtfulPass = `
# Audit Report
File was exported, but I could not confirm whether dimension tolerances were met.
DOUBTS: Dimension tolerances are uncertain and could violate tolerance threshold.
VERDICT: PASS
`;
  const resDowngrade = verifier.parseReport(doubtfulPass);
  assert.equal(resDowngrade.verdict, VERDICTS.FAIL);
  assert.equal(resDowngrade.isPass, false);

  // Clean FAIL
  const cleanFail = `
# Audit Report
Unit test suite failed with 2 errors.
VERDICT: FAIL
`;
  const resFail = verifier.parseReport(cleanFail);
  assert.equal(resFail.verdict, VERDICTS.FAIL);
  assert.equal(resFail.isFail, true);
});
