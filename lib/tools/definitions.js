/**
 * DSH Tool definitions and parameter schemas for RSIAgent plugin.
 *
 * DSH's raw `ctx.tools.register()` requires every definition to declare
 * `output: { schema, render }`; registration throws a TypeError otherwise.
 * Parameter and output schemas must stay inside the enforced JSON Schema subset
 * (type / properties / required / additionalProperties / items / enum / const / oneOf
 * plus description / title / default / examples annotations).
 */

export const RSI_TOOLS = Object.freeze([
  'rsi_verify',
  'rsi_distill_memory',
  'rsi_reconcile_memory',
  'rsi_query_memory',
  'rsi_explore',
  'rsi_practice'
]);

/** Render a canonical value as model-facing text. */
export function renderValue(value) {
  if (value && typeof value === 'object') {
    // Long prompts read better as plain text than as escaped JSON strings.
    const promptKey = ['verifier_system_prompt', 'distillation_prompt'].find(k => typeof value[k] === 'string');
    if (promptKey) {
      const { [promptKey]: prompt, ...rest } = value;
      return `${JSON.stringify(rest, null, 2)}\n\n--- ${promptKey} ---\n${prompt}`;
    }
  }
  return JSON.stringify(value, null, 2);
}

const OBJECT_OUTPUT = Object.freeze({
  schema: { type: 'object', description: 'Structured RSI tool result.' },
  render: (_args, value) => [{ type: 'text', text: renderValue(value) }]
});

const SCOPE = {
  type: 'string',
  enum: ['workspace', 'global'],
  description: 'Memory scope: "workspace" (<cwd>/.rsi/memory) or "global" (~/.dsh/storages/rsi/memory).'
};

const MODE = {
  type: 'string',
  enum: ['auto', 'script'],
  description: '"auto" runs the workflow through the DSH workflow engine when available; "script" only returns the workflow request (meta/script/args) for the workflow tool.'
};

const WORKFLOW_RESULT = {
  type: 'object',
  description: 'Return value of a previously executed workflow from this tool. When given, nothing is run; its audited lessons are committed to memory.'
};

export const TOOL_DEFINITIONS = [
  {
    name: 'rsi_verify',
    description: 'Run independent double-blind verification on candidate task deliverables with read-only probes and falsification checks. Destructive probes are rejected.',
    parameters: {
      type: 'object',
      properties: {
        task_objective: { type: 'string', description: 'The authoritative target task requirements to verify against.' },
        deliverables: { type: 'array', items: { type: 'string' }, description: 'Paths of files, directories, or endpoints produced by the task.' },
        probes: { type: 'array', items: { type: 'string' }, description: 'Optional read-only shell commands to execute (e.g., npm test, file checks).' },
        report: { type: 'string', description: 'Optional verifier audit report to parse into a verdict (applies the doubt invariant).' }
      },
      required: ['task_objective']
    }
  },
  {
    name: 'rsi_distill_memory',
    description: 'Distill verified task experience into durable causal rules, failure lessons, and procedures.',
    parameters: {
      type: 'object',
      properties: {
        task_objective: { type: 'string', description: 'The task objective.' },
        verdict: { type: 'string', enum: ['PASS', 'FAIL', 'UNVERIFIED'], description: 'The terminal Verifier verdict.' },
        verifier_report: { type: 'string', description: 'The complete Verifier findings and evidence.' },
        trajectory_summary: { type: 'string', description: 'Summary of commands, actions, and observations during execution.' },
        rule_content: { type: 'string', description: 'Optional drafted markdown rule (frontmatter + Preconditions, Proven Rule, Pitfalls, Evidence). When present it is committed.' },
        scope: SCOPE
      },
      required: ['task_objective', 'verdict', 'verifier_report']
    }
  },
  {
    name: 'rsi_reconcile_memory',
    description: 'Inspect and reconcile the durable memory corpus to detect contradictions, outdated assumptions, or scope loss.',
    parameters: {
      type: 'object',
      properties: {
        entry_id: { type: 'string', description: 'Optional memory ID to inspect specifically against existing entries.' }
      }
    }
  },
  {
    name: 'rsi_query_memory',
    description: 'Search and read lessons, tool pitfalls, and environment procedures from the durable memory bank.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword search across titles and rule bodies.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (e.g., ["git", "cad", "npm"]).' },
        category: { type: 'string', description: 'Filter by category (e.g., "workflow", "tool-pitfall", "environment").' }
      }
    }
  },
  {
    name: 'rsi_explore',
    description: 'RSI Phase 1 (Broad Recursive Self-exploration): explore a repository with parallel waves of subagents (survey per facet, then deep probes on follow-up questions), audit every candidate lesson with an independent verifier, and commit only audited lessons to memory. Use when entering a new repository or environment.',
    parameters: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'What the exploration should learn. Defaults to build/test/safe-change knowledge.' },
        repo_path: { type: 'string', description: 'Absolute repository path. Defaults to the session working directory.' },
        facets: { type: 'array', items: { type: 'string' }, description: 'Facet ids (build-and-run, test-suite, toolchain, architecture, failure-modes) or free-form focus areas. Defaults to all five presets.' },
        waves: { type: 'integer', description: '1 = survey only; 2 = survey + deep probes (default).' },
        max_follow_ups: { type: 'integer', description: 'Maximum wave-2 deep probes (default 6).' },
        verify: { type: 'boolean', description: 'Audit lessons with independent verifiers (default true). Unaudited lessons are never committed.' },
        scope: SCOPE,
        mode: MODE,
        workflow_result: WORKFLOW_RESULT
      }
    }
  },
  {
    name: 'rsi_practice',
    description: 'RSI Phase 2 (Deep Recursive Self-exploration): drive one hard task through the failure-driven FAIL -> Distill -> Practice -> Retry state machine with double-blind verification on every attempt, then commit the distilled lessons to memory.',
    parameters: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'The hard task to solve (binding acceptance criteria).' },
        workdir: { type: 'string', description: 'Absolute working directory. Defaults to the session working directory.' },
        max_attempts: { type: 'integer', description: 'Attempt budget, 1-10 (default 3).' },
        constraints: { type: 'string', description: 'Extra constraints for the actor.' },
        deliverables: { type: 'array', items: { type: 'string' }, description: 'Expected deliverables shown to the verifier.' },
        seed_from_memory: { type: 'boolean', description: 'Seed the actor with related lessons from memory (default true).' },
        scope: SCOPE,
        mode: MODE,
        workflow_result: WORKFLOW_RESULT
      }
    }
  }
].map(def => ({ ...def, output: OBJECT_OUTPUT }));
