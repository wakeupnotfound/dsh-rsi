/**
 * Allowlist-based probe policy for the RSI Verifier.
 *
 * Probes are NEVER handed to a shell. A probe string is tokenized into argv
 * (supporting '…', "…" and backslash escapes), rejected if it contains any
 * unquoted shell operator (pipes, chaining, redirection, substitution,
 * subshells), and then checked against an explicit allowlist of programs and
 * per-program argument rules. Anything not explicitly allowed is rejected.
 *
 * Test runners (`npm test`, `node --test`, `pytest`, `go test`, ...) execute
 * repository code by design — that is what verification means. They can be
 * disabled with `allowTestRunners: false`.
 */

/** Unquoted characters that imply shell semantics; their presence rejects the probe. */
const SHELL_OPERATORS = new Set(['|', '&', ';', '<', '>', '(', ')', '`', '$', '\n', '\r']);

/** Harmless stream redirections commonly appended by models; stripped before parsing. */
const BENIGN_REDIRECT = /(^|\s)(?:\d?>&\d|&?\d?>{1,2}\s*\/dev\/null|\d?>{1,2}\s*NUL|\d?>{1,2}\s*\$null)(?=\s|$)/gi;

/**
 * Tokenize a probe command into argv without shell expansion.
 * @returns {{argv: string[]} | {error: string}}
 */
export function tokenizeProbe(command) {
  const src = String(command ?? '').replace(BENIGN_REDIRECT, ' ').trim();
  if (!src) return { error: 'empty command' };
  const argv = [];
  let cur = '';
  let has = false;
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote === "'") {
      if (ch === "'") quote = null; else cur += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < src.length && ['"', '\\'].includes(src[i + 1])) cur += src[++i];
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; has = true; continue; }
    if (ch === '\\') {
      if (i + 1 >= src.length) return { error: 'dangling escape' };
      cur += src[++i]; has = true;
      continue;
    }
    if (SHELL_OPERATORS.has(ch)) return { error: `shell operator "${ch === '\n' ? '\\n' : ch}" is not allowed (probes run without a shell)` };
    if (/\s/.test(ch)) {
      if (has) { argv.push(cur); cur = ''; has = false; }
      continue;
    }
    cur += ch; has = true;
  }
  if (quote) return { error: 'unterminated quote' };
  if (has) argv.push(cur);
  if (argv.length === 0) return { error: 'empty command' };
  return { argv };
}

const ok = () => null;
const flagsOnly = args => args.every(a => a.startsWith('-'));
const hasAny = (args, list) => args.find(a => list.some(f => a === f || a.startsWith(f + '=')));
const rejectFlags = list => args => {
  const bad = hasAny(args, list);
  return bad ? `argument "${bad}" is not allowed` : null;
};
const versionOnly = args => (args.length === 1 && ['--version', '-v', '-V', 'version'].includes(args[0]) ? null : 'only --version is allowed');

/** Read-only inspection programs. */
const READ_ONLY = {
  cat: ok, head: ok, wc: ok, stat: ok, file: ok, pwd: ok, echo: ok, which: ok, where: ok,
  uname: ok, basename: ok, dirname: ok, realpath: ok, readlink: ok, cmp: ok, du: ok, df: ok,
  sha256sum: ok, sha1sum: ok, md5sum: ok, shasum: ok, md5: ok, grep: ok, egrep: ok, fgrep: ok,
  findstr: ok, ls: ok, nl: ok, jq: ok, diff: ok,
  tail: rejectFlags(['-f', '-F', '--follow', '--retry']),
  tree: rejectFlags(['-o']),
  sort: rejectFlags(['-o', '--output', '--compress-program']),
  date: rejectFlags(['-s', '--set']),
  rg: rejectFlags(['--pre', '--pre-glob']),
  find: args => {
    const bad = args.find(a => /^-(delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/.test(a));
    return bad ? `find action "${bad}" is not allowed` : null;
  },
  tar: args => {
    if (hasAny(args, ['--to-command', '--use-compress-program', '-I', '--checkpoint-action', '--info-script', '--new-volume-script', '-F', '--rmt-command', '--rsh-command'])) return 'tar option not allowed';
    // Short option letters from every `-abc` cluster plus a bare leading cluster (`tar tzf x`).
    const letters = args
      .filter((a, i) => (a.startsWith('-') && !a.startsWith('--')) || (i === 0 && /^[a-zA-Z]+$/.test(a)))
      .map(a => a.replace(/^-/, ''))
      .join('');
    const listing = args.includes('--list') || letters.includes('t');
    const mutating = /[xcurA]/.test(letters) || args.some(a => /^--(extract|get|create|update|append|delete|concatenate|catenate)$/.test(a));
    return listing && !mutating ? null : 'only tar listing (-t/--list) is allowed';
  },
  unzip: args => (['-l', '-v', '-t', '-Z', '-Zl', '-Z1'].includes(args[0]) ? null : 'only unzip -l/-v/-t/-Z is allowed'),
  git: args => checkGit(args)
};

const GIT_READ_SUBCOMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'ls-files', 'ls-tree', 'rev-parse', 'blame', 'shortlog',
  'describe', 'cat-file', 'rev-list', 'merge-base', 'name-rev', 'whatchanged', 'grep', 'version', '--version'
]);

function checkGit(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    const a = args[i];
    if (a === '-C') { i += 2; continue; }
    if (a === '--no-pager' || a === '--version' || a === '-P') { if (a === '--version') return null; i++; continue; }
    return `git option "${a}" is not allowed`;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub) return 'missing git subcommand';
  if (GIT_READ_SUBCOMMANDS.has(sub)) {
    return rejectFlags(['--output', '--ext-diff', '-O', '--open-files-in-pager', '--exec'])(rest);
  }
  if (sub === 'branch') {
    const bad = rest.find(a => !a.startsWith('-') || /^(-d|-D|-m|-M|-c|-C|-f|-u|--delete|--move|--copy|--force|--set-upstream-to|--unset-upstream|--edit-description|--track|--no-track)(=|$)/.test(a));
    return bad ? `git branch "${bad}" would mutate refs` : null;
  }
  if (sub === 'remote') return rest.length === 0 || (rest.length === 1 && ['-v', '--verbose'].includes(rest[0])) ? null : 'only git remote [-v] is allowed';
  if (sub === 'config') return ['--get', '--get-all', '--get-regexp', '--list', '-l'].includes(rest[0]) ? null : 'only read-only git config queries are allowed';
  if (sub === 'stash' || sub === 'worktree' || sub === 'tag') return rest[0] === 'list' || (sub === 'tag' && rest.length === 0) || (sub === 'stash' && rest[0] === 'show') ? null : `only git ${sub} list is allowed`;
  return `git subcommand "${sub}" is not allowed`;
}

const SAFE_SCRIPT = /^(test|lint|typecheck|type-check|check)(:[\w.-]+)?$/;

function checkPackageManager(args) {
  const [sub, ...rest] = args;
  if (!sub) return 'missing subcommand';
  if (['--version', '-v', 'ls', 'list', 'outdated', 'view', 'info', 'why', 'explain'].includes(sub)) return null;
  if (['test', 't', 'tst'].includes(sub)) return null;
  if (sub === 'run' || sub === 'run-script') return SAFE_SCRIPT.test(rest[0] || '') ? null : 'only test/lint/typecheck/check scripts may be run';
  if (sub === 'audit') return rest.includes('fix') || rest.includes('--fix') ? 'audit fix is not allowed' : null;
  if (sub === 'pack') return rest.includes('--dry-run') ? null : 'only pack --dry-run is allowed';
  if (SAFE_SCRIPT.test(sub)) return null; // yarn/pnpm/bun shorthand: `yarn test`, `pnpm lint`
  return `subcommand "${sub}" is not allowed`;
}

/** Test runners / toolchain checks — these execute repository code. */
const TEST_RUNNERS = {
  npm: checkPackageManager,
  pnpm: checkPackageManager,
  yarn: checkPackageManager,
  bun: args => (args[0] === 'test' ? null : checkPackageManager(args)),
  node: args => {
    if (args.length === 1 && ['--version', '-v'].includes(args[0])) return null;
    if (args[0] === '--test' || args[0] === '--check' || args[0] === '-c') return rejectFlags(['-e', '--eval', '-p', '--print', '-r', '--require', '--import', '--loader', '--experimental-loader'])(args.slice(1));
    return 'only node --version, --check <file> or --test is allowed';
  },
  python: args => checkPython(args),
  python3: args => checkPython(args),
  py: args => checkPython(args),
  pytest: rejectFlags(['-p']),
  go: args => (['test', 'vet', 'version', 'env', 'list'].includes(args[0]) ? null : 'only go test/vet/version/env/list is allowed'),
  cargo: args => (['test', 'check', 'metadata', 'tree', '--version', '-V'].includes(args[0]) ? null : 'only cargo test/check/metadata/tree is allowed'),
  tsc: args => (args.includes('--noEmit') && !hasAny(args, ['--outDir', '--outFile', '--build', '-b', '--watch', '-w']) ? null : 'tsc requires --noEmit'),
  eslint: rejectFlags(['--fix', '--fix-dry-run', '-o', '--output-file', '--cache']),
  prettier: args => (args.includes('--check') || args.includes('-c') || args.includes('--list-different') || args.includes('-l')) && !hasAny(args, ['--write', '-w']) ? null : 'prettier requires --check',
  jest: rejectFlags(['--watch', '--watchAll', '-u', '--updateSnapshot', '--outputFile']),
  vitest: args => (args[0] === 'run' || args.includes('--run')) && !hasAny(args, ['-u', '--update', '--outputFile']) ? null : 'use vitest run',
  mocha: rejectFlags(['--watch', '-w']),
  deno: args => (args[0] === 'test' || args[0] === 'check' || versionOnly(args) === null ? null : 'only deno test/check is allowed'),
  java: versionOnly, javac: versionOnly, ruby: versionOnly, php: versionOnly, gcc: versionOnly, clang: versionOnly, rustc: versionOnly
};

function checkPython(args) {
  if (args.length === 1 && ['--version', '-V'].includes(args[0])) return null;
  if (args[0] === '-m' && ['pytest', 'unittest'].includes(args[1])) return null;
  return 'only python --version, -m pytest or -m unittest is allowed';
}

/** Programs that are batch scripts on Windows and therefore need cmd.exe. */
const WIN_CMD_SHIMS = new Set(['npm', 'pnpm', 'yarn', 'eslint', 'prettier', 'tsc', 'jest', 'vitest', 'mocha', 'pytest']);
/** Arguments safe to pass through cmd.exe (no metacharacters). */
const WIN_SAFE_ARG = /^[\w@.\/\\:=+,-]+$/;

export class ProbePolicy {
  /**
   * @param {object} [options]
   * @param {boolean} [options.allowTestRunners=true] - allow npm test, node --test, pytest, ...
   * @param {string[]} [options.extraPrograms] - additional programs allowed with any arguments (operator-configured)
   * @param {string} [options.platform=process.platform]
   */
  constructor(options = {}) {
    this.allowTestRunners = options.allowTestRunners !== false;
    this.extraPrograms = new Set((options.extraPrograms || []).map(String));
    this.platform = options.platform || process.platform;
  }

  /**
   * Decide whether a probe may run.
   * @returns {{ok: true, file: string, args: string[], shell: boolean} | {ok: false, reason: string}}
   */
  check(command) {
    if (typeof command !== 'string' || !command.trim()) return { ok: false, reason: 'empty command' };
    const tok = tokenizeProbe(command);
    if (tok.error) return { ok: false, reason: tok.error };
    const [rawProgram, ...args] = tok.argv;
    if (/[\\/]/.test(rawProgram)) return { ok: false, reason: 'programs must be referenced by name, not by path' };
    const program = rawProgram.toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
    if (program === 'sudo' || program === 'su' || program === 'doas') return { ok: false, reason: 'privilege escalation is not allowed' };

    let rule = READ_ONLY[program];
    if (!rule && this.allowTestRunners) rule = TEST_RUNNERS[program];
    if (!rule && this.extraPrograms.has(program)) rule = ok;
    if (!rule) return { ok: false, reason: `program "${program}" is not on the read-only probe allowlist` };
    const violation = rule(args);
    if (violation) return { ok: false, reason: violation };

    const needsShell = this.platform === 'win32' && WIN_CMD_SHIMS.has(program);
    if (needsShell && !args.every(a => WIN_SAFE_ARG.test(a))) {
      return { ok: false, reason: 'argument contains characters unsafe for cmd.exe' };
    }
    return { ok: true, file: needsShell ? `${program}.cmd` : rawProgram, args, shell: needsShell };
  }
}

export const DEFAULT_PROBE_POLICY = new ProbePolicy();

/** Exposed for documentation/tests. */
export function allowedPrograms({ allowTestRunners = true } = {}) {
  return [...Object.keys(READ_ONLY), ...(allowTestRunners ? Object.keys(TEST_RUNNERS) : [])].sort();
}
