import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import type { WorkspaceManager } from './workspace-manager.js';

export interface RepositoryMapEntry {
  readonly path: string;
  readonly symbols: readonly string[];
}

export interface RepositoryMapResult {
  readonly entries: readonly RepositoryMapEntry[];
  readonly filesScanned: number;
  readonly filesMapped: number;
  readonly filesReturned: number;
  readonly truncated: boolean;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const DECLARATION =
  /^(?:(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|interface|enum|function)|export\s+(?:type|const|let|var))\s+([A-Za-z_$][\w$]*)/u;
const METHOD =
  /^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^={]+)?\{/u;

const symbolsFrom = (content: string): string[] => {
  const symbols = new Set<string>();
  for (const line of content.split(/\r?\n/u)) {
    const declaration = DECLARATION.exec(line.trim());
    if (declaration?.[1] !== undefined) symbols.add(declaration[1]);
    const method = METHOD.exec(line);
    if (method?.[1] !== undefined && !['if', 'for', 'while', 'switch', 'catch'].includes(method[1]))
      symbols.add(`${method[1]}()`);
  }
  return [...symbols];
};

export const buildRepositoryMap = async (
  workspace: WorkspaceManager,
  options: { readonly query?: string; readonly maxFiles?: number } = {},
): Promise<RepositoryMapResult> => {
  const maximum = options.maxFiles ?? 500;
  const pending = [workspace.root];
  const mapped: RepositoryMapEntry[] = [];
  let filesScanned = 0;
  let truncated = false;
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (workspace.isIgnoredName(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        filesScanned += 1;
        if (SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          if (mapped.length >= maximum) {
            truncated = true;
            continue;
          }
          mapped.push({
            path: workspace.relativePath(path),
            symbols: symbolsFrom(await readFile(path, 'utf8')),
          });
        }
      }
    }
  }
  const query = options.query?.toLowerCase();
  const entries =
    query === undefined || query === ''
      ? mapped
      : mapped.filter(
          (entry) =>
            entry.path.toLowerCase().includes(query) ||
            entry.symbols.some((symbol) => symbol.toLowerCase().includes(query)),
        );
  return {
    entries,
    filesScanned,
    filesMapped: mapped.length,
    filesReturned: entries.length,
    truncated,
  };
};
