/**
 * Memory Distillation for RSIAgent in DSH.
 * Extracts causal lessons, failure diagnostics, and reusable rules from task execution and Verifier feedback.
 */

export class MemoryDistiller {
  /**
   * Build the prompt instructing the Actor to distill verified lessons.
   */
  buildDistillationPrompt({ taskObjective, verdict, verifierReport, trajectorySummary = '' }) {
    const outcomeLabel = verdict === 'PASS' ? 'VERIFIED PASS (Success)' : 'VERIFIED FAIL (Defect/Limitation)';
    return [
      '# ACTOR AGENT — CAUSAL MEMORY DISTILLATION',
      `Terminal Task Outcome: ${outcomeLabel}`,
      '',
      '## ORIGINAL TASK OBJECTIVE',
      taskObjective.trim(),
      '',
      '## INDEPENDENT VERIFIER REPORT',
      verifierReport.trim(),
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

    const frontmatterMatch = cleanText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
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

    const rawMeta = frontmatterMatch[1];
    const body = frontmatterMatch[2].trim();
    const meta = {};

    for (const line of rawMeta.split('\n')) {
      const idx = line.indexOf(':');
      if (idx !== -1) {
        const key = line.slice(0, idx).trim();
        const rawVal = line.slice(idx + 1).trim();
        try {
          meta[key] = JSON.parse(rawVal);
        } catch {
          meta[key] = rawVal.replace(/^["']|["']$/g, '');
        }
      }
    }

    return {
      id: meta.id || fallbackId,
      title: meta.title || 'Distilled Environmental Lesson',
      category: meta.category || 'workflow',
      tags: Array.isArray(meta.tags) ? meta.tags : ['lesson'],
      content: body,
      verified: true,
      created_at: new Date().toISOString()
    };
  }
}
