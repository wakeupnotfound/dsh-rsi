/**
 * Memory Distillation for RSIAgent in DSH.
 * Extracts causal lessons, failure diagnostics, and reusable rules from task execution and Verifier feedback.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatterBlock } from './memory.js';

export const PROBES_DIR = '.rsi/probes';

/** Normalize an arbitrary identifier into a kebab-case slug. */
export function slugify(text, fallback = 'lesson') {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

/** Extract a re-check probe command from markdown body if present. */
export function extractRecheckCommand(content) {
  if (!content || typeof content !== 'string') return '';
  const match = content.match(/###\s+Re-check Command\s*\r?\n+`([^`\r\n]+)`/i);
  return match ? match[1].trim() : '';
}

/**
 * Synthesize and persist a standardized regression probe configuration to `.rsi/probes/<memory_id>.json`.
 * Only called when a VERIFIED memory entry carries a `verifyCommand` / `probeCommand`.
 * @param {string} [workdir]
 * @param {{memoryId: string, title?: string, target?: string, probeCommand: string, expectedExitCode?: number}} spec
 */
export async function synthesizeRegressionProbe(workdir = process.cwd(), spec = {}) {
  const memoryId = slugify(spec.memoryId || '', '');
  const probeCommand = String(spec.probeCommand ?? '').trim();
  if (!memoryId || !probeCommand) return null;

  const probesDir = path.join(workdir, PROBES_DIR);
  await fs.mkdir(probesDir, { recursive: true });

  const probe = {
    memoryId,
    title: String(spec.title || memoryId),
    target: String(spec.target || ''),
    probeCommand,
    expectedExitCode: typeof spec.expectedExitCode === 'number' ? spec.expectedExitCode : 0,
    createdAt: new Date().toISOString()
  };

  const probePath = path.join(probesDir, `${memoryId}.json`);
  await fs.writeFile(probePath, JSON.stringify(probe, null, 2), 'utf-8');
  return { synthesized: true, probePath, probe };
}

/**
 * Load all synthesized regression probes from `.rsi/probes/*.json`.
 * @param {string} [workdir]
 * @returns {Promise<Array<{memoryId: string, title: string, target: string, probeCommand: string, expectedExitCode: number, createdAt?: string, filePath: string}>>}
 */
export async function loadRegressionProbes(workdir = process.cwd()) {
  const probesDir = path.join(workdir, PROBES_DIR);
  let files = [];
  try {
    files = await fs.readdir(probesDir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
  const probes = [];
  for (const file of jsonFiles) {
    const filePath = path.join(probesDir, file);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data && typeof data.probeCommand === 'string' && data.probeCommand.trim()) {
        probes.push({
          memoryId: String(data.memoryId || path.basename(file, '.json')),
          title: String(data.title || data.memoryId || path.basename(file, '.json')),
          target: String(data.target || ''),
          probeCommand: data.probeCommand.trim(),
          expectedExitCode: typeof data.expectedExitCode === 'number' ? data.expectedExitCode : 0,
          createdAt: data.createdAt || null,
          filePath
        });
      }
    } catch {
      // Skip unreadable or corrupted probe definitions
    }
  }
  return probes;
}

export class MemoryDistiller {
  /**
   * Build the prompt instructing the Actor to distill verified lessons.
   */
  buildDistillationPrompt({ taskObjective, verdict, verifierReport, trajectorySummary = '' }) {
    const outcomeLabel = verdict === 'PASS'
      ? 'VERIFIED PASS (Success)'
      : verdict === 'UNVERIFIED' ? 'UNVERIFIED (Evidence incomplete — record only what was observed)' : 'VERIFIED FAIL (Defect/Limitation)';
    return [
      '# ACTOR AGENT — CAUSAL MEMORY DISTILLATION',
      `Terminal Task Outcome: ${outcomeLabel}`,
      '',
      '## ORIGINAL TASK OBJECTIVE',
      String(taskObjective ?? '').trim(),
      '',
      '## INDEPENDENT VERIFIER REPORT',
      String(verifierReport ?? '').trim(),
      '',
      trajectorySummary ? `## EXECUTION TRAJECTORY HIGHLIGHTS\n${trajectorySummary.trim()}\n` : '',
      '## DISTILLATION OBJECTIVE',
      'Reflect on your interaction with the environment and the independent verification report.',
      'Do NOT merely write a task log. Instead, extract REUSABLE, CAUSAL knowledge that helps future agents:',
      '1. **Root Cause / Mechanism**: Why did this approach succeed or fail? What was the latent environment constraint?',
      '2. **Actionable Procedure**: What specific command, flag, code pattern, or workaround is proven to work?',
      '3. **Scope & Preconditions**: Under what exact conditions does this rule apply? Where does it NOT apply?',
      '4. **Pitfalls to Avoid**: What common misconception or false-done pattern should be guarded against?',
      '',
      'Format your output using the following markdown structure:',
      '```markdown',
      '---',
      'id: <short-kebab-case-slug>',
      'title: "<one-line-summary>"',
      'category: "<environment|workflow|tool-pitfall|domain-rule>"',
      'tags: ["<tag1>", "<tag2>"]',
      'verifyCommand: "<optional-read-only-probe-command>"',
      'supersedes: ["<optional-id-of-older-rule-this-replaces>"]',
      '---',
      '### Preconditions & Context',
      '<When does this rule apply?>',
      '',
      '### Proven Rule / Recommended Action',
      '<Exact command, code pattern, or procedure>',
      '',
      '### Pitfall / Failure Mechanism',
      '<What breaks if violated, and what was the root cause?>',
      '',
      '### Evidence',
      '<Key observation, error message, or verification result>',
      '```'
    ].join('\n');
  }

  /**
   * Parse distilled text into a clean memory object
   */
  parseDistilledEntry(text, fallbackId = `lesson-${Date.now()}`) {
    if (!text || typeof text !== 'string') {
      return null;
    }

    // Try extracting from code block if wrapped
    let cleanText = text;
    const codeBlockMatch = text.match(/```(?:markdown)?\r?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      cleanText = codeBlockMatch[1];
    }

    const frontmatterMatch = cleanText.trim().match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
    if (!frontmatterMatch) {
      // Fallback: extract title from first heading
      const headingMatch = text.match(/^#+\s+(.+)$/m);
      const title = headingMatch ? headingMatch[1].trim() : 'Unstructured Experience Note';
      return {
        id: fallbackId,
        title,
        category: 'unstructured',
        tags: ['distilled'],
        content: text.trim(),
        verified: true,
        created_at: new Date().toISOString()
      };
    }

    const body = frontmatterMatch[2].trim();
    const meta = parseFrontmatterBlock(frontmatterMatch[1]);
    const rawSupersedes = Array.isArray(meta.supersedes)
      ? meta.supersedes
      : (typeof meta.supersedes === 'string' && meta.supersedes.trim() ? meta.supersedes.split(',') : []);
    const supersedes = [...new Set(rawSupersedes.map(s => slugify(String(s).trim(), '')).filter(Boolean))];
    const verifyCommand = String(meta.verifyCommand || meta.verify_command || extractRecheckCommand(body) || '').trim();
    const target = String(meta.target || '').trim();

    return {
      id: meta.id ? slugify(meta.id, fallbackId) : fallbackId,
      title: meta.title || 'Distilled Environmental Lesson',
      category: meta.category || 'workflow',
      tags: Array.isArray(meta.tags) ? meta.tags : ['lesson'],
      ...(supersedes.length ? { supersedes } : {}),
      ...(verifyCommand ? { verifyCommand } : {}),
      ...(target ? { target } : {}),
      content: body,
      verified: true,
      created_at: new Date().toISOString()
    };
  }
}
