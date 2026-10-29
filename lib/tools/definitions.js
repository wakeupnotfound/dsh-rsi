/**
 * DSH Tool definitions and parameter schemas for RSIAgent plugin.
 */

export const RSI_TOOLS = Object.freeze([
  'rsi_verify',
  'rsi_distill_memory',
  'rsi_reconcile_memory',
  'rsi_query_memory'
]);

export const TOOL_DEFINITIONS = [
  {
    name: 'rsi_verify',
    description: 'Run independent double-blind verification on candidate task deliverables with read-only probes and falsification checks.',
    parameters: {
      type: 'object',
      properties: {
        task_objective: {
          type: 'string',
          description: 'The authoritative target task requirements to verify against.'
        },
        deliverables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths of files, directories, or endpoints produced by the task.'
        },
        probes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional read-only shell commands to execute (e.g., npm test, file checks).'
        }
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
        task_objective: {
          type: 'string',
          description: 'The task objective.'
        },
        verdict: {
          type: 'string',
          enum: ['PASS', 'FAIL'],
          description: 'The terminal Verifier verdict.'
        },
        verifier_report: {
          type: 'string',
          description: 'The complete Verifier findings and evidence.'
        },
        trajectory_summary: {
          type: 'string',
          description: 'Summary of commands, actions, and observations during execution.'
        },
        rule_content: {
          type: 'string',
          description: 'Optional drafted markdown rule body containing Preconditions, Proven Rule, and Pitfalls.'
        },
        scope: {
          type: 'string',
          enum: ['workspace', 'global'],
          description: 'Memory scope: "workspace" (.rsi/memory) or "global" (~/.dsh/storages/rsi/memory).'
        }
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
        entry_id: {
          type: 'string',
          description: 'Optional memory ID to inspect specifically against existing entries.'
        }
      }
    }
  },
  {
    name: 'rsi_query_memory',
    description: 'Search and read lessons, tool pitfalls, and environment procedures from the durable memory bank.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword search across titles and rule bodies.'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (e.g., ["git", "cad", "npm"]).'
        },
        category: {
          type: 'string',
          description: 'Filter by category (e.g., "workflow", "tool-pitfall", "environment").'
        }
      }
    }
  }
];
