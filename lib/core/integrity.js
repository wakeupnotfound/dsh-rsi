/**
 * Local integrity keys for dsh-rsi.
 *
 * A per-user secret (stored outside any workspace, default
 * ~/.dsh/storages/rsi/.integrity-key, mode 0600) is used to:
 *  - sign memory entries written by this plugin, so files planted in a cloned
 *    repository's `.rsi/memory` are recognised as untrusted and never injected
 *    into the system prompt;
 *  - issue verification receipts from `rsi_verify`, so `rsi_distill_memory`
 *    can only mark a lesson as verified when the verdict was actually parsed
 *    by the verifier runtime.
 *
 * When the key file cannot be written (sandbox), an in-process ephemeral key is
 * used: signatures and receipts then remain valid only for this process.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const DEFAULT_KEY_FILE = path.join(os.homedir(), '.dsh', 'storages', 'rsi', '.integrity-key');

const keyrings = new Map();

export class Keyring {
  constructor(keyFile = DEFAULT_KEY_FILE) {
    this.keyFile = keyFile;
    this.key = null;
    this.ephemeral = false;
  }

  /** Shared keyring per key file, so memory banks and receipts agree within a process. */
  static for(keyFile = DEFAULT_KEY_FILE) {
    const resolved = path.resolve(keyFile);
    if (!keyrings.has(resolved)) keyrings.set(resolved, new Keyring(resolved));
    return keyrings.get(resolved);
  }

  /**
   * Load the key. With `create: false` (read paths) a missing key returns null
   * and nothing is written to disk.
   */
  getKey({ create = false } = {}) {
    if (this.key) return this.key;
    try {
      const hex = fs.readFileSync(this.keyFile, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        this.key = Buffer.from(hex, 'hex');
        return this.key;
      }
    } catch {}
    if (!create) return null;
    const fresh = crypto.randomBytes(32);
    try {
      fs.mkdirSync(path.dirname(this.keyFile), { recursive: true });
      // 'wx' never clobbers a key created concurrently by another process.
      fs.writeFileSync(this.keyFile, fresh.toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
      this.key = fresh;
    } catch (err) {
      if (err?.code === 'EEXIST') return this.getKey({ create: false }) || this.useEphemeral(fresh);
      this.useEphemeral(fresh);
    }
    return this.key;
  }

  useEphemeral(key) {
    this.key = key;
    this.ephemeral = true;
    return key;
  }

  sign(payload, { create = false } = {}) {
    const key = this.getKey({ create });
    if (!key) return null;
    return crypto.createHmac('sha256', key).update(String(payload)).digest('hex');
  }

  verify(payload, signature) {
    if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
    const expected = this.sign(payload);
    if (!expected) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  }
}

const sha256 = s => crypto.createHash('sha256').update(String(s ?? '')).digest('hex');

export function normalizeTarget(target) {
  return String(target ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

/**
 * Issue a receipt binding a parsed verdict to the exact report text and target.
 * Format: base64url(JSON{id,v,h,t,th}).hmac
 */
export function createReceipt(keyring, { verdict, report, target, receiptId, createdAt }) {
  const t = typeof createdAt === 'number' ? createdAt : Date.now();
  const id = receiptId || `rcpt_${t}_${crypto.randomBytes(4).toString('hex')}`;
  const payload = {
    id,
    v: verdict,
    h: sha256(report),
    t
  };
  if (target !== undefined && target !== null && String(target).trim()) {
    payload.th = sha256(normalizeTarget(target));
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = keyring.sign(`receipt:${body}`, { create: true });
  return `${body}.${sig}`;
}

/**
 * Validate a receipt; returns `{ valid, receiptId?, verdict?, reportSha?, targetHash?, issuedAt?, reportMatches?, reason? }`.
 * Enforces HMAC signature, 24-hour expiration, and target binding when provided.
 */
export function verifyReceipt(keyring, receipt, { report, target, maxAgeMs = 24 * 3600 * 1000 } = {}) {
  if (typeof receipt !== 'string' || !receipt.includes('.')) return { valid: false, reason: 'missing or malformed receipt' };
  const [body, sig] = receipt.split('.');
  if (!keyring.verify(`receipt:${body}`, sig)) return { valid: false, reason: 'receipt signature invalid (not issued by this rsi_verify runtime)' };
  let data;
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { valid: false, reason: 'receipt payload unreadable' }; }
  if (!['PASS', 'FAIL', 'UNVERIFIED'].includes(data?.v)) return { valid: false, reason: 'receipt verdict unknown' };

  // Check 24-hour expiration
  const age = Date.now() - (Number(data?.t) || 0);
  if (maxAgeMs && age > maxAgeMs) {
    return {
      valid: false,
      reason: `receipt expired (age: ${Math.round(age / 3600000)}h, max allowed: ${Math.round(maxAgeMs / 3600000)}h)`
    };
  }

  // Check target binding if target is specified
  if (target !== undefined && target !== null && String(target).trim()) {
    const expectedHash = sha256(normalizeTarget(target));
    if (!data.th) {
      return { valid: false, reason: 'receipt lacks target binding (th)' };
    }
    if (data.th !== expectedHash) {
      return { valid: false, reason: 'receipt target mismatch (receipt was issued for a different target)' };
    }
  }

  const reportMatches = typeof report === 'string' && report.trim() ? sha256(report) === data.h : null;
  return {
    valid: true,
    receiptId: data.id,
    verdict: data.v,
    reportSha: data.h,
    targetHash: data.th,
    issuedAt: data.t,
    reportMatches
  };
}
