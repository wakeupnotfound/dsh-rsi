/**
 * Durable Memory Bank for RSIAgent in DeepSeek Harness.
 * Handles storage, indexing, SHA-256 tree hashing, and retrieval of verified lessons.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export class MemoryBank {
  /**
   * @param {object} [options]
   * @param {string} [options.globalDir]
   * @param {string} [options.workspaceDir]
   */
  constructor(options = {}) {
    this.workspaceDir = options.workspaceDir ? path.join(options.workspaceDir, '.rsi', 'memory') : null;
    this.globalDir = options.globalDir || path.join(os.homedir(), '.dsh', 'storages', 'rsi', 'memory');
    this.hasGlobalAccess = true;
  }

  async init() {
    if (this.hasGlobalAccess) {
      try {
        await fs.mkdir(this.globalDir, { recursive: true });
      } catch (err) {
        // Sandboxed environments may restrict writing outside workspace
        this.hasGlobalAccess = false;
      }
    }
    if (this.workspaceDir) {
      try {
        await fs.mkdir(this.workspaceDir, { recursive: true });
      } catch (err) {
        // Ignored or logged
      }
    }
  }

  /**
   * Calculate SHA256 of text or buffer
   */
  sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Serialize a memory entry with Markdown frontmatter
   */
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

  /**
   * Parse a memory Markdown file
   */
  parseEntry(fileContent, filePath) {
    const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
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

    const rawMeta = match[1];
    const content = match[2];
    const meta = {};

    for (const line of rawMeta.split('\n')) {
      const idx = line.indexOf(':');
      if (idx !== -1) {
        const key = line.slice(0, idx).trim();
        const rawVal = line.slice(idx + 1).trim();
        try {
          meta[key] = JSON.parse(rawVal);
        } catch {
          meta[key] = rawVal;
        }
      }
    }

    return {
      ...meta,
      content,
      filePath
    };
  }

  /**
   * Save a memory entry
   * @param {object} entry
   * @param {'global'|'workspace'} [scope='workspace']
   */
  async save(entry, scope = 'workspace') {
    await this.init();
    let targetDir = (scope === 'workspace' && this.workspaceDir) ? this.workspaceDir : (this.hasGlobalAccess ? this.globalDir : this.workspaceDir);
    if (!targetDir) {
      throw new Error('No writable memory directory available.');
    }

    const filename = `${entry.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    const fullPath = path.join(targetDir, filename);

    const serialized = this.serializeEntry(entry);
    await fs.writeFile(fullPath, serialized, 'utf-8');

    return {
      id: entry.id,
      path: fullPath,
      sha256: this.sha256(serialized)
    };
  }

  /**
   * Get an entry by ID
   */
  async get(id) {
    const filename = `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    if (this.workspaceDir) {
      const wsPath = path.join(this.workspaceDir, filename);
      try {
        const text = await fs.readFile(wsPath, 'utf-8');
        return this.parseEntry(text, wsPath);
      } catch {}
    }

    if (this.hasGlobalAccess) {
      const globalPath = path.join(this.globalDir, filename);
      try {
        const text = await fs.readFile(globalPath, 'utf-8');
        return this.parseEntry(text, globalPath);
      } catch {}
    }

    return null;
  }

  /**
   * List all entries across active scopes
   */
  async listAll() {
    await this.init();
    const entries = [];
    const seenIds = new Set();

    const scanDir = async (dir, scope) => {
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          const fullPath = path.join(dir, file);
          const stat = await fs.stat(fullPath);
          if (!stat.isFile()) continue;

          const text = await fs.readFile(fullPath, 'utf-8');
          const entry = this.parseEntry(text, fullPath);
          entry.scope = scope;
          entry.size = stat.size;

          if (!seenIds.has(entry.id)) {
            seenIds.add(entry.id);
            entries.push(entry);
          }
        }
      } catch {}
    };

    if (this.workspaceDir) {
      await scanDir(this.workspaceDir, 'workspace');
    }
    if (this.hasGlobalAccess) {
      await scanDir(this.globalDir, 'global');
    }

    return entries;
  }

  /**
   * Search entries by text, category, or tags
   */
  async search({ query = '', tags = [], category = '' } = {}) {
    const all = await this.listAll();
    const qLower = query.toLowerCase().trim();

    return all.filter(item => {
      if (category && item.category !== category) return false;
      if (tags.length > 0) {
        const itemTags = Array.isArray(item.tags) ? item.tags : [];
        const hasTag = tags.some(t => itemTags.includes(t));
        if (!hasTag) return false;
      }
      if (!qLower) return true;

      const titleMatch = (item.title || '').toLowerCase().includes(qLower);
      const contentMatch = (item.content || '').toLowerCase().includes(qLower);
      const tagMatch = (item.tags || []).some(t => String(t).toLowerCase().includes(qLower));

      return titleMatch || contentMatch || tagMatch;
    });
  }

  /**
   * Delete an entry
   */
  async delete(id) {
    const filename = `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    let deleted = false;

    if (this.workspaceDir) {
      const wsPath = path.join(this.workspaceDir, filename);
      try {
        await fs.unlink(wsPath);
        deleted = true;
      } catch {}
    }

    if (this.hasGlobalAccess) {
      const globalPath = path.join(this.globalDir, filename);
      try {
        await fs.unlink(globalPath);
        deleted = true;
      } catch {}
    }

    return deleted;
  }

  /**
   * Generate an inventory summary for System Prompt injection
   */
  async getInventorySummary() {
    const all = await this.listAll();
    return all.map(item => ({
      path: path.basename(item.filePath),
      size: item.size || 0,
      tags: item.tags || [],
      summary: item.title || item.category || ''
    }));
  }

  /**
   * Compute tree hash for reproducibility
   */
  async computeTreeSha256() {
    const all = await this.listAll();
    all.sort((a, b) => a.id.localeCompare(b.id));

    const hashes = all.map(entry => {
      const fileSha = this.sha256(entry.content || '');
      return `${entry.id}:${fileSha}`;
    });

    return this.sha256(hashes.join('\n'));
  }
}
