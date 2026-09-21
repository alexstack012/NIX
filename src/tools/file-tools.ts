import { readFile, stat, writeFile } from 'node:fs/promises';

import { NixError } from '../shared/errors.js';
import type { Tool, ToolContext } from './types.js';
import { objectInput, stringField } from './validation.js';

const schema = (required: string[]) => ({
  type: 'object',
  properties: {
    path: { type: 'string' },
    content: { type: 'string' },
    oldText: { type: 'string' },
    newText: { type: 'string' },
  },
  required,
  additionalProperties: false,
});
const track = (path: string, context: ToolContext): void => {
  context.modifiedFiles?.add(context.workspace.relativePath(path));
};
const contentField = (value: Record<string, unknown>, name: string): string => {
  const content = value[name];
  if (typeof content !== 'string')
    throw new NixError(`${name} must be a string.`, 'TOOL_INPUT_INVALID');
  return content;
};

export const createFileTool: Tool<{ path: string; content: string }> = {
  definition: {
    name: 'create_file',
    description: 'Create a new UTF-8 file. Refuses to overwrite an existing path.',
    inputSchema: schema(['path', 'content']),
  },
  validate(input) {
    const value = objectInput(input);
    return { path: stringField(value, 'path'), content: contentField(value, 'content') };
  },
  async execute(input, context) {
    const path = await context.workspace.resolveForWrite(input.path);
    try {
      await writeFile(path, input.content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new NixError(`File already exists: ${input.path}`, 'FILE_EXISTS', { cause: error });
      throw error;
    }
    track(path, context);
    return {
      path: context.workspace.relativePath(path),
      bytesWritten: Buffer.byteLength(input.content),
    };
  },
};

export const writeFileTool: Tool<{ path: string; content: string }> = {
  definition: {
    name: 'write_file',
    description: 'Replace the full contents of an existing UTF-8 workspace file.',
    inputSchema: schema(['path', 'content']),
  },
  validate(input) {
    const value = objectInput(input);
    return { path: stringField(value, 'path'), content: contentField(value, 'content') };
  },
  async execute(input, context) {
    const path = await context.workspace.resolveExisting(input.path);
    if (!(await stat(path)).isFile())
      throw new NixError('Path is not a file.', 'PATH_TYPE_INVALID');
    await writeFile(path, input.content, 'utf8');
    track(path, context);
    return {
      path: context.workspace.relativePath(path),
      bytesWritten: Buffer.byteLength(input.content),
    };
  },
};

export const applyPatchTool: Tool<{ path: string; oldText: string; newText: string }> = {
  definition: {
    name: 'apply_patch',
    description:
      'Replace exactly one matching text block. Fails if the old text is missing or ambiguous.',
    inputSchema: schema(['path', 'oldText', 'newText']),
  },
  validate(input) {
    const value = objectInput(input);
    return {
      path: stringField(value, 'path'),
      oldText: stringField(value, 'oldText'),
      newText: contentField(value, 'newText'),
    };
  },
  async execute(input, context) {
    const path = await context.workspace.resolveExisting(input.path);
    const current = await readFile(path, 'utf8');
    const first = current.indexOf(input.oldText);
    if (first < 0)
      throw new NixError('Patch oldText was not found; no changes were made.', 'PATCH_NOT_FOUND');
    if (current.includes(input.oldText, first + input.oldText.length))
      throw new NixError(
        'Patch oldText is ambiguous; provide a larger unique block.',
        'PATCH_AMBIGUOUS',
      );
    await writeFile(
      path,
      `${current.slice(0, first)}${input.newText}${current.slice(first + input.oldText.length)}`,
      'utf8',
    );
    track(path, context);
    return { path: context.workspace.relativePath(path), replacements: 1 };
  },
};
