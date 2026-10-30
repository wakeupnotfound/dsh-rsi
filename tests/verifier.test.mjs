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
  // Expanded safety checks: plain rm, redirection, git checkout, sed -i, package install
  assert.equal(verifier.isProbeSafe('rm file.txt'), false);
  assert.equal(verifier.isProbeSafe('echo pwn > package.json'), false);
  assert.equal(verifier.isProbeSafe('git checkout -- .'), false);
  assert.equal(verifier.isProbeSafe('sed -i "s/a/b/" file.js'), false);
  assert.equal(verifier.isProbeSafe('npm install left-pad'), false);
  // Additional heuristic checks: inline interpreter writes, install, rsync, archive extraction
  assert.equal(verifier.isProbeSafe('node -e "require(\'fs\').writeFileSync(\'x.txt\',\'y\')"'), false);
  assert.equal(verifier.isProbeSafe('python3 -c "open(\'x.txt\',\'w\').write(\'y\')"'), false);
  assert.equal(verifier.isProbeSafe('install -m 755 a /usr/local/bin/a'), false);
  assert.equal(verifier.isProbeSafe('rsync -a src/ dest/'), false);
  assert.equal(verifier.isProbeSafe('tar -xzf pkg.tgz'), false);
  assert.equal(verifier.isProbeSafe('unzip archive.zip'), false);
  // Benign reads, inspects, and JS arrows stay allowed
  assert.equal(verifier.isProbeSafe('tar -tzf pkg.tgz'), true);
  assert.equal(verifier.isProbeSafe('python3 --version'), true);
  assert.equal(verifier.isProbeSafe('npm test 2>&1'), true);
  assert.equal(verifier.isProbeSafe('ls >/dev/null 2>&1'), true);
  assert.equal(verifier.isProbeSafe('node -e "[1].map(x => x)"'), true);
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

  // Punctuated/localized empty doubts ("None.", "无") stay PASS; conflicting verdicts become UNVERIFIED
  assert.equal(verifier.parseReport('DOUBTS: None.\nVERDICT: PASS').verdict, VERDICTS.PASS);
  assert.equal(verifier.parseReport('DOUBTS: 无\n\nVERDICT: PASS').verdict, VERDICTS.PASS);
  assert.equal(verifier.parseReport('VERDICT: PASS\nVERDICT: FAIL').verdict, VERDICTS.UNVERIFIED);

  // Missing DOUBTS section on PASS must downgrade to FAIL (E4: silence proves nothing)
  const missingDoubts = verifier.parseReport('VERDICT: PASS');
  assert.equal(missingDoubts.verdict, VERDICTS.FAIL);
  assert.ok(missingDoubts.reasons.some(r => r.includes('without mandatory DOUBTS section')));
});
