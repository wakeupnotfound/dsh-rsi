/**
 * DSH Plugin Entry for RSIAgent (Recursive Self-Improvement Engine).
 * Mounts Epistemic Core prompts, Durable Memory Bank, and RSI tools into DeepSeek Harness.
 */

import {
  renderEpistemicSection,
  renderMemoryPreamble,
  MemoryBank,
  VerifierRuntime,
  MemoryDistiller,
  MemoryReconciler,
  VERDICTS
} from './core/index.js';
import { TOOL_DEFINITIONS } from './tools/definitions.js';

export const name = 'dsh-rsi';

/**
 * Main plugin installer for DeepSeek Harness / Cordis.
 * @param {object} root - Cordis context root
 * @param {object} [config] - Plugin configuration
 */
export function apply(root, config = {}) {
  const memoryBank = new MemoryBank({
    globalDir: config.globalMemoryDir,
    workspaceDir: config.workspaceDir || process.cwd()
  });

  const verifierRuntime = new VerifierRuntime({
    timeoutMs: config.probeTimeoutMs || 30000,
    maxProbes: config.maxProbes || 10
  });

  const distiller = new MemoryDistiller();
  const reconciler = new MemoryReconciler();

  // 1. Mount System Prompt Sections
  root.inject?.(['systemPrompt'], (ctx) => {
    // Epistemic Core (E1-E6)
    ctx.effect?.(() => {
      ctx.systemPrompt.section({
        name: 'dsh-rsi:epistemic-core',
        order: config.epistemicPromptOrder ?? 3100,
        interpolate: false,
        text: () => renderEpistemicSection()
      });
    }, 'dsh-rsi: epistemic-core prompt');

    // Memory Inventory & Causal Guidelines
    ctx.effect?.(() => {
      ctx.systemPrompt.section({
        name: 'dsh-rsi:memory-inventory',
        order: config.memoryPromptOrder ?? 3110,
        interpolate: false,
        text: async () => {
          try {
            const summary = await memoryBank.getInventorySummary();
            return renderMemoryPreamble(summary);
          } catch (err) {
            return renderMemoryPreamble([]);
          }
        }
      });
    }, 'dsh-rsi: memory-inventory prompt');
  });

  // 2. Mount Tools
  root.inject?.(['tools'], (ctx) => {
    // Tool: rsi_verify
    ctx.tools?.register?.({
      ...TOOL_DEFINITIONS.find(t => t.name === 'rsi_verify'),
      execute: async (args, execContext) => {
        const { task_objective, deliverables, probes = [] } = args;
        const workdir = execContext?.agent?.session?.header?.cwd || process.cwd();

        const probeResults = [];
        for (const probeCmd of probes) {
          const res = await verifierRuntime.runProbe(probeCmd, workdir);
          probeResults.push(res);
        }

        const prompt = verifierRuntime.buildVerifierPrompt(task_objective, {
          deliverables,
          probes: probeResults
        });

        // If the execution environment has subagent capabilities, caller or agent can run this
        return {
          status: 'ready_for_audit',
          verifier_system_prompt: prompt,
          executed_probes: probeResults,
          instructions: 'Use the above verifier prompt in an independent subagent or evaluate the probe evidence to issue VERDICT: PASS | FAIL | UNVERIFIED.'
        };
      }
    });

    // Tool: rsi_distill_memory
    ctx.tools?.register?.({
      ...TOOL_DEFINITIONS.find(t => t.name === 'rsi_distill_memory'),
      execute: async (args) => {
        const {
          task_objective,
          verdict,
          verifier_report,
          trajectory_summary,
          rule_content,
          scope = 'workspace'
        } = args;

        let entry;
        if (rule_content) {
          entry = distiller.parseDistilledEntry(rule_content);
        } else {
          const distillationPrompt = distiller.buildDistillationPrompt({
            taskObjective: task_objective,
            verdict,
            verifierReport: verifier_report,
            trajectorySummary: trajectory_summary
          });

          return {
            status: 'prompt_generated',
            distillation_prompt: distillationPrompt,
            instructions: 'Reflect using the distillation_prompt, formulate causal rules, and submit via rsi_distill_memory with rule_content.'
          };
        }

        if (!entry) {
          return { status: 'error', message: 'Failed to parse rule_content into valid memory entry.' };
        }

        const result = await reconciler.reconcileAndCommit(memoryBank, entry, scope);
        return {
          status: 'committed',
          entry_id: entry.id,
          saved_path: result.committed.path,
          reconciliation: result.reconciliationReport
        };
      }
    });

    // Tool: rsi_reconcile_memory
    ctx.tools?.register?.({
      ...TOOL_DEFINITIONS.find(t => t.name === 'rsi_reconcile_memory'),
      execute: async (args) => {
        const { entry_id } = args;
        const allEntries = await memoryBank.listAll();

        if (entry_id) {
          const target = await memoryBank.get(entry_id);
          if (!target) return { status: 'not_found', entry_id };
          const others = allEntries.filter(e => e.id !== entry_id);
          const analysis = reconciler.analyzeConsistency(others, target);
          return { status: 'analyzed', entry_id, analysis };
        }

        return {
          status: 'corpus_inspected',
          total_entries: allEntries.length,
          entries: allEntries.map(e => ({ id: e.id, title: e.title, category: e.category, tags: e.tags }))
        };
      }
    });

    // Tool: rsi_query_memory
    ctx.tools?.register?.({
      ...TOOL_DEFINITIONS.find(t => t.name === 'rsi_query_memory'),
      execute: async (args) => {
        const { query, tags, category } = args;
        const matches = await memoryBank.search({ query, tags, category });
        return {
          count: matches.length,
          matches: matches.map(m => ({
            id: m.id,
            title: m.title,
            category: m.category,
            tags: m.tags,
            content: m.content
          }))
        };
      }
    });
  });

  return {
    memoryBank,
    verifierRuntime,
    distiller,
    reconciler
  };
}

export default { name, apply };
