/**
 * dsh-agents-md — the state the settings page renders.
 *
 * The page needs to know which instruction files exist, where they sit in the
 * load chain, and how large they are. It does not need their contents: those
 * are fetched per file so a large AGENTS.md never rides along with every
 * workspace switch.
 *
 * @module dsh-agents-md/state
 */
import nodeFs from 'node:fs/promises';
import {
  ALL_CANDIDATES,
  INSTRUCTION_CANDIDATES,
  MAX_FILE_BYTES,
  candidatePath,
  discoverProjectRoot,
  entryExists,
  globalTargets,
  projectLevels,
} from './paths.js';

/**
 * Probe one file without reading it.
 * @param target - absolute file path.
 * @param fs - filesystem implementation.
 * @returns presence and byte size.
 */
async function fileInfo(target, fs) {
  try {
    const info = await fs.stat(target);
    if (!info.isFile()) return { exists: false, size: 0 };
    return { exists: true, size: typeof info.size === 'number' ? info.size : 0 };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { exists: false, size: 0 };
    throw error;
  }
}

/**
 * Describe the two user-global instruction files.
 * @param homes - resolved home roots.
 * @param fs - filesystem implementation.
 * @returns one entry per global target, in load order.
 */
export async function buildGlobalState(homes, fs = nodeFs) {
  const targets = globalTargets(homes);
  return Promise.all(targets.map(async (target) => ({
    scope: target.scope,
    name: target.name,
    path: target.path,
    display: target.display,
    ...await fileInfo(target.path, fs),
  })));
}

/**
 * Describe one project's instruction chain.
 *
 * `AGENTS.md` is always listed (it is the file the page most often creates);
 * every other candidate is listed only when it already exists, matching what
 * DSH would actually load there.
 * @param workspace - workspace id and absolute directory.
 * @param fs - filesystem implementation.
 * @returns the project root, chain levels, and per-level candidate files.
 */
export async function buildProjectState(workspace, fs = nodeFs) {
  const workspacePath = workspace.path;
  if (!await entryExists(workspacePath, fs)) {
    return {
      workspaceId: workspace.id,
      workspacePath,
      available: false,
      reason: 'missing',
      projectRoot: workspacePath,
      rootDetected: false,
      levels: [],
    };
  }
  const discovered = await discoverProjectRoot(workspacePath, { fs });
  const levels = projectLevels(workspacePath, discovered.root);
  const described = await Promise.all(levels.map(async (level) => {
    const files = await Promise.all(ALL_CANDIDATES.map(async (name) => {
      const info = await fileInfo(candidatePath(level.dir, name), fs);
      return { name, ...info };
    }));
    return {
      relDir: level.relDir,
      dir: level.dir,
      files: files.filter((file) => file.name === 'AGENTS.md' || file.exists),
    };
  }));
  return {
    workspaceId: workspace.id,
    workspacePath,
    available: true,
    projectRoot: discovered.root,
    rootDetected: discovered.detected,
    levels: described,
  };
}

/**
 * Assemble the complete state response.
 * @param options - homes, optional workspace, and an injected filesystem.
 * @returns the JSON body the page consumes.
 */
export async function buildState(options) {
  const fs = options.fs ?? nodeFs;
  const global = await buildGlobalState(options.homes, fs);
  const project = options.workspace === undefined
    ? null
    : await buildProjectState(options.workspace, fs);
  return {
    homes: {
      dshHomeDisplay: options.homes.dshHomeDisplay,
      agentsHomeDisplay: options.homes.agentsHomeDisplay,
    },
    global,
    project,
    candidates: ALL_CANDIDATES,
    baseCandidates: INSTRUCTION_CANDIDATES,
    maxBytes: MAX_FILE_BYTES,
  };
}
