import { slugify } from './distillation.js';
/**
 * Cross-Corpus Memory Reconciliation for RSIAgent in DSH.
 * Detects conflicts, scope loss, and outdated assumptions to maintain an internally consistent memory bank.
 */

/** Tokenize text into ASCII words (>3 chars) plus CJK character bigrams. */
export function tokenize(text) {
  const lower = String(text || '').toLowerCase();
  const tokens = new Set(
    lower
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
  );
  const cjkRuns = lower.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
  }
  return tokens;
}

/** Jaccard similarity of two token sets. */
export function jaccard(a, b) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.max(1, a.size + b.size - shared);
}

export class MemoryReconciler {
  constructor(options = {}) {
    this.overlapThreshold = options.overlapThreshold ?? 0.35;
  }

  /**
   * Compare a new entry against all existing entries in the memory bank.
   * @returns {{conflicts: Array<object>, merges: Array<object>, safeToInsert: boolean}}
   */
  analyzeConsistency(existingEntries = [], newEntry) {
    if (!newEntry) {
      return { conflicts: [], merges: [], safeToInsert: false };
    }

    const conflicts = [];
    const merges = [];
    const newTokens = tokenize(`${newEntry.title || ''} ${newEntry.content || ''}`);

    for (const oldEntry of existingEntries) {
      if (oldEntry.id === newEntry.id) {
        merges.push({
          type: 'exact_id_overwrite',
          oldId: oldEntry.id,
          reason: `Entry with ID '${oldEntry.id}' already exists. New entry will update and supersede it.`
        });
        continue;
      }
      // Entries already superseded do not need to be re-annotated.
      if (Array.isArray(oldEntry.tags) && oldEntry.tags.includes('superseded')) continue;

      const overlap = jaccard(newTokens, tokenize(`${oldEntry.title || ''} ${oldEntry.content || ''}`));

      // 1. Same lesson topic evolution or explicit supersession
      const sameTopic = Boolean(oldEntry.title && newEntry.title && slugify(oldEntry.title) === slugify(newEntry.title));
      const explicitSupersede = Array.isArray(newEntry.supersedes) && newEntry.supersedes.includes(oldEntry.id);
      if (explicitSupersede || sameTopic) {
        conflicts.push({
          oldId: oldEntry.id,
          oldTitle: oldEntry.title,
          newId: newEntry.id,
          newTitle: newEntry.title,
          overlap: Math.round(overlap * 100),
          reason: explicitSupersede
            ? `Explicitly superseded by ${newEntry.id}.`
            : `Same lesson topic ('${newEntry.title}') with evolved procedure/specification.`
        });
        continue;
      }

      // 2. High lexical overlap with semantic contradiction
      if (overlap > this.overlapThreshold) {
        const signals = this.detectSemanticContradiction(oldEntry.content || '', newEntry.content || '');
        if (signals.hasContradiction) {
          conflicts.push({
            oldId: oldEntry.id,
            oldTitle: oldEntry.title,
            newId: newEntry.id,
            newTitle: newEntry.title,
            overlap: Math.round(overlap * 100),
            reason: signals.reason
          });
        } else {
          merges.push({
            type: 'related_topic',
            oldId: oldEntry.id,
            newId: newEntry.id,
            overlap: Math.round(overlap * 100)
          });
        }
      }
    }

    return { conflicts, merges, safeToInsert: conflicts.length === 0 };
  }

  /** Simple rule-based detector for common command/procedural contradictions. */
  detectSemanticContradiction(oldText, newText) {
    const o = String(oldText).toLowerCase();
    const n = String(newText).toLowerCase();

    const negationPatterns = [
      { positive: /\balways\s+use\b/, negative: /\b(?:do not|don't|never|avoid)\s+use\b/ },
      { positive: /\brequired\b/, negative: /\b(?:optional|deprecated|prohibited)\b/ },
      { positive: /\bsuccessfully\b/, negative: /\b(?:fails|causes crash|segfault)\b/ },
      { positive: /(?:总是|必须|务必)(?:使用|用)/, negative: /(?:不要|禁止|避免|切勿)(?:使用|用)/ }
    ];

    for (const pat of negationPatterns) {
      if ((pat.positive.test(o) && pat.negative.test(n)) || (pat.negative.test(o) && pat.positive.test(n))) {
        return {
          hasContradiction: true,
          reason: 'Direct procedural contradiction detected (e.g., affirmative vs prohibition rule).'
        };
      }
    }
    return { hasContradiction: false, reason: '' };
  }

  /**
   * Execute reconciliation on the memory bank:
   * annotates superseded old entries (in their own scope) and writes the new entry.
   */
  async reconcileAndCommit(memoryBank, newEntry, scope = 'workspace') {
    const existing = await memoryBank.listAll();
    const analysis = this.analyzeConsistency(existing, newEntry);

    for (const conflict of analysis.conflicts) {
      const old = await memoryBank.get(conflict.oldId);
      if (!old) continue;
      old.tags = Array.from(new Set([...(old.tags || []), 'deprecated', 'superseded']));
      old.content = `> ⚠️ **SUPERSEDED / CONFLICT NOTICE**: This earlier rule was refuted or qualified by \`${newEntry.id}\` on ${new Date().toISOString()}.\n> Reason: ${conflict.reason}\n\n` + old.content;
      // Keep the annotated entry in the scope it was read from.
      await memoryBank.save(old, old.scope || scope);
    }

    const result = await memoryBank.save(newEntry, scope);
    return {
      committed: result,
      reconciliationReport: {
        conflictsResolved: analysis.conflicts.length,
        relatedTopicsFound: analysis.merges.length,
        conflicts: analysis.conflicts,
        merges: analysis.merges
      }
    };
  }
}
