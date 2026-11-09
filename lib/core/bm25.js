/**
 * Field-Weighted BM25F Search Engine for RSIAgent Memory Bank.
 * Pure native JavaScript, zero external dependencies.
 */

import { tokenizeTerms } from './reconciliation.js';

export const FIELD_CONFIGS = Object.freeze({
  title: { weight: 3.0, b: 0.75 },
  provenRule: { weight: 2.5, b: 0.6 },
  preconditions: { weight: 2.0, b: 0.5 },
  tags: { weight: 2.0, b: 0.5 },
  failureModes: { weight: 1.0, b: 0.6 },
  evidence: { weight: 1.0, b: 0.6 }
});

export const K1 = 1.2;
export const LAMBDA_DECAY = Math.LN2 / 90; // 90-day half-life

export const CONFIDENCE_WEIGHTS = Object.freeze({
  VERIFIED: 1.2,
  OBSERVED: 1.0,
  INFERRED: 0.8,
  PROBATION: 0.4,
  UNTRUSTED: 0.3
});

/**
 * Extract structured text fields from a memory entry.
 * Inspects YAML-like metadata and Markdown section headings.
 */
export function extractMemoryFields(entry) {
  const title = String(entry?.title || '');
  const tags = Array.isArray(entry?.tags)
    ? entry.tags.join(' ')
    : String(entry?.tags || '');

  let preconditions = '';
  let provenRule = '';
  let failureModes = '';
  let evidence = '';

  const content = String(entry?.content || '');
  const sections = content.split(/(?=^#{2,4}\s+)/m);
  let matchedAny = false;

  for (const sec of sections) {
    const headerMatch = sec.match(/^#{2,4}\s+([^\r\n]+)/);
    if (!headerMatch) continue;
    const header = headerMatch[1].toLowerCase();
    const body = sec.replace(/^#{2,4}\s+[^\r\n]+[\r\n]*/, '').trim();
    if (/precondition|context|前置|环境/i.test(header)) {
      preconditions += ' ' + body;
      matchedAny = true;
    } else if (/proven\s*rule|recommended|action|规则|建议|最佳实践|procedure/i.test(header)) {
      provenRule += ' ' + body;
      matchedAny = true;
    } else if (/pitfall|failure|defect|mechanism|避坑|失败|踩坑/i.test(header)) {
      failureModes += ' ' + body;
      matchedAny = true;
    } else if (/evidence|verification|proof|证据|验证/i.test(header)) {
      evidence += ' ' + body;
      matchedAny = true;
    }
  }

  if (!matchedAny) {
    provenRule = content;
  }

  return {
    title: title.trim(),
    provenRule: provenRule.trim(),
    preconditions: preconditions.trim(),
    tags: tags.trim(),
    failureModes: failureModes.trim(),
    evidence: evidence.trim()
  };
}

export class BM25F {
  /**
   * @param {Array<object>} documents - Raw memory entries
   * @param {object} [options]
   */
  constructor(documents = [], options = {}) {
    this.fieldConfigs = options.fieldConfigs || FIELD_CONFIGS;
    this.k1 = options.k1 ?? K1;
    this.documents = documents;

    this.docCount = documents.length;
    this.docFields = [];
    this.fieldLengths = {};
    this.avgFieldLength = {};
    this.termDocFreq = new Map(); // term -> count of docs containing term
    this.docTermFreqs = []; // docIndex -> Map(field -> Map(term -> count))

    this.index();
  }

  index() {
    for (const field of Object.keys(this.fieldConfigs)) {
      this.fieldLengths[field] = [];
    }

    for (let i = 0; i < this.documents.length; i++) {
      const doc = this.documents[i];
      const fields = extractMemoryFields(doc);
      this.docFields.push(fields);

      const fieldMap = new Map();
      const docSeenTerms = new Set();

      for (const [field, config] of Object.entries(this.fieldConfigs)) {
        const text = fields[field] || '';
        const tokens = tokenizeTerms(text);
        this.fieldLengths[field].push(tokens.length);

        const tfMap = new Map();
        for (const token of tokens) {
          tfMap.set(token, (tfMap.get(token) || 0) + 1);
          docSeenTerms.add(token);
        }
        fieldMap.set(field, tfMap);
      }

      for (const term of docSeenTerms) {
        this.termDocFreq.set(term, (this.termDocFreq.get(term) || 0) + 1);
      }

      this.docTermFreqs.push(fieldMap);
    }

    // Calculate average field lengths
    for (const field of Object.keys(this.fieldConfigs)) {
      const lengths = this.fieldLengths[field];
      const sum = lengths.reduce((acc, len) => acc + len, 0);
      this.avgFieldLength[field] = this.docCount > 0 ? (sum / this.docCount) : 1;
      if (this.avgFieldLength[field] === 0) {
        this.avgFieldLength[field] = 1;
      }
    }
  }

  idf(term) {
    const n = this.termDocFreq.get(term) || 0;
    if (this.docCount === 0) return 0;
    // RSJ Robertson-Spärck Jones IDF variation with guarantee of non-negative score:
    // ln(1 + (N - n + 0.5) / (n + 0.5))
    return Math.log(1 + (this.docCount - n + 0.5) / (n + 0.5));
  }

  scoreDocument(queryTerms, docIndex) {
    const fieldMap = this.docTermFreqs[docIndex];
    let bm25fScore = 0;

    for (const term of queryTerms) {
      let weightedTf = 0;

      for (const [field, config] of Object.entries(this.fieldConfigs)) {
        const tfMap = fieldMap.get(field);
        const tf = tfMap?.get(term) || 0;
        if (tf === 0) continue;

        const len = this.fieldLengths[field][docIndex];
        const avgdl = this.avgFieldLength[field];
        const b = config.b;
        const normFactor = 1 - b + (b * (len / avgdl));
        weightedTf += config.weight * (tf / normFactor);
      }

      if (weightedTf > 0) {
        const idfVal = this.idf(term);
        bm25fScore += idfVal * (weightedTf / (this.k1 + weightedTf));
      }
    }

    return bm25fScore;
  }

  /**
   * Search documents and return sorted results with score breakdown.
   * @param {string} queryString
   * @param {object} [options]
   * @param {object} [options.stats] - Sidecar stats by doc id
   * @param {number} [options.now] - Current timestamp ms
   * @param {number} [options.topK] - Max results to return
   */
  search(queryString, options = {}) {
    const qTrim = String(queryString || '').trim().toLowerCase();
    const queryTokens = Array.from(new Set(tokenizeTerms(qTrim)));
    const statsMap = options.stats || {};
    const now = options.now ?? Date.now();
    const results = [];

    const minRequired = queryTokens.length <= 2
      ? (queryTokens.length === 0 ? 0 : 1)
      : Math.max(2, Math.ceil(queryTokens.length * 0.45));

    for (let i = 0; i < this.documents.length; i++) {
      const doc = this.documents[i];
      const fields = this.docFields[i];
      const fullText = `${doc.title || ''} ${doc.content || ''} ${(doc.tags || []).join(' ')}`.toLowerCase();
      const exactMatch = qTrim.length > 0 && fullText.includes(qTrim);

      let matchedTermsCount = 0;
      if (queryTokens.length > 0) {
        const fieldMap = this.docTermFreqs[i];
        for (const term of queryTokens) {
          for (const [field, tfMap] of fieldMap) {
            if (tfMap.has(term)) {
              matchedTermsCount++;
              break;
            }
          }
        }
      }

      // Check match eligibility
      if (queryTokens.length > 0) {
        if (!exactMatch && matchedTermsCount < minRequired) {
          continue;
        }
      }

      let bm25f = queryTokens.length > 0 ? this.scoreDocument(queryTokens, i) : 1.0;
      if (queryTokens.length > 0 && bm25f <= 0) {
        continue;
      }

      if (exactMatch) {
        bm25f *= 1.5;
      }

      const id = String(doc.id);
      const stat = statsMap[id] || {};

      // Determine confidence weight W_conf
      let confKey = 'OBSERVED';
      if (doc.trusted === false) {
        confKey = 'UNTRUSTED';
      } else if (doc.status === 'PROBATION' || stat.status === 'PROBATION' || (stat.fail_streak || 0) >= 2) {
        confKey = 'PROBATION';
      } else if (doc.confidence && CONFIDENCE_WEIGHTS[doc.confidence]) {
        confKey = doc.confidence;
      } else if (doc.verified) {
        confKey = 'VERIFIED';
      }
      const wConf = CONFIDENCE_WEIGHTS[confKey] ?? 1.0;

      // Hit count factor: ln(e + 0.2 * hit_count)
      const hitCount = Number(stat.hit_count) || 0;
      const wUtility = Math.log(Math.E + 0.2 * hitCount);

      // Time decay factor: e^(-lambda * delta_t_days)
      const lastValidated = doc.last_validated_at || doc.updated_at || doc.created_at;
      let deltaDays = 0;
      if (lastValidated) {
        const valTime = Date.parse(lastValidated);
        if (!isNaN(valTime) && valTime < now) {
          deltaDays = (now - valTime) / (1000 * 60 * 60 * 24);
        }
      }
      const wDecay = Math.exp(-LAMBDA_DECAY * deltaDays);

      const finalScore = bm25f * wConf * wUtility * wDecay;

      results.push({
        entry: doc,
        score: finalScore,
        details: {
          bm25f,
          wConf,
          confKey,
          wUtility,
          wDecay,
          hitCount,
          deltaDays,
          exactMatch
        }
      });
    }

    results.sort((a, b) => b.score - a.score);

    if (options.topK && options.topK > 0) {
      return results.slice(0, options.topK);
    }
    return results;
  }
}
