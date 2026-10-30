/**
 * Minimal in-process stand-in for the DSH workflow engine, used to execute
 * workflow scripts in tests. It mirrors the documented hook contract:
 * agent(prompt, opts) / parallel(thunks) / pipeline(items, ...stages) / phase / log / args.
 */

const ALLOWED = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'oneOf', 'description', 'title', 'default', 'examples']);

/** Collect violations of the DSH enforced JSON Schema subset. */
export function schemaViolations(schema, path = 'schema') {
  const out = [];
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return [`${path} must be an object`];
  for (const key of Object.keys(schema)) if (!ALLOWED.has(key)) out.push(`${path}.${key} unsupported`);
  if (schema.properties) for (const [k, v] of Object.entries(schema.properties)) out.push(...schemaViolations(v, `${path}.properties.${k}`));
  if (schema.items) out.push(...schemaViolations(schema.items, `${path}.items`));
  if (schema.required) for (const r of schema.required) if (!schema.properties || !(r in schema.properties)) out.push(`${path}.required names ${r} not in properties`);
  if ('additionalProperties' in schema && typeof schema.additionalProperties !== 'boolean') out.push(`${path}.additionalProperties must be boolean`);
  return out;
}

/** Shallow structural validation of a value against a schema (types, required, enum, no extras). */
export function valueViolations(schema, value, path = 'value') {
  const out = [];
  const t = schema.type;
  if (t === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${path} must be object`];
    for (const r of schema.required || []) if (!(r in value)) out.push(`${path}.${r} missing`);
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (!sub) { if (schema.additionalProperties === false) out.push(`${path}.${k} not allowed`); continue; }
      out.push(...valueViolations(sub, v, `${path}.${k}`));
    }
  } else if (t === 'array') {
    if (!Array.isArray(value)) return [`${path} must be array`];
    value.forEach((v, i) => out.push(...valueViolations(schema.items || {}, v, `${path}[${i}]`)));
  } else if (t === 'string' && typeof value !== 'string') out.push(`${path} must be string`);
  else if (t === 'boolean' && typeof value !== 'boolean') out.push(`${path} must be boolean`);
  else if (t === 'integer' && !Number.isInteger(value)) out.push(`${path} must be integer`);
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path} not in enum`);
  return out;
}

/**
 * Execute a workflow script.
 * @param {string} script
 * @param {object} args
 * @param {(prompt: string, opts: object, call: number) => any} respond - fake subagent
 */
export async function runWorkflowScript(script, args, respond) {
  const calls = [];
  const phases = [];
  const logs = [];
  const agent = async (prompt, opts = {}) => {
    if (typeof prompt !== 'string' || !prompt) throw new Error('agent() requires a prompt');
    const unknown = Object.keys(opts).filter(k => !['schema', 'label', 'phase', 'provider', 'model'].includes(k));
    if (unknown.length) throw new Error('agent() unknown options: ' + unknown.join(','));
    if (opts.schema) {
      const v = schemaViolations(opts.schema);
      if (v.length || opts.schema.type !== 'object') throw new Error('unsupported schema: ' + v.join('; '));
    }
    const index = calls.length;
    calls.push({ prompt, opts });
    let value;
    try { value = await respond(prompt, opts, index); } catch { return null; }
    if (value == null) return null;
    if (opts.schema) {
      const v = valueViolations(opts.schema, value);
      if (v.length) throw new Error(`fake agent #${index} returned invalid value: ${v.join('; ')}`);
    }
    return JSON.parse(JSON.stringify(value));
  };
  const parallel = thunks => Promise.all(thunks.map(async t => { try { return await t(); } catch { return null; } }));
  const pipeline = (items, ...stages) => Promise.all(items.map(async (item, index) => {
    let prev = item;
    try { for (const stage of stages) prev = await stage(prev, item, index); return prev; } catch { return null; }
  }));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', script);
  const value = await fn(agent, parallel, pipeline, t => phases.push(t), m => logs.push(m), JSON.parse(JSON.stringify(args)));
  return { value: JSON.parse(JSON.stringify(value ?? null)), calls, phases, logs };
}
