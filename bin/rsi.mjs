#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  MemoryBank,
  VerifierRuntime,
  ExplorationPlanner,
  PracticePlanner,
  MemoryReconciler,
  slugify,
  renderEpistemicSection,
  renderMemoryPreamble,
  extractMemoryFields,
  Keyring,
  createReceipt,
  verifyReceipt,
  saveCachedReceipt,
  loadCachedReceipt,
  consumeCachedReceipt,
  gcReceipts,
  loadRegressionProbes,
  sanitizeGuidanceMarkers,
  renderCliGuidance
} from '../lib/core/index.js';

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[arg.slice(2)] = args[i + 1];
        i++;
      } else {
        flags[arg.slice(2)] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.('error', (err) => {
    if (err?.code === 'EPIPE') process.exit(0);
  });
}

const [,, command, ...rawArgs] = process.argv;
const { flags, positional } = parseArgs(rawArgs);

async function main() {
  const bank = new MemoryBank({ workspaceDir: process.cwd() });
  const keyring = bank.keyring;

  switch (command) {
    case 'status': {
      if (flags.gc) {
        const cleaned = await gcReceipts(process.cwd());
        console.log(`✅ Cleaned ${cleaned} expired receipts (>24h).`);
        break;
      }

      if (flags.migrate) {
        const res = await bank.migrate();
        console.log(`✅ Migrated ${res.migratedCount} memory entries to v0.3 schema.`);
        break;
      }

      const all = await bank.listAll();
      const treeSha = await bank.computeTreeSha256();
      let activeReceipts = 0;
      try {
        const rFiles = fs.readdirSync(path.join(process.cwd(), '.rsi', 'receipts'));
        activeReceipts = rFiles.filter(f => f.endsWith('.json')).length;
      } catch {}
      const probes = await loadRegressionProbes(process.cwd());

      console.log('=== RSIAgent DSH Memory Bank Status ===');
      console.log(`Global Memory Dir:    ${bank.globalDir}`);
      console.log(`Workspace Memory Dir: ${bank.workspaceDir || '(none)'}`);
      console.log(`Total Active Entries: ${all.length}`);
      console.log(`Tree SHA-256 Digest:  ${treeSha}`);
      console.log(`Cached Receipts:      ${activeReceipts}`);
      console.log(`Regression Probes:    ${probes.length}`);
      break;
    }

    case 'list': {
      const all = await bank.listAll();
      console.log(`\n=== Durable Memory Entries (${all.length}) ===`);
      for (const entry of all) {
        const trustBadge = entry.trusted ? 'trusted' : '⚠️ UNTRUSTED (unsigned)';
        console.log(sanitizeGuidanceMarkers(`- [${entry.id}] (${entry.category || 'general'}) ${entry.title}`));
        if (entry.tags?.length) console.log(sanitizeGuidanceMarkers(`  Tags: ${entry.tags.join(', ')}`));
        console.log(`  Scope: ${entry.scope} | Trust: ${trustBadge} | Confidence: ${entry.confidence || 'VERIFIED'} | Status: ${entry.status || 'ACTIVE'} | Size: ${entry.size}B | Path: ${entry.filePath}`);
      }
      break;
    }

    case 'trust': {
      const id = positional[0] || flags.id;
      if (!id) {
        console.error('Usage: rsi trust <entry-id>');
        process.exit(1);
      }
      const res = await bank.trust(id);
      if (!res) {
        console.error(`Entry "${id}" not found.`);
        process.exit(1);
      }
      console.log(`✅ Trusted and signed entry [${id}] at ${res.path}`);
      break;
    }

    case 'context': {
      const taskQuery = flags.task || positional.join(' ') || '';
      const topK = parseInt(flags['top-k'] || flags.topK || 5, 10);

      console.log('=== Epistemic Core Principles ===\n');
      console.log(renderEpistemicSection());
      console.log('\n=== Dynamic Top-K Memory Recall ===\n');
      if (!taskQuery) {
        console.log('No task specified for context recall (use: rsi context --task "<objective>").');
      } else {
        const matches = await bank.search({ query: taskQuery, topK });
        if (matches.length === 0) {
          console.log(sanitizeGuidanceMarkers(`No prior verified lessons matching "${taskQuery}".`));
        } else {
          console.log(sanitizeGuidanceMarkers(`Top ${matches.length} relevant memories for: "${taskQuery}":\n`));
          for (const m of matches) {
            const fields = extractMemoryFields(m);
            console.log(sanitizeGuidanceMarkers(`- [${m.id}] ${m.title} (score: ${m._score ? m._score.toFixed(3) : 'N/A'}, confidence: ${m.confidence || 'VERIFIED'})`));
            if (fields.preconditions) console.log(sanitizeGuidanceMarkers(`  Preconditions: ${fields.preconditions}`));
            if (fields.provenRule) console.log(sanitizeGuidanceMarkers(`  Proven Rule:   ${fields.provenRule}`));
            if (m.tags?.length) console.log(sanitizeGuidanceMarkers(`  Tags:          ${m.tags.join(', ')}`));
            console.log('');
          }
        }
      }
      console.log('\n' + renderCliGuidance({ step: 'context' }));
      break;
    }

    case 'query': {
      const q = positional.join(' ') || flags.query || '';
      const tags = flags.tags ? String(flags.tags).split(',').map(s => s.trim()) : [];
      const topK = flags['top-k'] || flags.topK ? parseInt(flags['top-k'] || flags.topK, 10) : undefined;
      const matches = await bank.search({ query: q, tags, topK });
      console.log(sanitizeGuidanceMarkers(`\n=== Query Matches for "${q}" (${matches.length}) ===`));
      for (const m of matches) {
        console.log(sanitizeGuidanceMarkers(`\n--- [${m.id}] ${m.title} (score: ${m._score ? m._score.toFixed(3) : 'N/A'}, confidence: ${m.confidence || 'VERIFIED'}) ---`));
        console.log(sanitizeGuidanceMarkers(m.content));
      }
      console.log('\n' + renderCliGuidance({ step: 'query' }));
      break;
    }

    case 'verify': {
      const target = flags.target;
      const probe = flags.probe;
      const memoryIds = flags['memory-ids'] || flags.memoryIds;
      const sandbox = flags.sandbox || 'host';

      if (target && probe) {
        const runtime = new VerifierRuntime({ sandbox });
        const probeRes = await runtime.runProbe(probe, process.cwd(), { sandbox });

        let reportText;
        const isPass = probeRes.exitCode === 0 && !probeRes.blocked;
        if (isPass) {
          reportText = [
            'FINDINGS: Read-only probe executed successfully.',
            `COMMAND: ${probe}`,
            `EXIT_CODE: ${probeRes.exitCode}`,
            `WORKSPACE_SNAPSHOT: ${probeRes.workspace_snapshot}`,
            probeRes.stdout ? `STDOUT:\n${probeRes.stdout}` : '',
            'DOUBTS: None',
            'VERDICT: PASS'
          ].filter(Boolean).join('\n');
        } else {
          reportText = [
            'FINDINGS: Read-only probe failed or was blocked.',
            `COMMAND: ${probe}`,
            `EXIT_CODE: ${probeRes.exitCode}`,
            `WORKSPACE_SNAPSHOT: ${probeRes.workspace_snapshot}`,
            probeRes.stderr ? `STDERR:\n${probeRes.stderr}` : '',
            'DOUBTS: Probe failure observed',
            'VERDICT: FAIL'
          ].filter(Boolean).join('\n');
        }

        const parsed = runtime.parseReport(reportText);
        const receiptId = `rcpt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const receipt = createReceipt(keyring, {
          verdict: parsed.verdict,
          report: reportText,
          target,
          receiptId,
          workspaceSnapshot: probeRes.workspace_snapshot,
          workspacePolluted: probeRes.workspace_polluted
        });

        await saveCachedReceipt(process.cwd(), {
          receipt,
          target,
          probe,
          verdict: parsed.verdict,
          report: reportText,
          receiptId,
          workspace_snapshot: probeRes.workspace_snapshot,
          workspace_polluted: probeRes.workspace_polluted
        });

        if (memoryIds) {
          await bank.recordAdoption(memoryIds, { isPass: parsed.isPass });
        }

        console.log('=== Verifier Execution Output ===\n');
        console.log(sanitizeGuidanceMarkers(`Target:             ${target}`));
        console.log(sanitizeGuidanceMarkers(`Probe:              ${probe}`));
        console.log(`Exit Code:          ${probeRes.exitCode}`);
        console.log(`Verdict:            ${parsed.verdict}`);
        console.log(sanitizeGuidanceMarkers(`Doubts:             ${parsed.doubts}`));
        console.log(`Workspace Snapshot: ${probeRes.workspace_snapshot}`);
        if (probeRes.workspace_polluted) {
          console.log(`Workspace Polluted: true`);
        }
        console.log(`Receipt:            ${receiptId}\n`);
        console.log(sanitizeGuidanceMarkers(receipt));
        console.log('\n' + renderCliGuidance({ step: 'verify', receiptId, verdict: parsed.verdict }));
        break;
      }

      const objective = positional.join(' ');
      if (!objective) {
        console.error('Usage: rsi verify --target "<file>" --probe "<command>" [--memory-ids "<ids>"] [--sandbox host|docker]');
        console.error('   or: rsi verify "<task objective>"');
        process.exit(1);
      }
      const runtime = new VerifierRuntime();
      const prompt = runtime.buildVerifierPrompt(objective);
      console.log('=== Generated Double-Blind Verifier Prompt ===\n');
      console.log(sanitizeGuidanceMarkers(prompt));
      break;
    }

    case 'distill': {
      const target = flags.target;
      const title = flags.title;
      const preconditions = flags.preconditions;
      const rule = flags.rule;
      const evidence = flags.evidence;
      const failure = flags.failure;
      const category = flags.category || 'workflow';
      const tags = flags.tags ? String(flags.tags).split(',').map(s => s.trim()) : ['distilled'];
      const receiptId = flags.receipt;

      if (!target || !title || !rule) {
        console.error('Error: distill requires --target, --title, and --rule.');
        console.error('Usage: rsi distill --target "<target>" --title "<title>" --preconditions "<pre>" --rule "<rule>" --evidence "<ev>" [--receipt <id>]');
        process.exit(1);
      }

      const receiptRecord = await loadCachedReceipt(process.cwd(), receiptId);
      if (!receiptRecord) {
        console.error('Error: No cached verification receipt found. You must run "rsi verify" first.');
        process.exit(1);
      }
      if (receiptRecord.consumed) {
        console.error(`Error: Verification receipt [${receiptRecord.receiptId}] has already been consumed. Run "rsi verify" to issue a fresh receipt.`);
        process.exit(1);
      }

      const check = verifyReceipt(keyring, receiptRecord.data.receipt, {
        target,
        report: receiptRecord.data.report
      });

      if (!check.valid) {
        console.error(`Error: Verification receipt validation failed: ${check.reason}`);
        process.exit(1);
      }

      const verifyCommand = flags['verify-command'] || flags.verifyCommand || flags.probe || receiptRecord.data.probe || '';

      const contentParts = [
        '### Preconditions & Context',
        preconditions || 'N/A',
        '',
        '### Proven Rule / Recommended Action',
        rule,
        '',
        '### Pitfall / Failure Mechanism',
        failure || 'N/A',
        '',
        '### Evidence',
        evidence || 'Verified through double-blind probe'
      ];
      if (verifyCommand) {
        contentParts.push('', '### Re-check Command', `\`${verifyCommand}\``);
      }
      const content = contentParts.join('\n');

      const isPass = check.verdict === 'PASS';
      const newEntry = {
        id: slugify(title),
        title,
        category,
        tags,
        verified: isPass,
        confidence: isPass ? 'VERIFIED' : 'OBSERVED',
        status: 'ACTIVE',
        last_validated_at: new Date().toISOString(),
        target,
        verifyCommand,
        content: content.trim()
      };

      const reconciler = new MemoryReconciler();
      const res = await reconciler.reconcileAndCommit(bank, newEntry, 'workspace');
      await consumeCachedReceipt(process.cwd(), receiptRecord.receiptId);

      console.log(`✅ Distilled and committed memory entry [${newEntry.id}]`);
      console.log(`Path: ${res.committed.path}`);
      if (res.synthesizedProbe) {
        console.log(`Synthesized Probe: ${res.synthesizedProbe.probePath}`);
      }
      console.log(`Receipt [${receiptRecord.receiptId}] consumed and archived.`);
      console.log('\n' + renderCliGuidance({ step: 'distill', receiptId: receiptRecord.receiptId }));
      break;
    }

    case 'regression': {
      const sandbox = flags.sandbox || 'host';
      const runtime = new VerifierRuntime({ sandbox });
      const report = await runtime.runRegression(process.cwd(), { sandbox });

      console.log('=== RSIAgent Regression Probe Suite ===\n');
      console.log(`Total Probes:       ${report.total}`);
      console.log(`Passed:             ${report.passed}`);
      console.log(`Failed:             ${report.failed}`);
      console.log(`Blocked (Policy):   ${report.blocked}`);
      console.log(`Timed Out:          ${report.timedOut}`);
      console.log(`Workspace Snapshot: ${report.workspace_snapshot}`);
      console.log(`Workspace Polluted: ${report.workspace_polluted}\n`);

      if (report.results.length === 0) {
        console.log('No regression probes found in .rsi/probes/.');
      } else {
        for (const r of report.results) {
          const badge = r.passed ? 'PASS' : (r.blocked ? 'BLOCKED' : (r.timedOut ? 'TIMEOUT' : 'FAIL'));
          const exitCode = r.exitCode ?? r.actualExitCode;
          console.log(sanitizeGuidanceMarkers(`- [${badge}] ${r.memoryId}: ${r.probeCommand || '(invalid)'} (exit=${exitCode}, ${r.durationMs ?? 0}ms)`));
          if (!r.passed && r.stderr) {
            console.log(sanitizeGuidanceMarkers(`  Reason: ${r.stderr.trim().split('\n')[0]}`));
          }
        }
      }

      console.log('\n' + renderCliGuidance({ step: 'regression' }));
      if (!report.allPassed) {
        process.exit(1);
      }
      break;
    }

    case 'explore': {
      const objective = flags.goal || positional.join(' ') || undefined;
      const known = (await bank.listAll()).map(e => e.title);
      const request = new ExplorationPlanner().buildWorkflow({ repoPath: process.cwd(), objective, knownLessons: known });
      console.log(JSON.stringify(request, null, 2));
      break;
    }

    case 'practice': {
      const target = flags.target;
      const failure = flags.failure;
      const probe = flags.probe;

      if (target || failure || probe) {
        console.log('=== RSIAgent Phase 2 Deliberate Practice Plan ===\n');
        console.log(sanitizeGuidanceMarkers(`Target:  ${target || '(current workspace)'}`));
        console.log(sanitizeGuidanceMarkers(`Failure: ${failure || 'Unspecified failure'}`));
        console.log(sanitizeGuidanceMarkers(`Probe:   ${probe || 'N/A'}\n`));
        console.log('Execution State Machine:');
        console.log('1. [Diagnostic Analysis]: Isolate root cause from error evidence without editing.');
        console.log('2. [Targeted Fix]: Apply minimal structural fix.');
        console.log(sanitizeGuidanceMarkers(`3. [Falsification Probe]: Run probe: "${probe || 'npm test'}"`));
        console.log('4. [Distillation]: On PASS, run distill; on FAIL, iterate practice loop.');
        console.log('\n' + renderCliGuidance({ step: 'practice' }));
        break;
      }

      const objective = positional.join(' ');
      if (!objective) {
        console.error('Usage: rsi practice --target "<target>" --failure "<error>" --probe "<command>"');
        console.error('   or: rsi practice "<hard task objective>"');
        process.exit(1);
      }
      const request = new PracticePlanner().buildWorkflow({ objective, workdir: process.cwd() });
      console.log(JSON.stringify(request, null, 2));
      break;
    }

    case 'skill':
    case 'install-skill': {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const srcDir = path.resolve(__dirname, '..', 'skills', 'rsi');
      const targetDir = path.join(os.homedir(), '.agents', 'skills', 'rsi');
      if (flags.print || flags.p || positional[0] === '--print' || positional[0] === '-p') {
        const skillPath = path.join(srcDir, 'SKILL.md');
        if (fs.existsSync(skillPath)) {
          console.log(fs.readFileSync(skillPath, 'utf8'));
        } else {
          console.error('SKILL.md not found at ' + skillPath);
        }
        break;
      }
      try {
        fs.mkdirSync(path.dirname(targetDir), { recursive: true });
        fs.cpSync(srcDir, targetDir, { recursive: true });
        console.log(`✅ RSI Skill successfully installed to: ${targetDir}`);
      } catch (err) {
        console.error(`Failed to install skill to ${targetDir}: ${err.message}`);
        console.log(`Skill source available at: ${srcDir}`);
      }
      break;
    }

    case 'prompt': {
      console.log('=== Rendered Epistemic Core ===\n');
      console.log(renderEpistemicSection());
      console.log('\n=== Rendered Memory Preamble ===\n');
      const summary = await bank.getInventorySummary();
      console.log(renderMemoryPreamble(summary));
      break;
    }

    default: {
      console.log(`
RSIAgent (DSH) — Recursive Self-Improvement CLI Tool (v0.4.0)

Usage:
  rsi status [--gc] [--migrate]          Show bank status, run receipt GC or schema migration
  rsi list                               List all active memory entries
  rsi trust <id>                         Sign and trust an unsigned workspace memory entry
  rsi context --task "<objective>"       Display Epistemic Core and dynamic Top-K memory recall
  rsi query "<text>" [--tags a,b]        Search memory bank using BM25F ranking
  rsi verify --target "<file>" --probe "<cmd>" [--memory-ids "<ids>"] [--sandbox host|docker]
                                         Execute safe probe and issue cached verification receipt
  rsi distill --target "<file>" --title "<title>" --rule "<rule>" --evidence "<ev>"
                                         Distill causal lesson and synthesize regression probe
  rsi regression [--sandbox host|docker] Replay all synthesized regression probes in .rsi/probes/
  rsi explore [--goal "<objective>"]     Emit Phase 1 broad-exploration workflow request
  rsi practice [--target "<file>" --failure "<err>" --probe "<cmd>"]
                                         Emit Phase 2 deliberate practice workflow
  rsi skill [--print]                    Install or print the built-in RSI skill
  rsi prompt                             Inspect injected Epistemic Core and memory inventory
`);
      break;
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
