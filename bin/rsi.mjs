#!/usr/bin/env node

import { MemoryBank, VerifierRuntime, renderEpistemicSection, renderMemoryPreamble } from '../lib/core/index.js';

const [,, command, ...args] = process.argv;

async function main() {
  const bank = new MemoryBank({ workspaceDir: process.cwd() });
  await bank.init();

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
`);
      break;
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
