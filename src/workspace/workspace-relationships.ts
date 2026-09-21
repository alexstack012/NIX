import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { NixError } from '../shared/errors.js';

export type WorkspaceAccess = 'consult' | 'modify';

export interface WorkspaceRelationship {
  readonly id: string;
  readonly fromWorkspaceId: string;
  readonly toWorkspaceId: string;
  readonly access: WorkspaceAccess;
  readonly createdAt: string;
}

interface RelationshipDocument {
  readonly version: 1;
  readonly relationships: readonly WorkspaceRelationship[];
}

const EMPTY: RelationshipDocument = { version: 1, relationships: [] };

const validate = (value: unknown, path: string): RelationshipDocument => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NixError(
      `Invalid workspace relationships: ${path}`,
      'WORKSPACE_RELATIONSHIPS_INVALID',
    );
  }
  const document = value as Partial<RelationshipDocument>;
  if (document.version !== 1 || !Array.isArray(document.relationships)) {
    throw new NixError(
      `Unsupported workspace relationships: ${path}`,
      'WORKSPACE_RELATIONSHIPS_INVALID',
    );
  }
  for (const relationship of document.relationships) {
    const entry = relationship as unknown as Record<string, unknown>;
    if (
      typeof entry.id !== 'string' ||
      typeof entry.fromWorkspaceId !== 'string' ||
      typeof entry.toWorkspaceId !== 'string' ||
      (entry.access !== 'consult' && entry.access !== 'modify') ||
      typeof entry.createdAt !== 'string'
    ) {
      throw new NixError(
        `Invalid workspace relationship entry: ${path}`,
        'WORKSPACE_RELATIONSHIPS_INVALID',
      );
    }
  }
  return document as RelationshipDocument;
};

export class WorkspaceRelationshipRegistry {
  public readonly path: string;

  public constructor(storageDirectory: string) {
    this.path = join(resolve(storageDirectory), 'relationships.json');
  }

  public async list(fromWorkspaceId?: string): Promise<readonly WorkspaceRelationship[]> {
    const relationships = (await this.#load()).relationships;
    return relationships
      .filter((entry) => fromWorkspaceId === undefined || entry.fromWorkspaceId === fromWorkspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  public async grant(
    fromWorkspaceId: string,
    toWorkspaceId: string,
    access: WorkspaceAccess,
  ): Promise<WorkspaceRelationship> {
    if (fromWorkspaceId === toWorkspaceId) {
      throw new NixError(
        'A workspace cannot grant access to itself.',
        'WORKSPACE_RELATIONSHIP_INVALID',
      );
    }
    const document = await this.#load();
    const existing = document.relationships.find(
      (entry) =>
        entry.fromWorkspaceId === fromWorkspaceId &&
        entry.toWorkspaceId === toWorkspaceId &&
        entry.access === access,
    );
    if (existing !== undefined) return existing;
    const relationship: WorkspaceRelationship = {
      id: randomUUID(),
      fromWorkspaceId,
      toWorkspaceId,
      access,
      createdAt: new Date().toISOString(),
    };
    await this.#save({ version: 1, relationships: [...document.relationships, relationship] });
    return relationship;
  }

  public async revoke(
    fromWorkspaceId: string,
    toWorkspaceId: string,
    access: WorkspaceAccess,
  ): Promise<boolean> {
    const document = await this.#load();
    const remaining = document.relationships.filter(
      (entry) =>
        !(
          entry.fromWorkspaceId === fromWorkspaceId &&
          entry.toWorkspaceId === toWorkspaceId &&
          entry.access === access
        ),
    );
    if (remaining.length === document.relationships.length) return false;
    await this.#save({ version: 1, relationships: remaining });
    return true;
  }

  public async canConsult(fromWorkspaceId: string, toWorkspaceId: string): Promise<boolean> {
    return (await this.#load()).relationships.some(
      (entry) => entry.fromWorkspaceId === fromWorkspaceId && entry.toWorkspaceId === toWorkspaceId,
    );
  }

  public async canModify(fromWorkspaceId: string, toWorkspaceId: string): Promise<boolean> {
    return (await this.#load()).relationships.some(
      (entry) =>
        entry.fromWorkspaceId === fromWorkspaceId &&
        entry.toWorkspaceId === toWorkspaceId &&
        entry.access === 'modify',
    );
  }

  async #load(): Promise<RelationshipDocument> {
    try {
      return validate(JSON.parse(await readFile(this.path, 'utf8')) as unknown, this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
      if (error instanceof SyntaxError) {
        throw new NixError(
          `Invalid JSON in workspace relationships: ${this.path}`,
          'WORKSPACE_RELATIONSHIPS_INVALID',
          { cause: error },
        );
      }
      throw error;
    }
  }

  async #save(document: RelationshipDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporary, this.path);
  }
}
