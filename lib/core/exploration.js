/**
 * Phase 1 — Broad Recursive Self-exploration.
 *
 * Builds a DSH workflow (`ctx.workflowEngine` / the `workflow` tool) that explores
 * a repository in parallel waves:
 *   Wave 1  one surveyor subagent per facet (build, tests, toolchain, ...)
 *   Wave 2  deep-dive subagents on the follow-up questions wave 1 raised
 *   Audit   every candidate lesson is re-checked by an independent verifier
 *           subagent that sees only the claim, never the explorer's reasoning;
 *           PASS with unresolved doubts is downgraded to FAIL (doubt invariant).
 * Only audited lessons are returned; the host commits them through
 * MemoryReconciler so contradictions with older rules are annotated.
 *
 * Workflow scripts run without filesystem/Node APIs, so the script is a static
 * string and every dynamic value travels through `args` as plain JSON.
 */

import crypto from 'node:crypto';
import { renderEpistemicSection } from './epistemic.js';
import { slugify } from './distillation.js';

export const DEFAULT_FACETS = Object.freeze([
  { id: 'build-and-run', title: 'Build & run', focus: 'How the project is built, started, and packaged; required commands, scripts, entrypoints and their exact flags.' },
  { id: 'test-suite', title: 'Test suite', focus: 'How tests are discovered and executed, how to run a single test, current pass/fail state, flaky or slow areas.' },
  { id: 'toolchain', title: 'Toolchain & dependencies', focus: 'Language/runtime versions, package manager, lockfiles, native dependencies, environment variables and platform constraints.' },
  { id: 'architecture', title: 'Architecture & conventions', focus: 'Module layout, public APIs, coding conventions, extension points and invariants a change must respect.' },
  { id: 'failure-modes', title: 'Failure modes & pitfalls', focus: 'Commands or edits that fail non-obviously, misleading error messages, sandbox/permission traps, and their verified workarounds.' }
]);

export const LESSON_CATEGORIES = Object.freeze(['environment', 'workflow', 'tool-pitfall', 'domain-rule']);

/** Object-rooted schemas restricted to the DSH workflow subset. */
export const LESSON_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    title: { type: 'string' },
    category: { type: 'string', enum: [...LESSON_CATEGORIES] },
    tags: { type: 'array', items: { type: 'string' } },
    preconditions: { type: 'string' },
    procedure: { type: 'string' },
    pitfall: { type: 'string' },
    evidence: { type: 'string' },
    verifyCommand: { type: 'string' }
  },
  required: ['title', 'category', 'tags', 'preconditions', 'procedure', 'pitfall', 'evidence', 'verifyCommand'],
  additionalProperties: false
});

export const VERDICT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL', 'UNVERIFIED'] },
    doubts: { type: 'string' },
    evidence: { type: 'string' }
  },
  required: ['verdict', 'doubts', 'evidence'],
  additionalProperties: false
});

/**
 * The workflow script body (plain JavaScript, top-level await, ends in return).
 * Shared helpers are duplicated in practice.js on purpose: scripts cannot import.
 */
export const EXPLORATION_SCRIPT = String.raw`
const A = args;
const LESSON = A.schemas.lesson;
const VERDICT = A.schemas.verdict;
const REPORT = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    lessons: { type: 'array', items: LESSON },
    followUps: { type: 'array', items: { type: 'string' } }
  },
  required: ['summary', 'lessons', 'followUps'],
  additionalProperties: false
};

function emptyDoubts(text) {
  const t = String(text == null ? '' : text).trim().replace(/^[-*\s]+/, '').replace(/[.。!！\s]+$/, '');
  return t === '' || /^(none|n\/a|na|nil|null|empty|no|no doubts?|nothing|无|没有|暂无|无疑点)$/i.test(t);
}
function normalizeVerdict(v) {
  if (!v || typeof v.verdict !== 'string') return { verdict: 'UNVERIFIED', doubts: 'verifier produced no result', evidence: '', downgraded: false };
  if (v.verdict === 'PASS' && !emptyDoubts(v.doubts)) return { verdict: 'FAIL', doubts: v.doubts, evidence: v.evidence, downgraded: true };
  return { verdict: v.verdict, doubts: v.doubts, evidence: v.evidence, downgraded: false };
}
function key(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim(); }

const rules = [
  'Work ONLY inside the repository at: ' + A.repoPath,
  'Stay non-destructive: do not edit, delete, move or commit tracked files, do not push, do not install global packages.',
  'Scratch files, if unavoidable, go to a fresh temporary directory outside the repository.',
  'Every lesson must be backed by a command you actually ran and its observed output (E1, E6). Prefer fewer, verified lessons over many guesses.',
  'Each lesson needs a short read-only verifyCommand that an independent auditor can run to re-check it (use "" only if impossible).',
  'Report at most ' + A.maxLessonsPerAgent + ' lessons.'
].map(function (r, i) { return (i + 1) + '. ' + r; }).join('\n');

const known = A.knownLessons.length
  ? '\n\nAlready-known lessons (do not repeat; report contradictions as new lessons with evidence):\n' + A.knownLessons.map(function (t) { return '- ' + t; }).join('\n')
  : '';

function surveyPrompt(facet) {
  return [
    '# RSI BROAD EXPLORATION — ' + facet.title,
    A.epistemic,
    '## Exploration objective', A.objective,
    '## Your facet', facet.focus,
    '## Rules', rules + known,
    '## Output', 'Return a summary, verified lessons, and up to 3 concrete followUps (open questions worth a deeper probe).'
  ].join('\n\n');
}
function deepPrompt(question) {
  return [
    '# RSI DEEP PROBE (wave 2)',
    A.epistemic,
    '## Exploration objective', A.objective,
    '## Open question to resolve with evidence', question,
    '## Rules', rules + known,
    '## Output', 'Return a summary, verified lessons, and followUps (may be empty).'
  ].join('\n\n');
}
function auditPrompt(lesson) {
  return [
    '# INDEPENDENT LESSON AUDIT — DOUBLE-BLIND',
    'You did not discover this lesson and have not seen how it was found. Try to FALSIFY it using read-only probes inside: ' + A.repoPath,
    'Never modify, delete, install, commit or reset anything.',
    A.epistemic,
    '## Claimed lesson',
    'Title: ' + lesson.title,
    'Preconditions: ' + lesson.preconditions,
    'Procedure: ' + lesson.procedure,
    'Pitfall: ' + lesson.pitfall,
    'Suggested read-only check: ' + (lesson.verifyCommand || '(none — design your own)'),
    '## Output',
    'verdict PASS only if the claim is affirmatively evidenced and doubts is empty ("None"); FAIL if refuted; UNVERIFIED if evidence is incomplete. Put raw observations in evidence.'
  ].join('\n');
}

const waves = [];
const candidates = [];
const seen = {};
function collect(report, origin, wave) {
  if (!report || !Array.isArray(report.lessons)) return;
  for (const lesson of report.lessons) {
    const k = key(lesson.title);
    if (!k || seen[k]) continue;
    seen[k] = true;
    candidates.push(Object.assign({}, lesson, { origin: origin, wave: wave }));
  }
}

phase('Wave 1: broad survey');
const wave1 = await parallel(A.facets.map(function (facet) {
  return function () { return agent(surveyPrompt(facet), { schema: REPORT, label: 'survey: ' + facet.id, phase: 'Wave 1: broad survey' }); };
}));
wave1.forEach(function (report, i) { collect(report, A.facets[i].id, 1); });
waves.push({ wave: 1, agents: A.facets.length, completed: wave1.filter(Boolean).length });

const followUps = [];
const fseen = {};
wave1.forEach(function (report) {
  (report && Array.isArray(report.followUps) ? report.followUps : []).forEach(function (q) {
    const k = key(q);
    if (k && !fseen[k] && followUps.length < A.maxFollowUps) { fseen[k] = true; followUps.push(q); }
  });
});
log('wave 1: ' + candidates.length + ' candidate lessons, ' + followUps.length + ' follow-ups');

if (A.waves >= 2 && followUps.length > 0) {
  phase('Wave 2: deep probes');
  const wave2 = await parallel(followUps.map(function (q, i) {
    return function () { return agent(deepPrompt(q), { schema: REPORT, label: 'probe ' + (i + 1), phase: 'Wave 2: deep probes' }); };
  }));
  wave2.forEach(function (report, i) { collect(report, 'follow-up:' + followUps[i], 2); });
  waves.push({ wave: 2, agents: followUps.length, completed: wave2.filter(Boolean).length });
}

let audited;
if (A.verify) {
  phase('Audit: independent verification');
  audited = await pipeline(candidates, function (lesson) {
    return agent(auditPrompt(lesson), { schema: VERDICT, label: 'audit: ' + String(lesson.title).slice(0, 40), phase: 'Audit: independent verification' });
  });
} else {
  audited = candidates.map(function () { return { verdict: 'UNVERIFIED', doubts: 'audit disabled', evidence: '' }; });
}

const lessons = [];
const rejected = [];
candidates.forEach(function (lesson, i) {
  const v = normalizeVerdict(audited[i]);
  const record = Object.assign({}, lesson, { verification: v });
  if (v.verdict === 'PASS') lessons.push(record); else rejected.push({ title: lesson.title, origin: lesson.origin, verification: v });
});
log('audit: ' + lessons.length + ' passed, ' + rejected.length + ' rejected');

return {
  kind: 'rsi-exploration',
  objective: A.objective,
  repoPath: A.repoPath,
  waves: waves,
  followUps: followUps,
  lessons: lessons,
  rejected: rejected,
  stats: { candidates: candidates.length, passed: lessons.length, rejected: rejected.length }
};
`;

/** Normalize the facet input (ids from DEFAULT_FACETS or free-form focus strings). */
export function resolveFacets(facets) {
  if (!Array.isArray(facets) || facets.length === 0) return DEFAULT_FACETS.map(f => ({ ...f }));
  return facets.map((item, index) => {
    if (item && typeof item === 'object') {
      return { id: slugify(item.id || item.title || 'facet-' + (index + 1)), title: String(item.title || item.id || 'Facet ' + (index + 1)), focus: String(item.focus || item.title || '') };
    }
    const preset = DEFAULT_FACETS.find(f => f.id === item);
    if (preset) return { ...preset };
    return { id: slugify(item, 'facet-' + (index + 1)), title: String(item), focus: String(item) };
  });
}

export class ExplorationPlanner {
  /**
   * Build the workflow request for a broad exploration run.
   * @param {object} options
   * @param {string} options.repoPath - absolute repository path to explore
   * @param {string} [options.objective]
   * @param {Array<string|object>} [options.facets]
   * @param {number} [options.waves=2] - 1 = survey only, 2 = survey + deep probes
   * @param {number} [options.maxFollowUps=6]
   * @param {number} [options.maxLessonsPerAgent=5]
   * @param {boolean} [options.verify=true] - audit each lesson with an independent verifier
   * @param {string[]} [options.knownLessons] - titles already in memory
   * @returns {{meta: {name: string, description: string, whenToUse: string}, script: string, args: object}}
   */
  buildWorkflow(options = {}) {
    if (!options.repoPath) throw new Error('ExplorationPlanner.buildWorkflow requires repoPath');
    const clampInt = (v, d, lo, hi) => Math.min(hi, Math.max(lo, Number.isInteger(v) ? v : d));
    return {
      meta: {
        name: 'rsi-broad-exploration',
        description: 'RSI Phase 1: parallel wave exploration of a repository with double-blind lesson audit.',
        whenToUse: 'Entering a new repository or environment whose build, test and pitfall knowledge is not yet in RSI memory.'
      },
      script: EXPLORATION_SCRIPT,
      args: {
        repoPath: String(options.repoPath),
        objective: String(options.objective || 'Learn how to build, test, and safely change this repository; capture reusable, verified lessons.'),
        facets: resolveFacets(options.facets),
        waves: clampInt(options.waves, 2, 1, 2),
        maxFollowUps: clampInt(options.maxFollowUps, 6, 0, 20),
        maxLessonsPerAgent: clampInt(options.maxLessonsPerAgent, 5, 1, 20),
        verify: options.verify !== false,
        knownLessons: Array.isArray(options.knownLessons) ? options.knownLessons.map(String).slice(0, 50) : [],
        epistemic: renderEpistemicSection(),
        schemas: { lesson: LESSON_SCHEMA, verdict: VERDICT_SCHEMA }
      }
    };
  }
}

/**
 * Convert an audited lesson (from an exploration or practice result) into a memory entry.
 * @param {object} lesson
 * @param {{source?: string, extraTags?: string[]}} [options]
 */
export function lessonToEntry(lesson, options = {}) {
  const source = options.source || 'exploration';
  const v = lesson.verification || {};
  const tags = Array.from(new Set([
    ...(Array.isArray(lesson.tags) ? lesson.tags.map(String) : []),
    'rsi-' + source,
    ...(options.extraTags || [])
  ]));
  const content = [
    '### Preconditions & Context',
    String(lesson.preconditions || '(unspecified)').trim(),
    '',
    '### Proven Rule / Recommended Action',
    String(lesson.procedure || '(unspecified)').trim(),
    '',
    '### Pitfall / Failure Mechanism',
    String(lesson.pitfall || '(unspecified)').trim(),
    '',
    '### Evidence',
    String(lesson.evidence || '(unspecified)').trim(),
    ...(lesson.verifyCommand ? ['', '### Re-check Command', '`' + String(lesson.verifyCommand).trim() + '`'] : []),
    ...(v.verdict ? ['', '### Independent Verification', 'VERDICT: ' + v.verdict + (v.evidence ? '\n' + String(v.evidence).trim() : '')] : [])
  ].join('\n');
  const titleSlug = slugify(lesson.title || 'lesson');
  let id;
  if (lesson.id) {
    id = slugify(lesson.id);
  } else if (!titleSlug || titleSlug === 'lesson') {
    const hash = crypto.createHash('sha256').update(String(lesson.title || '') + String(lesson.procedure || '')).digest('hex').slice(0, 8);
    id = `${source}-lesson-${hash}`;
  } else {
    id = slugify(`${source}-${titleSlug}`);
  }

  return {
    id,
    title: String(lesson.title || 'Untitled lesson'),
    category: LESSON_CATEGORIES.includes(lesson.category) ? lesson.category : 'workflow',
    tags,
    content,
    verified: v.verdict === 'PASS',
    created_at: new Date().toISOString()
  };
}
