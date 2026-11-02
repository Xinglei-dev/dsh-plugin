/**
 * dsh-agents-md — path discovery, the instruction chain, and the write whitelist.
 *
 * The rules here mirror what `@deepseek-ai/dsh-agent-instructions` loads:
 * two user-global roots (`$DSH_HOME/AGENTS.md`, `$DSH_AGENTS_HOME/AGENTS.md`),
 * then every candidate file from the project root down to the session working
 * directory. The project root is the first ancestor holding the `.git` marker;
 * without one, the working directory itself is the root.
 *
 * Everything in this module is pure or takes an injected filesystem, so the
 * tests can run against a temporary directory and never touch `$DSH_HOME`.
 *
 * @module dsh-agents-md/paths
 */
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import nodeFs from 'node:fs/promises';

/** Base candidates DSH loads in every project directory. */
export const INSTRUCTION_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'];

/** Additive local overlays DSH loads after the base candidates. */
export const LOCAL_INSTRUCTION_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md'];

/** Every file name this plugin may read or write in a project directory. */
export const ALL_CANDIDATES = [...INSTRUCTION_CANDIDATES, ...LOCAL_INSTRUCTION_CANDIDATES];

/** Directory name that marks a project root. */
export const PROJECT_ROOT_MARKER = '.git';

/** Largest file the editor reads or writes, in bytes. */
export const MAX_FILE_BYTES = 1024 * 1024;

/** Default directory name of the harness home under the OS home. */
export const DEFAULT_DSH_HOME_DIR = '.dsh';

/** Default directory name of the shared agents root under the OS home. */
export const DEFAULT_AGENTS_HOME_DIR = '.agents';

/**
 * Expand `~`, `~/`, and `~\` against an operating-system home.
 * @param value - configured path that may begin with a tilde prefix.
 * @param home - operating-system home directory.
 * @returns the expanded path, or the original value when no prefix matches.
 */
export function expandHomePath(value, home = homedir()) {
  if (value === '~') return home;
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(home, value.slice(2));
  return value;
}

/**
 * Resolve one home root with the same precedence DSH uses.
 * @param configured - raw environment value, possibly empty.
 * @param fallback - default absolute root.
 * @param home - operating-system home directory.
 * @returns the normalized absolute root.
 */
function resolveRoot(configured, fallback, home) {
  const raw = typeof configured === 'string' ? configured.trim() : '';
  if (raw === '') return path.resolve(fallback);
  return path.resolve(expandHomePath(raw, home));
}

/**
 * Resolve the two user-global roots and the labels the page shows for them.
 *
 * The labels never expose an absolute machine path: the default root keeps its
 * `~/.dsh` spelling, and an overridden root is labeled by its variable name.
 * @param env - environment mapping, usually `process.env`.
 * @param home - operating-system home directory.
 * @returns the resolved roots plus their display labels.
 */
export function resolveHomes(env = process.env, home = homedir()) {
  const defaultDshHome = path.resolve(path.join(home, DEFAULT_DSH_HOME_DIR));
  const defaultAgentsHome = path.resolve(path.join(home, DEFAULT_AGENTS_HOME_DIR));
  const dshHome = resolveRoot(env.DSH_HOME, defaultDshHome, home);
  const agentsHome = resolveRoot(env.DSH_AGENTS_HOME, defaultAgentsHome, home);
  return {
    home: path.resolve(home),
    dshHome,
    agentsHome,
    dshHomeDisplay: dshHome === defaultDshHome ? '~/.dsh' : '$DSH_HOME',
    agentsHomeDisplay: agentsHome === defaultAgentsHome ? '~/.agents' : '$DSH_AGENTS_HOME',
  };
}

/**
 * Whether an entry exists under one path, treating absence as a plain `false`.
 * @param target - absolute path to probe.
 * @param fs - filesystem implementation.
 * @param signal - optional cancellation.
 * @returns true when the entry is present.
 * @throws the original error for failures other than absence.
 */
export async function entryExists(target, fs = nodeFs, signal) {
  try {
    await fs.stat(target, signal === undefined ? undefined : { signal });
    return true;
  } catch (error) {
    signal?.throwIfAborted();
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
}

/**
 * Walk upward to the first directory holding the project-root marker.
 *
 * A missing marker is confirmed by probing each ancestor; an I/O failure other
 * than absence surfaces instead of silently choosing an ancestor.
 * @param startDir - absolute directory where the walk begins.
 * @param options - marker name and injected filesystem.
 * @returns the discovered root and whether a marker proved it.
 */
export async function discoverProjectRoot(startDir, options = {}) {
  const fs = options.fs ?? nodeFs;
  const marker = options.marker ?? PROJECT_ROOT_MARKER;
  const signal = options.signal;
  const start = path.resolve(startDir);
  let current = start;
  for (;;) {
    if (await entryExists(path.join(current, marker), fs, signal)) return { root: current, detected: true };
    const parent = path.dirname(current);
    if (parent === current) return { root: start, detected: false };
    current = parent;
  }
}

/**
 * Build the inclusive root-to-leaf directory chain.
 * @param root - broadest directory, expected to contain the leaf.
 * @param leaf - most specific directory.
 * @returns directories ordered from broadest to most specific.
 */
export function ancestorChain(root, leaf) {
  const resolvedRoot = path.resolve(root);
  const resolvedLeaf = path.resolve(leaf);
  const relation = path.relative(resolvedRoot, resolvedLeaf);
  if (relation.startsWith('..') || path.isAbsolute(relation)) return [resolvedLeaf];
  const chain = [];
  let current = resolvedLeaf;
  while (current !== resolvedRoot) {
    chain.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  chain.push(resolvedRoot);
  return chain.reverse();
}

/**
 * Render an absolute path relative to a root using `/` separators, or `.` for
 * the root itself.
 * @param root - display base.
 * @param target - absolute path under the base.
 * @returns the slash-separated relative path.
 */
export function relativeDisplay(root, target) {
  const relation = path.relative(root, target);
  if (relation === '') return '.';
  return relation.split(path.sep).join('/');
}

/**
 * Whether a path stays inside a parent directory (the parent itself counts).
 * @param parent - absolute or normalized parent path.
 * @param child - absolute or normalized candidate path.
 * @returns true when the candidate does not escape the parent.
 */
export function isPathInside(parent, child) {
  const relation = path.relative(path.resolve(parent), path.resolve(child));
  return relation === '' || (!relation.startsWith('..') && !path.isAbsolute(relation));
}

/**
 * List one project's chain from its root down to the workspace directory.
 * @param workspacePath - absolute workspace directory.
 * @param projectRoot - absolute project root discovered above.
 * @returns levels in broad-to-specific order, each with the joinable path.
 */
export function projectLevels(workspacePath, projectRoot) {
  return ancestorChain(projectRoot, workspacePath).map((dir) => ({
    dir,
    relDir: relativeDisplay(projectRoot, dir),
  }));
}

/**
 * The absolute path of one candidate file inside a directory.
 * @param dir - absolute directory.
 * @param name - candidate file name.
 * @returns the joined absolute path.
 */
export function candidatePath(dir, name) {
  return path.join(dir, name);
}

/**
 * The two user-global files this plugin edits.
 * @param homes - value returned by {@link resolveHomes}.
 * @returns ordered global targets in DSH load order.
 */
export function globalTargets(homes) {
  return [
    {
      scope: 'global-dsh',
      name: 'AGENTS.md',
      path: candidatePath(homes.dshHome, 'AGENTS.md'),
      display: `${homes.dshHomeDisplay}/AGENTS.md`,
    },
    {
      scope: 'global-agents',
      name: 'AGENTS.md',
      path: candidatePath(homes.agentsHome, 'AGENTS.md'),
      display: `${homes.agentsHomeDisplay}/AGENTS.md`,
    },
  ];
}

/**
 * Hash file content the same way both halves of the plugin identify a version.
 * @param content - UTF-8 text.
 * @returns lowercase SHA-256 hex.
 */
export function hashContent(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Read one instruction file with a hard byte ceiling.
 * @param target - absolute file path.
 * @param options - injected filesystem and maximum size.
 * @returns presence, content, size, and modification time.
 * @throws an error with `code: 'TOO_LARGE'` when the file exceeds the ceiling.
 */
export async function readInstructionFile(target, options = {}) {
  const fs = options.fs ?? nodeFs;
  const maxBytes = options.maxBytes ?? MAX_FILE_BYTES;
  let info;
  try {
    info = await fs.stat(target);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { exists: false, content: '', size: 0, mtimeMs: null, hash: null };
    }
    throw error;
  }
  if (!info.isFile()) return { exists: false, content: '', size: 0, mtimeMs: null, hash: null };
  if (info.size > maxBytes) {
    const error = new Error(`"${target}" is ${String(info.size)} bytes; the editor accepts at most ${String(maxBytes)}`);
    error.code = 'TOO_LARGE';
    throw error;
  }
  const content = await fs.readFile(target, 'utf8');
  return {
    exists: true,
    content,
    size: Buffer.byteLength(content, 'utf8'),
    mtimeMs: typeof info.mtimeMs === 'number' ? info.mtimeMs : null,
    hash: hashContent(content),
  };
}

/**
 * Write one instruction file through a temporary sibling and a rename.
 *
 * On platforms where a rename cannot replace an existing file, the write falls
 * back to a direct write after the temporary file is removed.
 * @param target - absolute file path.
 * @param content - complete new UTF-8 text.
 * @param options - injected filesystem, inherited mode, and byte ceiling.
 * @returns the written size and modification time.
 */
export async function writeInstructionFile(target, content, options = {}) {
  const fs = options.fs ?? nodeFs;
  const maxBytes = options.maxBytes ?? MAX_FILE_BYTES;
  const size = Buffer.byteLength(content, 'utf8');
  if (size > maxBytes) {
    const error = new Error(`the new content is ${String(size)} bytes; the editor accepts at most ${String(maxBytes)}`);
    error.code = 'TOO_LARGE';
    throw error;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  let mode;
  try {
    mode = (await fs.stat(target)).mode & 0o777;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temporary = `${target}.dsh-agents-md-${String(process.pid)}-${randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, { encoding: 'utf8', ...(mode === undefined ? {} : { mode }) });
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    await fs.writeFile(target, content, { encoding: 'utf8', ...(mode === undefined ? {} : { mode }) });
    await fs.rm(temporary, { force: true });
  }
  const info = await fs.stat(target);
  return {
    size: Buffer.byteLength(content, 'utf8'),
    mtimeMs: typeof info.mtimeMs === 'number' ? info.mtimeMs : null,
  };
}

/**
 * Prove a write target stays under one allowed root and is not a symlink.
 *
 * The parent directory is resolved after it exists, so a symlinked directory
 * cannot redirect the write outside the whitelist.
 * @param target - absolute file path about to be written.
 * @param roots - allowed absolute roots.
 * @param options - injected filesystem.
 * @throws an error with `code: 'OUTSIDE'` or `'SYMLINK'` on refusal.
 */
export async function assertWritableTarget(target, roots, options = {}) {
  const fs = options.fs ?? nodeFs;
  const parent = path.dirname(target);
  const parentReal = await fs.realpath(parent);
  const realRoots = [];
  for (const root of roots) {
    try {
      realRoots.push(await fs.realpath(root));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      realRoots.push(path.resolve(root));
    }
  }
  if (!realRoots.some((root) => isPathInside(root, parentReal))) {
    const error = new Error(`"${target}" resolves outside the allowed roots`);
    error.code = 'OUTSIDE';
    throw error;
  }
  try {
    const info = await fs.lstat(target);
    if (info.isSymbolicLink()) {
      const error = new Error(`"${target}" is a symbolic link; edit the target file instead`);
      error.code = 'SYMLINK';
      throw error;
    }
    if (info.isDirectory()) {
      const error = new Error(`"${target}" is a directory, not an instruction file`);
      error.code = 'NOT_FILE';
      throw error;
    }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return;
    throw error;
  }
}
