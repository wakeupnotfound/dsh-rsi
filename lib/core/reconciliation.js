/**
 * Cross-Corpus Memory Reconciliation for RSIAgent in DSH.
 * Detects conflicts, scope loss, and outdated assumptions to maintain an internally consistent memory bank.
 */

export class MemoryReconciler {
  /**
   * Compare a new entry against all existing entries in the memory bank.
   * @param {Array<object>} existingEntries
   * @param {object} newEntry
   * @returns {{conflicts: Array<object>, merges: Array<object>, safeToInsert: boolean}}
   */
  analyzeConsistency(existingEntries = [], newEntry) {
    if (!newEntry) {
      return { conflicts: [], merges: [], safeToInsert: false };
    }

    const conflicts = [];
    const merges = [];

    const newTokens = new Set(
      `${newEntry.title || ''} ${newEntry.content || ''}`
        .toLowerCase()
        .replace(/[^a-z0-9_\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3)
    );

    for (const oldEntry of existingEntries) {
      if (oldEntry.id === newEntry.id) {
        merges.push({
          type: 'exact_id_overwrite',
          oldId: oldEntry.id,
          reason: `Entry with ID '${oldEntry.id}' already exists. New entry will update and supersede it.`
        });
        continue;
      }

      // Check lexical overlap
      const oldTokens = new Set(
        `${oldEntry.title || ''} ${oldEntry.content || ''}`
          .toLowerCase()
          .replace(/[^a-z0-9_\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 3)
      );

      let shared = 0;
      for (const t of newTokens) {
        if (oldTokens.has(t)) shared++;
      }

      const jaccard = shared / Math.max(1, (newTokens.size + oldTokens.size - shared));

      // If high overlap, check for semantic polarity / conflict signals
      if (jaccard > 0.35) {
        const conflictSignals = this.detectSemanticContradiction(oldEntry.content || '', newEntry.content || '');
        if (conflictSignals.hasContradiction) {
          conflicts.push({
            oldId: oldEntry.id,
            oldTitle: oldEntry.title,
            newId: newEntry.id,
            newTitle: newEntry.title,
            overlap: Math.round(jaccard * 100),
            reason: conflictSignals.reason
          });
        } else {
          merges.push({
            type: 'related_topic',
            oldId: oldEntry.id,
            newId: newEntry.id,
            overlap: Math.round(jaccard * 100)
          });
        }
      }
    }

    return {
      conflicts,
      merges,
      safeToInsert: conflicts.length === 0
    };
  }

  /**
   * Simple rule-based detector for common command/procedural contradictions
   */
  detectSemanticContradiction(oldText, newText) {
    const o = oldText.toLowerCase();
    const n = newText.toLowerCase();

    // Check negation polarity
    const negationPatterns = [
      { positive: /\balways\s+use\b/, negative: /\b(?:do not|never|avoid)\s+use\b/ },
      { positive: /\brequired\b/, negative: /\b(?:optional|deprecated|prohibited)\b/ },
      { positive: /\bsuccessfully\b/, negative: /\b(?:fails|causes crash|segfault)\b/ }
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
   * Annotates superseded old entries and writes the new entry.
   */
  async reconcileAndCommit(memoryBank, newEntry, scope = 'workspace') {
    const existing = await memoryBank.listAll();
    const analysis = this.analyzeConsistency(existing, newEntry);

    // Annotate or deprecate conflicting old entries
    for (const conflict of analysis.conflicts) {
      const old = await memoryBank.get(conflict.oldId);
      if (old) {
        old.tags = Array.from(new Set([...(old.tags || []), 'deprecated', 'superseded']));
        old.content = `> ⚠️ **SUPERSEDED / CONFLICT NOTICE**: This earlier rule was refuted or qualified by \`${newEntry.id}\` on ${new Date().toISOString()}.\n> Reason: ${conflict.reason}\n\n` + old.content;
        await memoryBank.save(old, old.scope || scope);
      }
    }

    // Save the new entry
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
