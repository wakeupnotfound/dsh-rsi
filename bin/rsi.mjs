#!/usr/bin/env node

import {
  MemoryBank,
  VerifierRuntime,
  ExplorationPlanner,
  PracticePlanner,
  renderEpistemicSection,
  renderMemoryPreamble
} from '../lib/core/index.js';

const [,, command, ...args] = process.argv;

async function main() {
  const bank = new MemoryBank({ workspaceDir: process.cwd() });

  switch (command) {
    case 'status': {
      const all = await bank.listAll();
      const treeSha = await bank.computeTreeSha256();
      console.log('=== RSIAgent DSH Memory Bank Status ===');
      console.log(`Global Memory Dir:    ${bank.globalDir}`);
      console.log(`Workspace Memory Dir: ${bank.workspaceDir || '(none)'}`);
      console.log(`Total Active Entries: ${all.length}`);
      console.log(`Tree SHA-256 Digest:  ${treeSha}`);
      break;
    }

    case 'list': {
      const all = await bank.listAll();
      console.log(`\n=== Durable Memory Entries (${all.length}) ===`);
      for (const entry of all) {
        console.log(`- [${entry.id}] (${entry.category || 'general'}) ${entry.title}`);
        if (entry.tags?.length) console.log(`  Tags: ${entry.tags.join(', ')}`);
        console.log(`  Scope: ${entry.scope} | Size: ${entry.size}B | Path: ${entry.filePath}`);
      }
      break;
    }

    case 'query': {
      const q = args.join(' ');
      const matches = await bank.search({ query: q });
      console.log(`\n=== Query Matches for "${q}" (${matches.length}) ===`);
      for (const m of matches) {
        console.log(`\n--- [${m.id}] ${m.title} ---`);
        console.log(m.content);
      }
      break;
    }

    case 'verify': {
      const objective = args.join(' ');
      if (!objective) {
        console.error('Usage: rsi verify "<task objective>"');
        process.exit(1);
      }
      const runtime = new VerifierRuntime();
      const prompt = runtime.buildVerifierPrompt(objective);
      console.log('=== Generated Double-Blind Verifier Prompt ===\n');
      console.log(prompt);
      break;
    }

    case 'explore': {
      // Emits a workflow request (meta/script/args) for the DSH workflow tool.
      const objective = args.join(' ') || undefined;
      const known = (await bank.listAll()).map(e => e.title);
      const request = new ExplorationPlanner().buildWorkflow({ repoPath: process.cwd(), objective, knownLessons: known });
      console.log(JSON.stringify(request, null, 2));
      break;
    }

    case 'practice': {
      const objective = args.join(' ');
      if (!objective) {
        console.error('Usage: rsi practice "<hard task objective>"');
        process.exit(1);
      }
      const request = new PracticePlanner().buildWorkflow({ objective, workdir: process.cwd() });
      console.log(JSON.stringify(request, null, 2));
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
RSIAgent (DSH) — Recursive Self-Improvement CLI Tool

Usage:
  rsi status              Show memory bank directory, entry count, and tree hash
  rsi list                List all active memory entries
  rsi query <text>        Search memory bank for procedures and pitfalls
  rsi verify <objective>  Generate independent verifier audit prompt
  rsi prompt              Inspect injected Epistemic Core and memory inventory
  rsi explore [objective] Emit the Phase 1 broad-exploration workflow request (JSON)
  rsi practice <task>     Emit the Phase 2 FAIL->Distill->Practice->Retry workflow request (JSON)
`);
      break;
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
