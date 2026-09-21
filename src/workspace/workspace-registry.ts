import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { NixError } from '../shared/errors.js';

export interface RegisteredWorkspace {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RegistryDocument {
  readonly version: 1;
  readonly workspaces: readonly RegisteredWorkspace[];
}

const EMPTY_REGISTRY: RegistryDocument = { version: 1, workspaces: [] };
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

const samePath = (left: string, right: string): boolean =>
  process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

const validateDocument = (value: unknown, path: string): RegistryDocument => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NixError(`Invalid workspace registry: ${path}`, 'WORKSPACE_REGISTRY_INVALID');
  }
  const document = value as Partial<RegistryDocument>;
  if (document.version !== 1 || !Array.isArray(document.workspaces)) {
    throw new NixError(
      `Unsupported or invalid workspace registry: ${path}`,
      'WORKSPACE_REGISTRY_INVALID',
    );
  }
  for (const entry of document.workspaces) {
    const candidate = entry as unknown as Record<string, unknown>;
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof candidate.id !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.path !== 'string' ||
      typeof candidate.createdAt !== 'string' ||
      typeof candidate.updatedAt !== 'string'
    ) {
      throw new NixError(`Invalid workspace entry in: ${path}`, 'WORKSPACE_REGISTRY_INVALID');
    }
  }
  return document as RegistryDocument;
};

export class WorkspaceRegistry {
  public readonly path: string;

  public constructor(storageDirectory: string) {
    this.path = join(resolve(storageDirectory), 'workspaces.json');
  }

  public async list(): Promise<readonly RegisteredWorkspace[]> {
    const document = await this.#load();
    return [...document.workspaces].sort((a, b) => a.name.localeCompare(b.name));
  }

  public async get(nameOrId: string): Promise<RegisteredWorkspace> {
    const normalized = nameOrId.toLowerCase();
    const entry = (await this.#load()).workspaces.find(
      (candidate) => candidate.id === nameOrId || candidate.name.toLowerCase() === normalized,
    );
    if (entry === undefined) {
      throw new NixError(`Workspace is not registered: ${nameOrId}`, 'WORKSPACE_NOT_FOUND');
    }
    return entry;
  }

  public async add(path: string, requestedName?: string): Promise<RegisteredWorkspace> {
    const absolute = resolve(path);
    let canonical: string;
    try {
      if (!(await stat(absolute)).isDirectory()) {
        throw new NixError(`Workspace is not a directory: ${absolute}`, 'INVALID_WORKSPACE');
      }
      canonical = await realpath(absolute);
    } catch (error) {
      if (error instanceof NixError) throw error;
      throw new NixError(`Workspace cannot be opened: ${absolute}`, 'INVALID_WORKSPACE', {
        cause: error,
      });
    }
    const name = requestedName ?? basename(canonical);
    if (!NAME_PATTERN.test(name)) {
      throw new NixError(
        'Workspace name must be 1-64 letters, numbers, dots, underscores, or hyphens.',
        'INVALID_WORKSPACE_NAME',
      );
    }
    const document = await this.#load();
    if (document.workspaces.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
      throw new NixError(`Workspace name is already registered: ${name}`, 'WORKSPACE_EXISTS');
    }
    if (document.workspaces.some((entry) => samePath(entry.path, canonical))) {
      throw new NixError(`Workspace path is already registered: ${canonical}`, 'WORKSPACE_EXISTS');
    }
    const now = new Date().toISOString();
    const entry: RegisteredWorkspace = {
      id: randomUUID(),
      name,
      path: canonical,
      createdAt: now,
      updatedAt: now,
    };
    await this.#save({ version: 1, workspaces: [...document.workspaces, entry] });
    return entry;
  }

  public async remove(nameOrId: string): Promise<RegisteredWorkspace> {
    const document = await this.#load();
    const normalized = nameOrId.toLowerCase();
    const entry = document.workspaces.find(
      (candidate) => candidate.id === nameOrId || candidate.name.toLowerCase() === normalized,
    );
    if (entry === undefined) {
      throw new NixError(`Workspace is not registered: ${nameOrId}`, 'WORKSPACE_NOT_FOUND');
    }
    await this.#save({
      version: 1,
      workspaces: document.workspaces.filter((candidate) => candidate.id !== entry.id),
    });
    return entry;
  }

  async #load(): Promise<RegistryDocument> {
    try {
      return validateDocument(JSON.parse(await readFile(this.path, 'utf8')) as unknown, this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_REGISTRY;
      if (error instanceof SyntaxError) {
        throw new NixError(
          `Invalid JSON in workspace registry: ${this.path}`,
          'WORKSPACE_REGISTRY_INVALID',
          {
            cause: error,
          },
        );
      }
      throw error;
    }
  }

  async #save(document: RegistryDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporaryPath, this.path);
  }
}
