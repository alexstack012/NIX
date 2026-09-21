import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createInterface } from 'node:readline';

import { NixError } from '../shared/errors.js';
import type { WorkspaceManager } from '../workspace/workspace-manager.js';
import type { Tool } from './types.js';
import { integerField, objectInput, stringField } from './validation.js';

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const pathProperty = { type: 'string', description: 'Workspace-relative path.' };
const MAX_FULL_FILE_BYTES = 500_000;
const MAX_SEARCH_FILE_BYTES = 2_000_000;
const MAX_RANGE_LINES = 2_000;

async function walkFiles(
  workspace: WorkspaceManager,
  start: string,
  limit: number,
): Promise<string[]> {
  const files: string[] = [];
  const pending = [start];
  while (pending.length > 0 && files.length < limit) {
    const directory = pending.pop();
    if (directory === undefined) break;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (workspace.isIgnoredName(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) files.push(absolute);
      else if (entry.isSymbolicLink()) {
        const resolved = await workspace.resolveExisting(workspace.relativePath(absolute));
        if ((await stat(resolved)).isFile()) files.push(resolved);
      }
      if (files.length >= limit) break;
    }
  }
  return files;
}

export const listDirectoryTool: Tool<{ path: string }> = {
  definition: {
    name: 'list_directory',
    description: 'List one workspace directory without recursively reading its contents.',
    inputSchema: schema({ path: pathProperty }),
  },
  validate(input) {
    const value = objectInput(input);
    return { path: stringField(value, 'path', { optional: true, fallback: '.' }) };
  },
  async execute(input, { workspace }) {
    const directory = await workspace.resolveExisting(input.path);
    if (!(await stat(directory)).isDirectory())
      throw new NixError('Path is not a directory.', 'PATH_TYPE_INVALID');
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => !workspace.isIgnoredName(entry.name))
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
};

export const readFileTool: Tool<{ path: string }> = {
  definition: {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the workspace.',
    inputSchema: schema({ path: pathProperty }, ['path']),
  },
  validate(input) {
    return { path: stringField(objectInput(input), 'path') };
  },
  async execute(input, { workspace }) {
    const path = await workspace.resolveExisting(input.path);
    const info = await stat(path);
    if (!info.isFile()) throw new NixError('Path is not a file.', 'PATH_TYPE_INVALID');
    if (info.size > MAX_FULL_FILE_BYTES) {
      throw new NixError(
        `File is too large for a full read (${String(info.size)} bytes). Use read_file_range.`,
        'FILE_TOO_LARGE',
      );
    }
    return { path: workspace.relativePath(path), content: await readFile(path, 'utf8') };
  },
};

export const readFileRangeTool: Tool<{ path: string; startLine: number; endLine: number }> = {
  definition: {
    name: 'read_file_range',
    description: 'Read an inclusive one-based line range from a UTF-8 workspace file.',
    inputSchema: schema(
      { path: pathProperty, startLine: { type: 'integer' }, endLine: { type: 'integer' } },
      ['path', 'startLine', 'endLine'],
    ),
  },
  validate(input) {
    const value = objectInput(input);
    const startLine = integerField(value, 'startLine', 1, 1_000_000);
    const endLine = integerField(value, 'endLine', startLine, 1_000_000);
    if (endLine < startLine)
      throw new NixError('endLine must be at least startLine.', 'TOOL_INPUT_INVALID');
    if (endLine - startLine + 1 > MAX_RANGE_LINES) {
      throw new NixError(
        `A file range may contain at most ${String(MAX_RANGE_LINES)} lines.`,
        'TOOL_INPUT_INVALID',
      );
    }
    return { path: stringField(value, 'path'), startLine, endLine };
  },
  async execute(input, { workspace }) {
    const path = await workspace.resolveExisting(input.path);
    if (!(await stat(path)).isFile())
      throw new NixError('Path is not a file.', 'PATH_TYPE_INVALID');
    const stream = createReadStream(path, { encoding: 'utf8' });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    const lines: string[] = [];
    let currentLine = 0;
    for await (const line of reader) {
      currentLine += 1;
      if (currentLine >= input.startLine) lines.push(line);
      if (currentLine >= input.endLine) break;
    }
    reader.close();
    stream.destroy();
    return {
      path: workspace.relativePath(path),
      startLine: input.startLine,
      endLine:
        lines.length === 0
          ? Math.min(input.endLine, currentLine)
          : Math.min(input.endLine, input.startLine + lines.length - 1),
      content: lines.join('\n'),
    };
  },
};

export const searchFilesTool: Tool<{ path: string; query: string; maxResults: number }> = {
  definition: {
    name: 'search_files',
    description: 'Find workspace file paths by case-insensitive name or path substring.',
    inputSchema: schema(
      { path: pathProperty, query: { type: 'string' }, maxResults: { type: 'integer' } },
      ['query'],
    ),
  },
  validate(input) {
    const value = objectInput(input);
    return {
      path: stringField(value, 'path', { optional: true, fallback: '.' }),
      query: stringField(value, 'query'),
      maxResults: integerField(value, 'maxResults', 100, 1_000),
    };
  },
  async execute(input, { workspace }) {
    const root = await workspace.resolveExisting(input.path);
    const files = await walkFiles(workspace, root, 20_000);
    const query = input.query.toLowerCase();
    return files
      .map((file) => workspace.relativePath(file))
      .filter((file) => file.toLowerCase().includes(query))
      .slice(0, input.maxResults);
  },
};

const likelyText = (path: string): boolean =>
  ![
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.ico',
    '.pdf',
    '.zip',
    '.gz',
    '.exe',
    '.dll',
  ].includes(extname(path).toLowerCase());

export const searchTextTool: Tool<{ path: string; query: string; maxResults: number }> = {
  definition: {
    name: 'search_text',
    description:
      'Search text files for a literal case-insensitive string and return matching lines.',
    inputSchema: schema(
      { path: pathProperty, query: { type: 'string' }, maxResults: { type: 'integer' } },
      ['query'],
    ),
  },
  validate(input) {
    const value = objectInput(input);
    return {
      path: stringField(value, 'path', { optional: true, fallback: '.' }),
      query: stringField(value, 'query'),
      maxResults: integerField(value, 'maxResults', 100, 1_000),
    };
  },
  async execute(input, { workspace }) {
    const root = await workspace.resolveExisting(input.path);
    const files = (await stat(root)).isFile() ? [root] : await walkFiles(workspace, root, 20_000);
    const results: { path: string; line: number; text: string }[] = [];
    const query = input.query.toLowerCase();
    for (const file of files.filter(likelyText)) {
      let content: string;
      try {
        if ((await stat(file)).size > MAX_SEARCH_FILE_BYTES) continue;
        content = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (line.toLowerCase().includes(query))
          results.push({
            path: workspace.relativePath(file),
            line: index + 1,
            text: line.slice(0, 500),
          });
        if (results.length >= input.maxResults) return results;
      }
    }
    return results;
  },
};
