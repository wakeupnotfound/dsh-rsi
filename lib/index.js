/**
 * DSH Plugin Entry for RSIAgent (Recursive Self-Improvement Engine).
 * Mounts Epistemic Core prompts, Durable Memory Bank, RSI tools and the
 * Phase 1/2 exploration workflows into DeepSeek Harness.
 *
 * Host contracts honored here (see @deepseek-ai/dsh-tools / dsh-system-prompt):
 * - `ctx.tools.register()` requires `output: { schema, render }` and returns a disposer.
 * - Section `text(context)` is resolved synchronously; a Promise would be dropped.
 * - Every registration is wrapped in `ctx.effect` so disabling a component or
 *   hot-reloading the plugin withdraws it.
 * - Tool results must be lossless JSON matching the declared output schema.
 */

import {
  renderEpistemicSection,
  renderMemoryPreamble,
  MemoryBank,
  VerifierRuntime,
  isEmptyDoubts,
  MemoryDistiller,
  MemoryReconciler,
  ExplorationPlanner,
  PracticePlanner,
  lessonToEntry,
  tokenize,
  jaccard
} from './core/index.js';
import { TOOL_DEFINITIONS } from './tools/definitions.js';

export const name = 'dsh-rsi';

export const COMPONENTS = Object.freeze(['epistemic', 'verifier', 'memory', 'explorer']);

/** Read an optional Cordis service without failing when it is absent. */
function service(ctx, key) {
  try {
    return ctx?.get?.(key) ?? ctx?.[key];
  } catch {
    return undefined;
  }
}

/** Detach a value into lossless JSON (drops undefined, functions, prototypes). */
export function toJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function definition(toolName) {
  const def = TOOL_DEFINITIONS.find(t => t.name === toolName);
  if (!def) throw new Error(`dsh-rsi: unknown tool definition ${toolName}`);
  return def;
}

/**
 * Mount a specific component or all components.
 * @param {object} root - Cordis context root
 * @param {object} [config] - Plugin configuration
 * @param {'verifier'|'memory'|'epistemic'|'explorer'} [component]
 */
export function applyComponent(root, config = {}, component) {
  const banks = new Map();
  const bankFor = (workspaceDir) => {
    const key = workspaceDir || '';
    if (!banks.has(key)) {
      banks.set(key, new MemoryBank({ globalDir: config.globalMemoryDir, workspaceDir: workspaceDir || undefined }));
    }
    return banks.get(key);
  };

  const verifierRuntime = new VerifierRuntime({
    timeoutMs: config.probeTimeoutMs || 30000,
    maxProbes: config.maxProbes || 10
  });
  const distiller = new MemoryDistiller();
  const reconciler = new MemoryReconciler();
  const explorationPlanner = new ExplorationPlanner();
  const practicePlanner = new PracticePlanner();

  /** Session directory without I/O (used by synchronous prompt sections). */
  const sessionDirSync = (ctx, agent) => {
    if (config.workspaceDir) return config.workspaceDir;
    if (agent?.session) {
      try {
        const dir = service(ctx, 'workingDirectory')?.get?.(agent.session);
        if (dir) return dir;
      } catch {}
      if (agent.session.header?.cwd) return agent.session.header.cwd;
    }
    return process.cwd();
  };

  /** Session directory for a tool call, validated by the working-directory service when present. */
  const sessionDir = async (ctx, exec) => {
    if (config.workspaceDir) return config.workspaceDir;
    const agent = exec?.agent;
    if (agent) {
      const wd = service(ctx, 'workingDirectory');
      if (wd?.ensure) {
        try {
          return await wd.ensure(agent, exec.signal);
        } catch {}
      }
    }
    return sessionDirSync(ctx, agent);
  };

  const register = (ctx, def) => {
    if (!ctx?.tools?.register) return;
    const run = () => ctx.tools.register(def);
    if (typeof ctx.effect === 'function') ctx.effect(run, `dsh-rsi: ${def.name}`);
    else run();
  };

  /**
   * Resolve workflowEngine service respecting DSH's Cordis delegation group isolation.
   * DSH mounts presets under agent.ctx with isolate: { workflowEngine: true }.
   * agentPresets.serviceFor(agent, 'workflowEngine') queries the preset mount fiber directly.
   */
  const resolveWorkflowEngine = (ctx, exec) => {
    const agent = exec?.agent;
    if (agent) {
      const presets = service(agent.ctx, 'agentPresets') ?? service(ctx, 'agentPresets');
      const fromPreset = presets?.serviceFor?.(agent, 'workflowEngine');
      if (fromPreset) return fromPreset;
      const fromAgent = service(agent.ctx, 'workflowEngine');
      if (fromAgent) return fromAgent;
    }
    return service(ctx, 'workflowEngine');
  };

  /** Run a workflow request through ctx.workflowEngine; null when unavailable. */
  const runWorkflow = async (ctx, request, exec) => {
    const engine = resolveWorkflowEngine(ctx, exec);
    if (!engine?.start || !exec?.agent) return null;
    const run = engine.start({ ...request, parent: exec.agent, ...(exec.signal ? { signal: exec.signal } : {}) });
    const onAbort = () => run.cancel?.('parent step aborted');
    exec.signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      const result = await run.result;
      if (result.stopReason !== 'completed') {
        throw new Error(`workflow ${request.meta.name} ${result.stopReason}${result.error ? `: ${result.error}` : ''}`);
      }
      return { runId: run.id, agentsStarted: result.agentsStarted, value: result.value };
    } finally {
      exec.signal?.removeEventListener?.('abort', onAbort);
      await run.dispose?.();
    }
  };

  /** Commit lessons through reconciliation; returns a per-lesson report. */
  const commitLessons = async (bank, lessons, { source, scope, verifiedOf }) => {
    const committed = [];
    for (const lesson of lessons) {
      const entry = lessonToEntry(lesson, {
        source,
        extraTags: lesson.outcome ? [`outcome-${lesson.outcome}`] : []
      });
      if (verifiedOf) entry.verified = Boolean(verifiedOf(lesson));
      const result = await reconciler.reconcileAndCommit(bank, entry, scope);
      committed.push({
        id: entry.id,
        title: entry.title,
        verified: entry.verified,
        path: result.committed.path,
        conflicts_resolved: result.reconciliationReport.conflictsResolved
      });
    }
    return committed;
  };

  // ---------------------------------------------------------------- epistemic
  if (!component || component === 'epistemic') {
    root.inject?.(['systemPrompt'], (ctx) => {
      const section = (def, label) => {
        const run = () => ctx.systemPrompt.section(def);
        if (typeof ctx.effect === 'function') ctx.effect(run, label);
        else run();
      };

      section({
        name: 'dsh-rsi:epistemic-core',
        order: config.epistemicPromptOrder ?? 3100,
        interpolate: false,
        text: () => renderEpistemicSection()
      }, 'dsh-rsi: epistemic-core prompt');

      section({
        name: 'dsh-rsi:memory-inventory',
        order: config.memoryPromptOrder ?? 3110,
        interpolate: false,
        // Must stay synchronous: DSH resolves section text without awaiting it.
        text: (context) => {
          try {
            const bank = bankFor(sessionDirSync(ctx, context?.agent));
            return renderMemoryPreamble(bank.getInventorySummarySync());
          } catch {
            return renderMemoryPreamble([]);
          }
        }
      }, 'dsh-rsi: memory-inventory prompt');
    });
  }

  // ----------------------------------------------------------------- verifier
  if (!component || component === 'verifier') {
    root.inject?.(['tools'], (ctx) => {
      register(ctx, {
        ...definition('rsi_verify'),
        execute: async (args, exec) => {
          const { task_objective, deliverables, probes = [], report } = args || {};
          const workdir = await sessionDir(ctx, exec);
          const probeResults = await verifierRuntime.runProbes(probes, workdir, { signal: exec?.signal });
          const prompt = verifierRuntime.buildVerifierPrompt(task_objective, { deliverables, probes: probeResults });
          const parsed = typeof report === 'string' && report.trim() ? verifierRuntime.parseReport(report) : null;
          return toJson({
            status: parsed ? 'verdict_parsed' : 'ready_for_audit',
            workdir,
            executed_probes: probeResults,
            ...(parsed ? { verdict: parsed.verdict, doubts: parsed.doubts, reasons: parsed.reasons } : {}),
            verifier_system_prompt: prompt,
            instructions: parsed
              ? 'Verdict parsed with the doubt invariant applied. Distill the outcome with rsi_distill_memory.'
              : 'Give verifier_system_prompt to an independent subagent (no actor history), then pass its report back via the report argument to obtain a VERDICT: PASS | FAIL | UNVERIFIED.'
          });
        }
      });
    });
  }

  // ------------------------------------------------------------------- memory
  if (!component || component === 'memory') {
    root.inject?.(['tools'], (ctx) => {
      register(ctx, {
        ...definition('rsi_distill_memory'),
        execute: async (args, exec) => {
          const { task_objective, verdict, verifier_report, trajectory_summary, rule_content, scope = 'workspace' } = args || {};
          if (!rule_content) {
            return toJson({
              status: 'prompt_generated',
              distillation_prompt: distiller.buildDistillationPrompt({
                taskObjective: task_objective,
                verdict,
                verifierReport: verifier_report,
                trajectorySummary: trajectory_summary
              }),
              instructions: 'Reflect using the distillation_prompt, formulate causal rules, and submit via rsi_distill_memory with rule_content.'
            });
          }
          const entry = distiller.parseDistilledEntry(rule_content);
          if (!entry) return { status: 'error', message: 'Failed to parse rule_content into valid memory entry.' };
          entry.tags = Array.from(new Set([...(entry.tags || []), `verdict-${String(verdict || 'unknown').toLowerCase()}`]));
          entry.verified = verdict === 'PASS' || verdict === 'FAIL';
          const bank = bankFor(await sessionDir(ctx, exec));
          const result = await reconciler.reconcileAndCommit(bank, entry, scope);
          return toJson({
            status: 'committed',
            entry_id: entry.id,
            saved_path: result.committed.path,
            reconciliation: result.reconciliationReport
          });
        }
      });

      register(ctx, {
        ...definition('rsi_reconcile_memory'),
        execute: async (args, exec) => {
          const { entry_id } = args || {};
          const bank = bankFor(await sessionDir(ctx, exec));
          const allEntries = await bank.listAll();
          if (entry_id) {
            const target = await bank.get(entry_id);
            if (!target) return { status: 'not_found', entry_id };
            const analysis = reconciler.analyzeConsistency(allEntries.filter(e => e.id !== entry_id), target);
            return toJson({ status: 'analyzed', entry_id, analysis });
          }
          return toJson({
            status: 'corpus_inspected',
            total_entries: allEntries.length,
            entries: allEntries.map(e => ({ id: e.id, title: e.title, category: e.category, tags: e.tags, scope: e.scope }))
          });
        }
      });

      register(ctx, {
        ...definition('rsi_query_memory'),
        execute: async (args, exec) => {
          const { query, tags, category } = args || {};
          const bank = bankFor(await sessionDir(ctx, exec));
          const matches = await bank.search({ query, tags, category });
          return toJson({
            count: matches.length,
            matches: matches.map(m => ({ id: m.id, title: m.title, category: m.category, tags: m.tags, scope: m.scope, content: m.content }))
          });
        }
      });
    });
  }

  // ----------------------------------------------------------------- explorer
  if (!component || component === 'explorer') {
    root.inject?.(['tools'], (ctx) => {
      register(ctx, {
        ...definition('rsi_explore'),
        execute: async (args = {}, exec) => {
          const cwd = await sessionDir(ctx, exec);
          const bank = bankFor(cwd);
          const scope = args.scope || 'workspace';

          if (args.workflow_result) {
            const value = args.workflow_result;
            if (value.kind !== 'rsi-exploration' || !Array.isArray(value.lessons)) {
              throw new Error('workflow_result is not an rsi-exploration result (expected kind "rsi-exploration" with lessons[])');
            }
            const audited = value.lessons.filter(l => l?.verification?.verdict === 'PASS' && isEmptyDoubts(l?.verification?.doubts));
            const committed = await commitLessons(bank, audited, { source: 'exploration', scope });
            return toJson({ status: 'committed', committed, skipped_unaudited: value.lessons.length - audited.length, rejected: value.rejected?.length ?? 0 });
          }

          const known = (await bank.listAll()).map(e => e.title).filter(Boolean);
          const request = explorationPlanner.buildWorkflow({
            repoPath: args.repo_path || cwd,
            objective: args.objective,
            facets: args.facets,
            waves: args.waves,
            maxFollowUps: args.max_follow_ups,
            verify: args.verify,
            knownLessons: known
          });

          const run = args.mode === 'script' ? null : await runWorkflow(ctx, request, exec);
          if (!run) {
            return toJson({
              status: 'workflow_script',
              workflow: request,
              instructions: "The workflow engine is not active in the current session preset (the 'standard' preset disables workflowEngine; enable a preset with workflow support such as PTC/delegation to run directly). You can run this request using the 'workflow' tool (with meta, script, args verbatim), then call rsi_explore with workflow_result set to the returned value to commit the audited lessons."
            });
          }
          const value = run.value || {};
          const audited = (value.lessons || []).filter(l => l?.verification?.verdict === 'PASS' && isEmptyDoubts(l?.verification?.doubts));
          const committed = await commitLessons(bank, audited, { source: 'exploration', scope });
          return toJson({
            status: 'completed',
            run_id: run.runId,
            agents_started: run.agentsStarted,
            stats: value.stats,
            waves: value.waves,
            committed,
            rejected: value.rejected
          });
        }
      });

      register(ctx, {
        ...definition('rsi_practice'),
        execute: async (args = {}, exec) => {
          const cwd = await sessionDir(ctx, exec);
          const bank = bankFor(cwd);
          const scope = args.scope || 'workspace';
          const verifiedOf = l => (l?.verification?.verdict === 'PASS' && isEmptyDoubts(l?.verification?.doubts)) || l.practiced === true;

          if (args.workflow_result) {
            const value = args.workflow_result;
            if (value.kind !== 'rsi-practice' || !Array.isArray(value.lessons)) {
              throw new Error('workflow_result is not an rsi-practice result (expected kind "rsi-practice" with lessons[])');
            }
            const committed = await commitLessons(bank, value.lessons, { source: 'practice', scope, verifiedOf });
            return toJson({ status: 'committed', final_verdict: value.finalVerdict, final_state: value.finalState, committed });
          }

          if (!args.objective) throw new Error('rsi_practice requires objective (or workflow_result)');

          let priorLessons = [];
          if (args.seed_from_memory !== false) {
            const target = tokenize(args.objective);
            priorLessons = (await bank.listAll())
              .filter(e => !(e.tags || []).includes('superseded'))
              .map(e => ({ e, score: jaccard(target, tokenize(`${e.title} ${e.content}`)) }))
              .filter(x => x.score > 0.02)
              .sort((a, b) => b.score - a.score)
              .slice(0, 5)
              .map(({ e }) => ({ title: e.title, procedure: e.content }));
          }

          const request = practicePlanner.buildWorkflow({
            objective: args.objective,
            workdir: args.workdir || cwd,
            maxAttempts: args.max_attempts,
            constraints: args.constraints,
            deliverables: args.deliverables,
            priorLessons
          });

          const run = args.mode === 'script' ? null : await runWorkflow(ctx, request, exec);
          if (!run) {
            return toJson({
              status: 'workflow_script',
              workflow: request,
              seeded_lessons: priorLessons.length,
              instructions: "The workflow engine is not active in the current session preset (the 'standard' preset disables workflowEngine; enable a preset with workflow support such as PTC/delegation to run directly). You can run this request using the 'workflow' tool (with meta, script, args verbatim), then call rsi_practice with workflow_result set to the returned value to commit the distilled lessons."
            });
          }
          const value = run.value || {};
          const committed = await commitLessons(bank, value.lessons || [], { source: 'practice', scope, verifiedOf });
          return toJson({
            status: 'completed',
            run_id: run.runId,
            agents_started: run.agentsStarted,
            final_verdict: value.finalVerdict,
            final_state: value.finalState,
            attempts_used: value.attemptsUsed,
            transitions: value.transitions,
            seeded_lessons: priorLessons.length,
            committed
          });
        }
      });
    });
  }

  return {
    memoryBank: bankFor(config.workspaceDir || process.cwd()),
    bankFor,
    verifierRuntime,
    distiller,
    reconciler,
    explorationPlanner,
    practicePlanner
  };
}

export function apply(root, config) {
  return applyComponent(root, config);
}

export default { name, apply, applyComponent };
