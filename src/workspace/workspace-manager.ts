import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { NixError } from '../shared/errors.js';

const BLOCKED_SEGMENTS = new Set(['.git', 'node_modules']);

export class WorkspaceManager {
  public readonly root: string;
  readonly #canonicalRoot: string;

  private constructor(root: string, canonicalRoot: string) {
    this.root = root;
    this.#canonicalRoot = canonicalRoot;
  }

  public static async create(root: string): Promise<WorkspaceManager> {
    const absolute = resolve(root);
    const info = await stat(absolute);
    if (!info.isDirectory()) {
      throw new NixError(`Workspace is not a directory: ${absolute}`, 'INVALID_WORKSPACE');
    }
    return new WorkspaceManager(absolute, await realpath(absolute));
  }

  public async resolveExisting(userPath = '.'): Promise<string> {
    if (isAbsolute(userPath)) {
      throw new NixError('Tool paths must be relative to the workspace.', 'WORKSPACE_PATH_DENIED');
    }
    this.#assertSegmentsAllowed(userPath);
    const candidate = resolve(this.root, userPath);
    this.#assertContained(candidate);
    let canonical: string;
    try {
      canonical = await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NixError(`Path does not exist: ${userPath}`, 'PATH_NOT_FOUND', { cause: error });
      }
      throw error;
    }
    this.#assertContained(canonical, this.#canonicalRoot);
    return candidate;
  }

  public async resolveForWrite(userPath: string): Promise<string> {
    if (isAbsolute(userPath)) {
      throw new NixError('Tool paths must be relative to the workspace.', 'WORKSPACE_PATH_DENIED');
    }
    this.#assertSegmentsAllowed(userPath);
    const candidate = resolve(this.root, userPath);
    this.#assertContained(candidate);
    try {
      await stat(candidate);
      return await this.resolveExisting(userPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const safeParent = await this.resolveExisting(this.relativePath(dirname(candidate)));
    if (!(await stat(safeParent)).isDirectory()) {
      throw new NixError('Write target parent is not a directory.', 'PATH_TYPE_INVALID');
    }
    return candidate;
  }

  public relativePath(absolutePath: string): string {
    this.#assertContained(absolutePath);
    const result = relative(this.root, absolutePath);
    return result === '' ? '.' : result.split(sep).join('/');
  }

  public isIgnoredName(name: string): boolean {
    return BLOCKED_SEGMENTS.has(name) || ['dist', 'build', 'coverage', '.nix'].includes(name);
  }

  #assertSegmentsAllowed(path: string): void {
    const segments = path.replaceAll('\\', '/').split('/');
    if (segments.some((segment) => BLOCKED_SEGMENTS.has(segment))) {
      throw new NixError(`Access to protected path is denied: ${path}`, 'WORKSPACE_PATH_DENIED');
    }
  }

  #assertContained(path: string, root = this.root): void {
    const comparison = process.platform === 'win32' ? path.toLowerCase() : path;
    const comparisonRoot = process.platform === 'win32' ? root.toLowerCase() : root;
    const fromRoot = relative(comparisonRoot, comparison);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new NixError(`Path escapes the workspace: ${path}`, 'WORKSPACE_PATH_DENIED');
    }
  }
}
