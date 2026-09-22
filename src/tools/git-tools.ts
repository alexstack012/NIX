import { spawn } from 'node:child_process';

import { NixError } from '../shared/errors.js';
import type { Tool } from './types.js';
import { objectInput, stringField } from './validation.js';

const runGit = async (
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn('git', [...args], { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(new NixError(`git ${args[0] ?? ''} failed: ${stderr.trim()}`, 'GIT_COMMAND_FAILED'));
    });
  });

export const gitStatusTool: Tool<Record<string, never>> = {
  definition: {
    name: 'git_status',
    description: 'Read concise Git branch and working-tree status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  validate(input) {
    objectInput(input);
    return {};
  },
  async execute(_input, { workspace }) {
    return runGit(workspace.root, ['status', '--short', '--branch']);
  },
};

export const gitDiffTool: Tool<{ path: string }> = {
  definition: {
    name: 'git_diff',
    description: 'Read the unstaged Git diff, optionally limited to a workspace-relative path.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    },
  },
  validate(input) {
    return { path: stringField(objectInput(input), 'path', { optional: true, fallback: '' }) };
  },
  async execute(input, { workspace, verification }) {
    const args = ['diff', '--no-ext-diff'];
    if (input.path !== '') {
      const path = await workspace.resolveExisting(input.path);
      args.push('--', workspace.relativePath(path));
    }
    const result = await runGit(workspace.root, args);
    if (input.path === '') verification?.diffReviewed();
    return result;
  },
};
