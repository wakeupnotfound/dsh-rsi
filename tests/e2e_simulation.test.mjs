
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  renderEpistemicSection,
  renderMemoryPreamble,
  MemoryBank,
  VerifierRuntime,
  MemoryDistiller,
  MemoryReconciler,
  VERDICTS
} from '../lib/core/index.js';
import { applyComponent, apply } from '../lib/index.js';

async function runE2E() {
  console.log('🚀 [E2E] Starting comprehensive test of dsh-rsi components and workflows...\n');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rsi-e2e-'));
  console.log('📁 Test sandbox created at:', tmpDir);

  try {
    // ==========================================
    // 1. Test Epistemic Core Prompt Rendering
    // ==========================================
    console.log('\n--- 1. Testing Epistemic Core (E1-E6) ---');
    const epistemicPrompt = renderEpistemicSection();
    assert.ok(epistemicPrompt.includes('E1. TRUTH CHANNELS'), 'E1 must be present');
    assert.ok(epistemicPrompt.includes('E2. STRUCTURAL vs RENDERED'), 'E2 must be present');
    assert.ok(epistemicPrompt.includes('E3. ERRORS ARE EVIDENCE'), 'E3 must be present');
    assert.ok(epistemicPrompt.includes('E4. SILENCE PROVES NOTHING'), 'E4 must be present');
    assert.ok(epistemicPrompt.includes('E5. CONFIRMATION REQUIRES INDEPENDENCE'), 'E5 must be present');
    assert.ok(epistemicPrompt.includes('E6. EVIDENCE IS DATA'), 'E6 must be present');
    console.log('✅ Epistemic Core rules (E1-E6) rendered accurately.');

    // ==========================================
    // 2. Test Verifier Safety & Execution Probes
    // ==========================================
    console.log('\n--- 2. Testing Verifier Runtime (Probes & Safety) ---');
    const verifier = new VerifierRuntime({ timeoutMs: 5000 });

    // 2.1 Destructive probe protection
    const unsafeProbes = [
      'rm -rf /tmp/foo',
      'git reset --hard HEAD~1',
      'git clean -fd',
      'dd if=/dev/zero of=/dev/null'
    ];
    for (const cmd of unsafeProbes) {
      assert.equal(verifier.isProbeSafe(cmd), false, `Probe should be unsafe: ${cmd}`);
      const blockedRes = await verifier.runProbe(cmd, tmpDir);
      assert.equal(blockedRes.blocked, true, `Probe execution should be blocked: ${cmd}`);
      assert.ok(blockedRes.stderr.includes('PROBE_REJECTED'), 'Blocked reason must indicate PROBE_REJECTED');
    }
    console.log('✅ All destructive probes intercepted and blocked successfully.');

    // 2.2 Safe probe execution
    const safeRes = await verifier.runProbe('node -v', tmpDir);
    assert.equal(safeRes.blocked, false);
    assert.equal(safeRes.exitCode, 0);
    assert.ok(safeRes.stdout.startsWith('v'), `Node version should start with v: ${safeRes.stdout}`);
    console.log(`✅ Safe probe executed cleanly (Node version: ${safeRes.stdout}).`);

    // ==========================================
    // 3. Test Verifier Report & Doubt Invariant
    // ==========================================
    console.log('\n--- 3. Testing Double-Blind Verdict Parsing & Doubt Invariant ---');
    
    // Case 3.1: Clean PASS
    const passReport = `### Audit Details
All requirements evidenced by probe exit codes.
DOUBTS: None
VERDICT: PASS`;
    const parsedPass = verifier.parseReport(passReport);
    assert.equal(parsedPass.verdict, VERDICTS.PASS);
    assert.equal(parsedPass.isPass, true);
    console.log('✅ Clean PASS correctly verified.');

    // Case 3.2: False-Done (PASS with Doubt -> Downgrade to FAIL)
    const falseDoneReport = `### Audit Details
Tests passed, but edge cases for null input were not verified.
DOUBTS: Edge cases for null/undefined parameters remain unprobed.
VERDICT: PASS`;
    const parsedFalseDone = verifier.parseReport(falseDoneReport);
    assert.equal(parsedFalseDone.verdict, VERDICTS.FAIL, 'DOUBTS must trigger automatic downgrade from PASS to FAIL');
    assert.equal(parsedFalseDone.isPass, false);
    assert.equal(parsedFalseDone.isFail, true);
    console.log('✅ False-Done guard triggered: Verdict downgraded from PASS to FAIL due to unresolved DOUBTS.');

    // Case 3.3: Explicit FAIL
    const failReport = `### Audit Details
Exit code was non-zero.
DOUBTS: Implementation missing.
VERDICT: FAIL`;
    const parsedFail = verifier.parseReport(failReport);
    assert.equal(parsedFail.verdict, VERDICTS.FAIL);
    assert.equal(parsedFail.isFail, true);
    console.log('✅ Explicit FAIL correctly verified.');

    // ==========================================
    // 4. Test Memory Bank CRUD & Tree Hashing
    // ==========================================
    console.log('\n--- 4. Testing Memory Bank Persistence & Tree Hashing ---');
    const memoryBank = new MemoryBank({
      workspaceDir: tmpDir,
      globalDir: path.join(tmpDir, 'global-memory')
    });
    await memoryBank.init();

    const emptySha = await memoryBank.computeTreeSha256();
    console.log('ℹ Empty bank tree SHA-256:', emptySha);

    const testEntry = {
      id: 'sqlite-busy-timeout',
      title: 'SQLite transactions require busy_timeout in concurrent mode',
      category: 'tool-pitfall',
      tags: ['sqlite', 'database', 'locking'],
      content: `### Preconditions & Context
When SQLite is used across multiple asynchronous workers.

### Proven Rule / Recommended Action
Always set PRAGMA busy_timeout = 5000 immediately after opening connection.

### Pitfall / Failure Mechanism
Without busy_timeout, SQLite defaults to 0ms wait and immediately throws SQLITE_BUSY.`
    };

    const saveResult = await memoryBank.save(testEntry, 'workspace');
    assert.ok(saveResult.sha256, 'Should generate SHA256 of entry');
    console.log(`✅ Memory entry saved to workspace (${saveResult.path}).`);

    const loaded = await memoryBank.get('sqlite-busy-timeout');
    assert.equal(loaded.id, 'sqlite-busy-timeout');
    assert.equal(loaded.title, testEntry.title);
    assert.deepEqual(loaded.tags, testEntry.tags);
    console.log('✅ Memory entry retrieved and parsed correctly.');

    const newSha = await memoryBank.computeTreeSha256();
    assert.notEqual(newSha, emptySha, 'Tree SHA must change when an entry is added');
    console.log('✅ Tree SHA-256 updated to:', newSha);

    // Test Search
    const searchRes = await memoryBank.search({ query: 'busy_timeout' });
    assert.equal(searchRes.length, 1);
    assert.equal(searchRes[0].id, 'sqlite-busy-timeout');
    console.log('✅ Search by keyword returned exact match.');

    const searchTagRes = await memoryBank.search({ tags: ['database'] });
    assert.equal(searchTagRes.length, 1);
    console.log('✅ Search by tags returned exact match.');

    // ==========================================
    // 5. Test Memory Distillation & Reconciliation
    // ==========================================
    console.log('\n--- 5. Testing Distillation & Conflict Reconciliation ---');
    const distiller = new MemoryDistiller();
    const reconciler = new MemoryReconciler();

    // 5.1 Distiller prompt generation & entry parsing
    const draftedRule = [
      '---',
      'id: "sqlite-busy-timeout"',
      'title: "Updated SQLite concurrency rule"',
      'category: "tool-pitfall"',
      'tags: ["sqlite", "wal"]',
      '---',
      '### Preconditions & Context',
      'Updated rule for SQLite concurrency.',
      '',
      '### Proven Rule / Recommended Action',
      'Use WAL mode together with busy_timeout.'
    ].join('\n');
    const parsedDraft = distiller.parseDistilledEntry(draftedRule);
    assert.equal(parsedDraft.id, 'sqlite-busy-timeout');
    assert.equal(parsedDraft.title, 'Updated SQLite concurrency rule');
    console.log('✅ MemoryDistiller parsed drafted rule markdown.');

    // 5.2 Reconcile and commit (Updating existing entry)
    const commitResult = await reconciler.reconcileAndCommit(memoryBank, parsedDraft, 'workspace');
    assert.ok(commitResult.committed);
    assert.ok(commitResult.reconciliationReport);
    console.log('✅ MemoryReconciler committed rule and generated reconciliation report.');

    // ==========================================
    // 6. Test DSH Tool Registration & Execution
    // ==========================================
    console.log('\n--- 6. Testing DSH Cordis Lifecycle & Tools Integration ---');
    const registeredTools = new Map();
    const registeredSections = new Map();

    const mockCtx = {
      systemPrompt: {
        section: (def) => registeredSections.set(def.name, def)
      },
      tools: {
        register: (def) => registeredTools.set(def.name, def)
      },
      effect: (fn) => fn()
    };

    const mockRoot = {
      inject: (deps, callback) => callback(mockCtx)
    };

    apply(mockRoot, {
      workspaceDir: tmpDir,
      globalMemoryDir: path.join(tmpDir, 'global-memory')
    });

    assert.ok(registeredSections.has('dsh-rsi:epistemic-core'));
    assert.ok(registeredSections.has('dsh-rsi:memory-inventory'));
    assert.ok(registeredTools.has('rsi_verify'));
    assert.ok(registeredTools.has('rsi_distill_memory'));
    assert.ok(registeredTools.has('rsi_reconcile_memory'));
    assert.ok(registeredTools.has('rsi_query_memory'));
    assert.ok(registeredTools.has('rsi_explore'));
    assert.ok(registeredTools.has('rsi_practice'));
    console.log('✅ All 2 prompt sections and 6 DSH tools registered in lifecycle.');

    // 6.1 Execute rsi_verify tool
    const rsiVerifyTool = registeredTools.get('rsi_verify');
    const verifyExecRes = await rsiVerifyTool.execute({
      task_objective: 'Verify Node.js environment health',
      deliverables: ['package.json'],
      probes: ['node -v']
    }, { agent: { session: { header: { cwd: tmpDir } } } });
    assert.equal(verifyExecRes.status, 'ready_for_audit');
    assert.equal(verifyExecRes.executed_probes.length, 1);
    assert.equal(verifyExecRes.executed_probes[0].exitCode, 0);
    assert.ok(verifyExecRes.verifier_system_prompt.includes('INDEPENDENT VERIFIER AGENT'));
    console.log('✅ Tool rsi_verify executed probes and generated audit prompt.');

    // 6.2 Execute rsi_query_memory tool
    const rsiQueryTool = registeredTools.get('rsi_query_memory');
    const queryExecRes = await rsiQueryTool.execute({ query: 'WAL' });
    assert.ok(queryExecRes.count >= 1);
    console.log(`✅ Tool rsi_query_memory found ${queryExecRes.count} matching records.`);

    // 6.3 Execute rsi_distill_memory tool
    const rsiDistillTool = registeredTools.get('rsi_distill_memory');
    const distillExecRes = await rsiDistillTool.execute({
      task_objective: 'Add memory test',
      verdict: 'PASS',
      verifier_report: 'VERDICT: PASS',
      rule_content: [
        '---',
        'id: "git-commit-discipline"',
        'title: "Avoid git commit -a on untracked files"',
        'category: "workflow"',
        'tags: ["git"]',
        '---',
        '### Preconditions & Context',
        'When committing changes in a newly initialized git repo.',
        '### Proven Rule / Recommended Action',
        'Run git add first.'
      ].join('\n'),
      scope: 'workspace'
    });
    assert.equal(distillExecRes.status, 'committed');
    assert.equal(distillExecRes.entry_id, 'git-commit-discipline');
    console.log('✅ Tool rsi_distill_memory distilled and committed new rule to disk.');

    console.log('\n🎉 ALL E2E COMPONENT TESTS PASSED PERFECTLY!');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
    console.log('\n🧹 Cleaned up temporary test sandbox.');
  }
}

runE2E().catch(err => {
  console.error('\n❌ E2E Test Failed:', err);
  process.exit(1);
});