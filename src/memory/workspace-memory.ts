import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';

import { NixError } from '../shared/errors.js';
import {
  MEMORY_KINDS,
  MEMORY_STATUSES,
  type AddWorkspaceMemoryInput,
  type ListWorkspaceMemoryOptions,
  type WorkspaceMemoryEntry,
  type WorkspaceMemoryKind,
  type WorkspaceMemoryStatus,
} from './types.js';

const value = (row: Record<string, SQLOutputValue>, name: string): SQLOutputValue | undefined =>
  row[name];
const requiredString = (row: Record<string, SQLOutputValue>, name: string): string => {
  const result = value(row, name);
  if (typeof result !== 'string')
    throw new NixError(`Invalid memory database column: ${name}`, 'MEMORY_DATABASE_INVALID');
  return result;
};
const optionalString = (row: Record<string, SQLOutputValue>, name: string): string | undefined => {
  const result = value(row, name);
  if (result === null || result === undefined) return undefined;
  if (typeof result !== 'string')
    throw new NixError(`Invalid memory database column: ${name}`, 'MEMORY_DATABASE_INVALID');
  return result;
};
const rowToEntry = (row: Record<string, SQLOutputValue>): WorkspaceMemoryEntry => {
  const confidenceValue = value(row, 'confidence');
  const commitHash = optionalString(row, 'commit_hash');
  if (
    confidenceValue !== null &&
    confidenceValue !== undefined &&
    typeof confidenceValue !== 'number'
  ) {
    throw new NixError('Invalid memory confidence value.', 'MEMORY_DATABASE_INVALID');
  }
  return {
    id: requiredString(row, 'id'),
    workspaceId: requiredString(row, 'workspace_id'),
    kind: requiredString(row, 'kind') as WorkspaceMemoryKind,
    content: requiredString(row, 'content'),
    source: requiredString(row, 'source'),
    createdAt: requiredString(row, 'created_at'),
    updatedAt: requiredString(row, 'updated_at'),
    ...(commitHash === undefined ? {} : { commitHash }),
    ...(confidenceValue === null || confidenceValue === undefined
      ? {}
      : { confidence: confidenceValue }),
    status: requiredString(row, 'status') as WorkspaceMemoryStatus,
  };
};

const validateLimit = (limit = 100): number => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new NixError('Memory result limit must be from 1 to 1000.', 'MEMORY_INPUT_INVALID');
  }
  return limit;
};

export class WorkspaceMemory implements Disposable {
  readonly #database: DatabaseSync;
  public readonly path: string;

  private constructor(path: string) {
    this.path = path;
    this.#database = new DatabaseSync(path);
    this.#database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const version = this.#database.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1) {
      this.#database.close();
      throw new NixError(
        `Unsupported workspace memory schema version: ${String(version)}`,
        'MEMORY_DATABASE_INVALID',
      );
    }
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_memory (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('architecture','convention','decision','known_issue','dependency')),
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        commit_hash TEXT,
        confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        status TEXT NOT NULL CHECK (status IN ('active','deprecated','superseded'))
      );
      CREATE INDEX IF NOT EXISTS workspace_memory_scope ON workspace_memory(workspace_id, status, kind);
    `);
    if (version === 0) this.#database.exec('PRAGMA user_version = 1;');
  }

  public static async open(storageDirectory: string): Promise<WorkspaceMemory> {
    const directory = resolve(storageDirectory);
    await mkdir(directory, { recursive: true });
    return new WorkspaceMemory(join(directory, 'memory.sqlite'));
  }

  public add(input: AddWorkspaceMemoryInput): WorkspaceMemoryEntry {
    if (
      !(MEMORY_KINDS as readonly string[]).includes(input.kind) ||
      input.content.trim() === '' ||
      input.source.trim() === ''
    ) {
      throw new NixError(
        'Memory kind, content, and source must be valid and non-empty.',
        'MEMORY_INPUT_INVALID',
      );
    }
    if (
      input.confidence !== undefined &&
      (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
    ) {
      throw new NixError('Memory confidence must be between 0 and 1.', 'MEMORY_INPUT_INVALID');
    }
    const status = input.status ?? 'active';
    if (!(MEMORY_STATUSES as readonly string[]).includes(status))
      throw new NixError('Invalid memory status.', 'MEMORY_INPUT_INVALID');
    const now = new Date().toISOString();
    const entry: WorkspaceMemoryEntry = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      kind: input.kind,
      content: input.content.trim(),
      source: input.source.trim(),
      createdAt: now,
      updatedAt: now,
      ...(input.commitHash === undefined ? {} : { commitHash: input.commitHash }),
      ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
      status,
    };
    this.#database
      .prepare(
        `INSERT INTO workspace_memory (id, workspace_id, kind, content, source, created_at, updated_at, commit_hash, confidence, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.workspaceId,
        entry.kind,
        entry.content,
        entry.source,
        entry.createdAt,
        entry.updatedAt,
        entry.commitHash ?? null,
        entry.confidence ?? null,
        entry.status,
      );
    return entry;
  }

  public list(
    workspaceId: string,
    options: ListWorkspaceMemoryOptions = {},
  ): readonly WorkspaceMemoryEntry[] {
    const clauses = ['workspace_id = ?'];
    const parameters: (string | number)[] = [workspaceId];
    if (options.kind !== undefined) {
      clauses.push('kind = ?');
      parameters.push(options.kind);
    }
    if (options.status !== undefined) {
      clauses.push('status = ?');
      parameters.push(options.status);
    }
    parameters.push(validateLimit(options.limit));
    return this.#database
      .prepare(
        `SELECT * FROM workspace_memory WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, id LIMIT ?`,
      )
      .all(...parameters)
      .map(rowToEntry);
  }

  public search(
    workspaceId: string,
    query: string,
    options: ListWorkspaceMemoryOptions = {},
  ): readonly WorkspaceMemoryEntry[] {
    if (query.trim() === '')
      throw new NixError('Memory search query cannot be empty.', 'MEMORY_INPUT_INVALID');
    const escaped = query
      .trim()
      .replaceAll('\\', '\\\\')
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_');
    const clauses = [
      `workspace_id = ?`,
      `(content LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\')`,
    ];
    const pattern = `%${escaped}%`;
    const parameters: (string | number)[] = [workspaceId, pattern, pattern];
    if (options.kind !== undefined) {
      clauses.push('kind = ?');
      parameters.push(options.kind);
    }
    clauses.push('status = ?');
    parameters.push(options.status ?? 'active');
    parameters.push(validateLimit(options.limit));
    return this.#database
      .prepare(
        `SELECT * FROM workspace_memory WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, id LIMIT ?`,
      )
      .all(...parameters)
      .map(rowToEntry);
  }

  public remove(workspaceId: string, id: string): boolean {
    return (
      Number(
        this.#database
          .prepare('DELETE FROM workspace_memory WHERE workspace_id = ? AND id = ?')
          .run(workspaceId, id).changes,
      ) === 1
    );
  }

  public close(): void {
    this.#database.close();
  }
  public [Symbol.dispose](): void {
    this.close();
  }
}
