/**
 * Durable Memory Bank for RSIAgent in DeepSeek Harness.
 * Handles storage, indexing, SHA-256 tree hashing, and retrieval of verified lessons.
 *
 * Reads never create directories: prompt assembly and queries must stay side-effect
 * free. Directories are created lazily on the first write.
 *
 * Trust model: entries written by this plugin are HMAC-signed with a per-user key
 * kept outside the workspace (see integrity.js). Workspace entries without a valid
 * signature (e.g. files shipped inside a cloned repository) are flagged
 * `trusted: false`; callers keep them out of system prompts, reconciliation and
 * seeding. Global entries live under the user's home and are always trusted.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Keyring } from './integrity.js';
import { BM25F } from './bm25.js';

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** Default per-file read cap; larger files are ignored (keeps prompt assembly bounded). */
export const DEFAULT_MAX_ENTRY_BYTES = 256 * 1024;

const LOCK_FILE = '.rsi.lock';
const LOCK_STALE_MS = 30000;
const LOCK_TIMEOUT_MS = 15000;

const shortHash = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8);

/** Legacy (v0.1.0) file name mapping; still consulted when reading and deleting. */
export function legacyMemoryFileName(id) {
  let safe = String(id).replace(/[^\p{Letter}\p{Number}_-]/gu, '_');
  if (WINDOWS_RESERVED.test(safe)) safe = `_${safe}`;
  return `${safe}.md`;
}

/**
 * Map a memory id onto its on-disk file name with cross-platform safety.
 * Ids that need character rewriting (unsafe characters) get a short hash of
 * the original id appended, so distinct ids (e.g. "a.b" vs "a_b") never collide on disk.
 */
export function memoryFileName(id) {
  const raw = String(id);
  let safe = raw.replace(/[^\p{Letter}\p{Number}_-]/gu, '_');
  const rewritten = safe !== raw;
  if (WINDOWS_RESERVED.test(safe)) safe = `_${safe}`;
  if (rewritten) safe = `${safe}-${shortHash(raw)}`;
  return `${safe}.md`;
}

/** Parse a flat `key: <json-or-text>` frontmatter block. */
export function parseFrontmatterBlock(rawMeta) {
  const meta = {};
  for (const line of rawMeta.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    const rawVal = line.slice(idx + 1).trim();
    try {
      meta[key] = JSON.parse(rawVal);
    } catch {
      meta[key] = rawVal.replace(/^["']|["']$/g, '');
    }
  }
  return meta;
}

const normalizeContent = c => String(c || '').replace(/\r\n/g, '\n').trim();
const normalizeList = v => (Array.isArray(v) ? v.map(String) : []);

/** In-process mutual exclusion per lock key (complements the cross-process lock file). */
const exclusiveTails = new Map();
function runExclusive(key, fn) {
  const prev = exclusiveTails.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(r => { release = r; });
  const tail = prev.then(() => gate);
  exclusiveTails.set(key, tail);
  return prev.then(async () => {
    try {
      return await fn();
    } finally {
      release();
      if (exclusiveTails.get(key) === tail) exclusiveTails.delete(key);
    }
  });
}

async function acquireFileLock(dir) {
  const lockPath = path.join(dir, LOCK_FILE);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return async () => { await fs.unlink(lockPath).catch(() => {}); };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      try {
        const st = await fs.stat(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          await fs.unlink(lockPath).catch(() => {});
          continue;
        }
      } catch { continue; }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for memory lock ${lockPath}`);
      await new Promise(r => setTimeout(r, 25 + Math.floor(Math.random() * 50)));
    }
  }
}

export class MemoryBank {
  /**
   * @param {object} [options]
   * @param {string} [options.globalDir] - global memory directory (default ~/.dsh/storages/rsi/memory)
   * @param {string} [options.workspaceDir] - workspace root; memory lives in <workspace>/.rsi/memory
   * @param {string} [options.keyFile] - integrity key file (default <globalDir>/../.integrity-key)
   * @param {'signed'|'all'} [options.workspaceTrust='signed'] - trust only signed workspace entries, or all
   * @param {number} [options.maxEntryBytes] - files larger than this are ignored
   */
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceDir || null;
    this.workspaceDir = options.workspaceDir ? path.join(options.workspaceDir, '.rsi', 'memory') : null;
    this.globalDir = options.globalDir || path.join(os.homedir(), '.dsh', 'storages', 'rsi', 'memory');
    this.hasGlobalAccess = true;
    this.keyring = Keyring.for(options.keyFile || path.join(path.dirname(this.globalDir), '.integrity-key'));
    this.workspaceTrust = options.workspaceTrust === 'all' ? 'all' : 'signed';
    this.maxEntryBytes = options.maxEntryBytes || DEFAULT_MAX_ENTRY_BYTES;
    this.cache = new Map();
  }

  /** Create the writable directories. Only called on writes. */
  async init() {
    if (this.hasGlobalAccess) {
      try {
        await fs.mkdir(this.globalDir, { recursive: true });
      } catch {
        // Sandboxed environments may restrict writing outside the workspace.
        this.hasGlobalAccess = false;
      }
    }
    if (this.workspaceDir) {
      try {
        await fs.mkdir(this.workspaceDir, { recursive: true });
      } catch {
        // The save() path reports the missing directory explicitly.
      }
    }
  }

  sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /** The scanned directories, workspace first so it shadows global entries. */
  scopes() {
    const list = [];
    if (this.workspaceDir) list.push({ dir: this.workspaceDir, scope: 'workspace' });
    if (this.hasGlobalAccess) list.push({ dir: this.globalDir, scope: 'global' });
    return list;
  }

  /** Canonical, signed view of an entry (exactly what is persisted). */
  canonical(entry) {
    const verified = Boolean(entry.verified);
    const confidence = entry.confidence || (verified ? 'VERIFIED' : 'OBSERVED');
    const tags = normalizeList(entry.tags);
    const status = entry.status || (tags.includes('superseded') ? 'SUPERSEDED' : 'ACTIVE');
    const created_at = String(entry.created_at || new Date().toISOString());
    const last_validated_at = String(entry.last_validated_at || entry.updated_at || created_at);

    return {
      id: String(entry.id),
      title: String(entry.title || entry.id),
      category: String(entry.category || 'general'),
      tags,
      verified,
      confidence,
      status,
      last_validated_at,
      created_at,
      supersedes: normalizeList(entry.supersedes),
      content: normalizeContent(entry.content)
    };
  }

  signaturePayload(c) {
    return JSON.stringify(['dsh-rsi-memory-v2', c.id, c.title, c.category, c.tags, c.verified, c.confidence, c.status, c.last_validated_at, c.created_at, c.supersedes, c.content]);
  }

  signaturePayloadV1(c) {
    return JSON.stringify(['dsh-rsi-memory-v1', c.id, c.title, c.category, c.tags, c.verified, c.created_at, c.supersedes, c.content]);
  }

  serializeEntry(entry, { sign = true } = {}) {
    const c = this.canonical(entry);
    const signature = sign ? this.keyring.sign(this.signaturePayload(c), { create: true }) : null;
    const frontmatter = [
      '---',
      `id: ${JSON.stringify(c.id)}`,
      `title: ${JSON.stringify(c.title)}`,
      `category: ${JSON.stringify(c.category)}`,
      `tags: ${JSON.stringify(c.tags)}`,
      `verified: ${c.verified}`,
      `confidence: ${JSON.stringify(c.confidence)}`,
      `status: ${JSON.stringify(c.status)}`,
      `last_validated_at: ${JSON.stringify(c.last_validated_at)}`,
      `created_at: ${JSON.stringify(c.created_at)}`,
      `updated_at: ${JSON.stringify(new Date().toISOString())}`,
      ...(c.supersedes.length ? [`supersedes: ${JSON.stringify(c.supersedes)}`] : []),
      ...(signature ? [`signature: ${JSON.stringify(signature)}`] : []),
      '---',
      ''
    ].join('\n');

    return frontmatter + c.content + '\n';
  }

  parseEntry(fileContent, filePath) {
    const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
      return {
        id: path.basename(filePath, path.extname(filePath)),
        title: path.basename(filePath),
        content: fileContent,
        tags: [],
        category: 'unstructured',
        confidence: 'OBSERVED',
        status: 'ACTIVE',
        filePath
      };
    }
    const meta = parseFrontmatterBlock(match[1]);
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    const verified = Boolean(meta.verified);
    const confidence = meta.confidence || (verified ? 'VERIFIED' : 'OBSERVED');
    const status = meta.status || (tags.includes('superseded') ? 'SUPERSEDED' : 'ACTIVE');
    const last_validated_at = meta.last_validated_at || meta.updated_at || meta.created_at || null;

    return {
      ...meta,
      id: meta.id !== undefined ? String(meta.id) : path.basename(filePath, path.extname(filePath)),
      tags,
      verified,
      confidence,
      status,
      last_validated_at,
      content: match[2],
      filePath
    };
  }

  /** Whether an entry read from `scope` is trusted under the bank's trust policy. */
  isTrusted(entry, scope) {
    if (scope === 'global') return true;
    if (this.workspaceTrust === 'all') return true;
    if (typeof entry.signature !== 'string') return false;
    const can = this.canonical(entry);
    return this.keyring.verify(this.signaturePayload(can), entry.signature) ||
           this.keyring.verify(this.signaturePayloadV1(can), entry.signature);
  }

  /** Decorate a parsed entry with scope/trust, dropping the raw signature. */
  decorate(parsed, scope, size) {
    const { signature, ...rest } = parsed;
    const entry = { ...rest, scope, trusted: this.isTrusted(parsed, scope) };
    if (size !== undefined) entry.size = size;
    return entry;
  }

  /**
   * Run `fn` while holding the memory lock(s) for every writable directory
   * (in-process queue + cross-process lock file). Use for read-modify-write.
   */
  async withLock(fn) {
    await this.init();
    const dirs = [...new Set(this.scopes().map(s => path.resolve(s.dir)))]
      .filter(dir => fsSync.existsSync(dir))
      .sort();
    const acquire = async (i) => {
      if (i >= dirs.length) return fn();
      return runExclusive(dirs[i], async () => {
        const release = await acquireFileLock(dirs[i]);
        try {
          return await acquire(i + 1);
        } finally {
          await release();
        }
      });
    };
    return acquire(0);
  }

  /**
   * Save a memory entry (signed).
   * @param {object} entry
   * @param {'global'|'workspace'} [scope='workspace']
   */
  async save(entry, scope = 'workspace') {
    if (!entry || !entry.id) throw new Error('Memory entry requires an id.');
    await this.init();
    let targetDir;
    if (scope === 'global') targetDir = this.hasGlobalAccess ? this.globalDir : this.workspaceDir;
    else targetDir = this.workspaceDir || (this.hasGlobalAccess ? this.globalDir : null);
    if (!targetDir) {
      throw new Error('No writable memory directory available.');
    }

    const fileName = memoryFileName(entry.id);
    const fullPath = path.join(targetDir, fileName);
    const serialized = this.serializeEntry(entry);
    // Write through a temp file so a crash never leaves a truncated lesson.
    const tmpPath = `${fullPath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    await fs.writeFile(tmpPath, serialized, 'utf-8');
    await fs.rename(tmpPath, fullPath);

    // Migrate away from a legacy (pre-collision-safe) file name for the same id.
    const legacy = legacyMemoryFileName(entry.id);
    if (legacy !== fileName) await fs.unlink(path.join(targetDir, legacy)).catch(() => {});

    return {
      id: entry.id,
      path: fullPath,
      scope: targetDir === this.globalDir ? 'global' : 'workspace',
      sha256: this.sha256(serialized)
    };
  }

  /** Candidate file names for an id (current first, then legacy). */
  fileNamesFor(id) {
    return [...new Set([memoryFileName(id), legacyMemoryFileName(id)])];
  }

  /**
   * Get an entry by id. Workspace shadows global, except that a trusted entry
   * always wins over an untrusted one.
   */
  async get(id, { trustedOnly = false } = {}) {
    let fallback = null;
    for (const { dir, scope } of this.scopes()) {
      for (const filename of this.fileNamesFor(id)) {
        const p = path.join(dir, filename);
        try {
          const text = await fs.readFile(p, 'utf-8');
          const parsed = this.parseEntry(text, p);
          if (parsed.id !== String(id)) continue;
          const entry = this.decorate(parsed, scope);
          if (entry.trusted) return entry;
          fallback = fallback || entry;
        } catch {}
      }
    }
    return trustedOnly ? null : fallback;
  }

  /** Merge an entry into the id-deduplicated result (trusted beats untrusted, then scope order). */
  static addEntry(entries, index, entry) {
    const existing = index.get(entry.id);
    if (existing === undefined) {
      index.set(entry.id, entries.length);
      entries.push(entry);
    } else if (!entries[existing].trusted && entry.trusted) {
      entries[existing] = entry;
    }
  }

  readCached(fullPath, stat, text) {
    const hit = this.cache.get(fullPath);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.parsed;
    if (text === undefined) return undefined;
    const parsed = this.parseEntry(text, fullPath);
    this.cache.set(fullPath, { mtimeMs: stat.mtimeMs, size: stat.size, parsed });
    return parsed;
  }

  /**
   * List all entries across active scopes (async, no directory creation).
   * @param {{trustedOnly?: boolean}} [options]
   */
  async listAll({ trustedOnly = false } = {}) {
    const entries = [];
    const index = new Map();
    for (const { dir, scope } of this.scopes()) {
      let files;
      try {
        files = await fs.readdir(dir);
      } catch {
        continue;
      }
      files.sort();
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const fullPath = path.join(dir, file);
        try {
          const stat = await fs.stat(fullPath);
          if (!stat.isFile() || stat.size > this.maxEntryBytes) continue;
          const parsed = this.readCached(fullPath, stat) ?? this.readCached(fullPath, stat, await fs.readFile(fullPath, 'utf-8'));
          MemoryBank.addEntry(entries, index, this.decorate(parsed, scope, stat.size));
        } catch {}
      }
    }
    return trustedOnly ? entries.filter(e => e.trusted) : entries;
  }

  /**
   * Synchronous variant of listAll() for system-prompt sections, whose text
   * callbacks are resolved synchronously by the DSH prompt assembler.
   * Unchanged files are served from an mtime/size cache.
   */
  listAllSync({ trustedOnly = false } = {}) {
    const entries = [];
    const index = new Map();
    for (const { dir, scope } of this.scopes()) {
      let files;
      try {
        files = fsSync.readdirSync(dir);
      } catch {
        continue;
      }
      files.sort();
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const fullPath = path.join(dir, file);
        try {
          const stat = fsSync.statSync(fullPath);
          if (!stat.isFile() || stat.size > this.maxEntryBytes) continue;
          const parsed = this.readCached(fullPath, stat) ?? this.readCached(fullPath, stat, fsSync.readFileSync(fullPath, 'utf-8'));
          MemoryBank.addEntry(entries, index, this.decorate(parsed, scope, stat.size));
        } catch {}
      }
    }
    return trustedOnly ? entries.filter(e => e.trusted) : entries;
  }

  statsFilePath() {
    const base = this.workspaceDir || this.globalDir;
    return path.join(base, '.rsi', 'stats.json');
  }

  getStatsSync() {
    try {
      const p = this.statsFilePath();
      if (!fsSync.existsSync(p)) return {};
      return JSON.parse(fsSync.readFileSync(p, 'utf-8'));
    } catch {
      return {};
    }
  }

  async getStats() {
    try {
      const p = this.statsFilePath();
      const content = await fs.readFile(p, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  async updateStats(updater) {
    const p = this.statsFilePath();
    let stats = {};
    try {
      const content = await fs.readFile(p, 'utf-8');
      stats = JSON.parse(content);
    } catch {}

    const updated = (await updater(stats)) || stats;
    const dir = path.dirname(p);
    await fs.mkdir(dir, { recursive: true });

    const tmpPath = `${p}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');
    await fs.rename(tmpPath, p);
    return updated;
  }

  /**
   * Record adoption of memory items by verify.
   * Increments hit_count, updates fail_streak, and downgrades to PROBATION when fail_streak >= 2.
   * @param {string|string[]} memoryIds
   * @param {{isPass?: boolean}} [options]
   */
  async recordAdoption(memoryIds, { isPass = true } = {}) {
    if (!memoryIds) return;
    const rawIds = Array.isArray(memoryIds) ? memoryIds : String(memoryIds).split(',');
    const ids = rawIds.map(s => String(s).trim()).filter(Boolean);
    if (ids.length === 0) return;

    return this.updateStats(stats => {
      for (const id of ids) {
        if (!stats[id]) {
          stats[id] = {
            hit_count: 0,
            verification_pass_count: 0,
            verification_fail_count: 0,
            fail_streak: 0,
            status: 'ACTIVE'
          };
        }
        const s = stats[id];
        s.hit_count = (s.hit_count || 0) + 1;
        s.last_hit_at = new Date().toISOString();
        if (isPass) {
          s.verification_pass_count = (s.verification_pass_count || 0) + 1;
          s.fail_streak = 0;
          if (s.status === 'PROBATION') {
            s.status = 'ACTIVE';
          }
        } else {
          s.verification_fail_count = (s.verification_fail_count || 0) + 1;
          s.fail_streak = (s.fail_streak || 0) + 1;
          if (s.fail_streak >= 2) {
            s.status = 'PROBATION';
          }
        }
      }
      return stats;
    });
  }

  filterEntries(all, { query = '', tags = [], category = '' } = {}) {
    const qLower = String(query || '').toLowerCase().trim();
    const tagList = Array.isArray(tags) ? tags : [];
    return all.filter(item => {
      if (category && item.category !== category) return false;
      if (tagList.length > 0) {
        const itemTags = Array.isArray(item.tags) ? item.tags : [];
        if (!tagList.some(t => itemTags.includes(t))) return false;
      }
      if (!qLower) return true;
      const titleMatch = String(item.title || '').toLowerCase().includes(qLower);
      const contentMatch = String(item.content || '').toLowerCase().includes(qLower);
      const tagMatch = (item.tags || []).some(t => String(t).toLowerCase().includes(qLower));
      return titleMatch || contentMatch || tagMatch;
    });
  }

  /**
   * Search entries with BM25F ranking, sidecar utility, and confidence decay.
   * Untrusted workspace entries are excluded unless `includeUntrusted`.
   */
  async search(filter = {}) {
    const all = await this.listAll({ trustedOnly: !filter.includeUntrusted });
    const { query = '', tags = [], category = '', topK } = filter;
    const tagList = Array.isArray(tags) ? tags : [];

    // Filter by category and tags
    const candidates = all.filter(item => {
      if (category && item.category !== category) return false;
      if (tagList.length > 0) {
        const itemTags = Array.isArray(item.tags) ? item.tags : [];
        if (!tagList.some(t => itemTags.includes(t))) return false;
      }
      return true;
    });

    const qStr = String(query || '').trim();
    const stats = await this.getStats();

    if (!qStr) {
      const indexer = new BM25F(candidates);
      const scored = indexer.search('', { stats, topK });
      return scored.map(s => ({ ...s.entry, _score: s.score, _details: s.details }));
    }

    const indexer = new BM25F(candidates);
    const scored = indexer.search(qStr, { stats, topK });
    return scored.map(s => ({ ...s.entry, _score: s.score, _details: s.details }));
  }

  /**
   * Bulk migrate legacy memory entries to modern v0.3 schema.
   */
  async migrate({ trustedOnly = false } = {}) {
    const entries = await this.listAll({ trustedOnly });
    let migratedCount = 0;
    const report = [];

    for (const entry of entries) {
      try {
        const rawText = await fs.readFile(entry.filePath, 'utf-8');
        const hasConfidence = /^confidence:/m.test(rawText);
        const hasStatus = /^status:/m.test(rawText);
        const hasLastValidated = /^last_validated_at:/m.test(rawText);

        if (hasConfidence && hasStatus && hasLastValidated) {
          continue;
        }

        const res = await this.save(entry, entry.scope);
        migratedCount++;
        report.push({ id: entry.id, path: res.path });
      } catch (err) {
        report.push({ id: entry.id, error: err.message });
      }
    }

    return { migratedCount, entries: report };
  }

  /** Re-sign an existing entry after the user has reviewed it (used by `rsi trust`). */
  async trust(id) {
    const entry = await this.get(id);
    if (!entry) return null;
    return this.save(entry, entry.scope);
  }

  async delete(id) {
    let deleted = false;
    for (const { dir } of this.scopes()) {
      for (const filename of this.fileNamesFor(id)) {
        try {
          await fs.unlink(path.join(dir, filename));
          deleted = true;
        } catch {}
      }
    }
    return deleted;
  }

  static summarize(all) {
    return all.map(item => ({
      path: path.basename(item.filePath),
      size: item.size || 0,
      tags: item.tags || [],
      summary: item.title || item.category || ''
    }));
  }

  /** Inventory of trusted entries only (safe for system-prompt injection). */
  async getInventorySummary() {
    return MemoryBank.summarize(await this.listAll({ trustedOnly: true }));
  }

  getInventorySummarySync() {
    return MemoryBank.summarize(this.listAllSync({ trustedOnly: true }));
  }

  async computeTreeSha256() {
    const all = await this.listAll();
    all.sort((a, b) => a.id.localeCompare(b.id));
    const hashes = all.map(entry => `${entry.id}:${this.sha256(entry.content || '')}`);
    return this.sha256(hashes.join('\n'));
  }
}
