/**
 * Durable Memory Bank for RSIAgent in DeepSeek Harness.
 * Handles storage, indexing, SHA-256 tree hashing, and retrieval of verified lessons.
 *
 * Reads never create directories: prompt assembly and queries must stay side-effect
 * free. Directories are created lazily on the first write.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** Map a memory id onto its on-disk file name with cross-platform safety. */
export function memoryFileName(id) {
  let safe = String(id).replace(/[^\p{Letter}\p{Number}_-]/gu, '_');
  if (WINDOWS_RESERVED.test(safe)) {
    safe = `_${safe}`;
  }
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

export class MemoryBank {
  /**
   * @param {object} [options]
   * @param {string} [options.globalDir] - global memory directory (default ~/.dsh/storages/rsi/memory)
   * @param {string} [options.workspaceDir] - workspace root; memory lives in <workspace>/.rsi/memory
   */
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceDir || null;
    this.workspaceDir = options.workspaceDir ? path.join(options.workspaceDir, '.rsi', 'memory') : null;
    this.globalDir = options.globalDir || path.join(os.homedir(), '.dsh', 'storages', 'rsi', 'memory');
    this.hasGlobalAccess = true;
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

  serializeEntry(entry) {
    const frontmatter = [
      '---',
      `id: ${JSON.stringify(entry.id)}`,
      `title: ${JSON.stringify(entry.title || entry.id)}`,
      `category: ${JSON.stringify(entry.category || 'general')}`,
      `tags: ${JSON.stringify(entry.tags || [])}`,
      `verified: ${Boolean(entry.verified)}`,
      `created_at: ${JSON.stringify(entry.created_at || new Date().toISOString())}`,
      `updated_at: ${JSON.stringify(new Date().toISOString())}`,
      '---',
      ''
    ].join('\n');

    return frontmatter + (entry.content || '').trim() + '\n';
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
        filePath
      };
    }
    const meta = parseFrontmatterBlock(match[1]);
    return {
      ...meta,
      id: meta.id !== undefined ? String(meta.id) : path.basename(filePath, path.extname(filePath)),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      content: match[2],
      filePath
    };
  }

  /**
   * Save a memory entry.
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

    const fullPath = path.join(targetDir, memoryFileName(entry.id));
    const serialized = this.serializeEntry(entry);
    // Write through a temp file so a crash never leaves a truncated lesson.
    const tmpPath = `${fullPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, serialized, 'utf-8');
    await fs.rename(tmpPath, fullPath);

    return {
      id: entry.id,
      path: fullPath,
      scope: targetDir === this.globalDir ? 'global' : 'workspace',
      sha256: this.sha256(serialized)
    };
  }

  /** Get an entry by id (workspace shadows global). */
  async get(id) {
    const filename = memoryFileName(id);
    for (const { dir, scope } of this.scopes()) {
      const p = path.join(dir, filename);
      try {
        const text = await fs.readFile(p, 'utf-8');
        const entry = this.parseEntry(text, p);
        entry.scope = scope;
        return entry;
      } catch {}
    }
    return null;
  }

  /** List all entries across active scopes (async, no directory creation). */
  async listAll() {
    const entries = [];
    const seenIds = new Set();
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
          if (!stat.isFile()) continue;
          const entry = this.parseEntry(await fs.readFile(fullPath, 'utf-8'), fullPath);
          entry.scope = scope;
          entry.size = stat.size;
          if (!seenIds.has(entry.id)) {
            seenIds.add(entry.id);
            entries.push(entry);
          }
        } catch {}
      }
    }
    return entries;
  }

  /**
   * Synchronous variant of listAll() for system-prompt sections, whose text
   * callbacks are resolved synchronously by the DSH prompt assembler.
   * Reads the memory directory synchronously without directory-creation side effects.
   */
  listAllSync() {
    const entries = [];
    const seenIds = new Set();
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
          if (!stat.isFile()) continue;
          const entry = this.parseEntry(fsSync.readFileSync(fullPath, 'utf-8'), fullPath);
          entry.scope = scope;
          entry.size = stat.size;
          if (!seenIds.has(entry.id)) {
            seenIds.add(entry.id);
            entries.push(entry);
          }
        } catch {}
      }
    }
    return entries;
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

  async search(filter = {}) {
    return this.filterEntries(await this.listAll(), filter);
  }

  async delete(id) {
    const filename = memoryFileName(id);
    let deleted = false;
    for (const { dir } of this.scopes()) {
      try {
        await fs.unlink(path.join(dir, filename));
        deleted = true;
      } catch {}
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

  async getInventorySummary() {
    return MemoryBank.summarize(await this.listAll());
  }

  getInventorySummarySync() {
    return MemoryBank.summarize(this.listAllSync());
  }

  async computeTreeSha256() {
    const all = await this.listAll();
    all.sort((a, b) => a.id.localeCompare(b.id));
    const hashes = all.map(entry => `${entry.id}:${this.sha256(entry.content || '')}`);
    return this.sha256(hashes.join('\n'));
  }
}
