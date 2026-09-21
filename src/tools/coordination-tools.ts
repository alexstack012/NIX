import type { CoordinationTracker } from '../agent/coordination-tracker.js';
import { NixError } from '../shared/errors.js';
import type { RegisteredWorkspace } from '../workspace/workspace-registry.js';
import { WorkspaceManager } from '../workspace/workspace-manager.js';
import { runCommandTool } from './command-tool.js';
import { applyPatchTool } from './file-tools.js';
import { gitDiffTool } from './git-tools.js';
import type { Tool } from './types.js';
import { integerField, objectInput, stringField } from './validation.js';

export interface CoordinationDependencies {
  readonly targets: readonly RegisteredWorkspace[];
  readonly tracker: CoordinationTracker;
}

const targetFor = (
  targets: readonly RegisteredWorkspace[],
  identifier: string,
): RegisteredWorkspace => {
  const normalized = identifier.toLowerCase();
  const target = targets.find(
    (entry) => entry.id === identifier || entry.name.toLowerCase() === normalized,
  );
  if (target === undefined) {
    throw new NixError(
      `Workspace is not in this task's explicit modification scope: ${identifier}`,
      'WORKSPACE_MODIFY_SCOPE_DENIED',
    );
  }
  return target;
};

const exitCodeOf = (result: unknown): number | null => {
  if (typeof result !== 'object' || result === null || !('exitCode' in result)) return null;
  return typeof result.exitCode === 'number' ? result.exitCode : null;
};

export const createCoordinationTools = (
  dependencies: CoordinationDependencies,
): readonly Tool[] => {
  const scope: Tool<Record<string, never>> = {
    definition: {
      name: 'coordination_scope',
      description: 'List the exact external workspaces approved for modification in this task.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    validate(input) {
      objectInput(input);
      return {};
    },
    execute() {
      return Promise.resolve(
        dependencies.targets.map((target) => ({
          id: target.id,
          name: target.name,
          path: target.path,
        })),
      );
    },
  };

  const patch: Tool<{ workspace: string; path: string; oldText: string; newText: string }> = {
    definition: {
      name: 'apply_workspace_patch',
      description: 'Apply one unique exact-text patch in an explicitly scoped external workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          workspace: { type: 'string' },
          path: { type: 'string' },
          oldText: { type: 'string' },
          newText: { type: 'string' },
        },
        required: ['workspace', 'path', 'oldText', 'newText'],
        additionalProperties: false,
      },
    },
    validate(input) {
      const value = objectInput(input);
      const newText = value.newText;
      if (typeof newText !== 'string')
        throw new NixError('newText must be a string.', 'TOOL_INPUT_INVALID');
      return {
        workspace: stringField(value, 'workspace'),
        path: stringField(value, 'path'),
        oldText: stringField(value, 'oldText'),
        newText,
      };
    },
    async execute(input) {
      const target = targetFor(dependencies.targets, input.workspace);
      const workspace = await WorkspaceManager.create(target.path);
      const output = await applyPatchTool.execute(
        { path: input.path, oldText: input.oldText, newText: input.newText },
        { workspace },
      );
      dependencies.tracker.modified(target.id, input.path);
      return { target: target.name, output };
    },
  };

  const verify: Tool<{
    workspace: string;
    program: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
  }> = {
    definition: {
      name: 'run_workspace_verification',
      description:
        'Run an allowlisted verification command in an explicitly scoped external workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          workspace: { type: 'string' },
          program: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          cwd: { type: 'string' },
          timeoutMs: { type: 'integer' },
        },
        required: ['workspace', 'program'],
        additionalProperties: false,
      },
    },
    validate(input) {
      const value = objectInput(input);
      const args = value.args ?? [];
      if (!Array.isArray(args) || args.some((entry) => typeof entry !== 'string'))
        throw new NixError('args must be an array of strings.', 'TOOL_INPUT_INVALID');
      return {
        workspace: stringField(value, 'workspace'),
        program: stringField(value, 'program'),
        args: args as string[],
        cwd: stringField(value, 'cwd', { optional: true, fallback: '.' }),
        timeoutMs: integerField(value, 'timeoutMs', 120_000, 600_000),
      };
    },
    async execute(input) {
      const target = targetFor(dependencies.targets, input.workspace);
      const executable = input.program.toLowerCase().replace(/\.cmd$/u, '');
      const verificationScript =
        input.args[0] === 'test' ||
        (input.args[0] === 'run' &&
          ['test', 'lint', 'build', 'typecheck'].includes(input.args[1] ?? ''));
      if (executable !== 'npm' || !verificationScript) {
        throw new NixError(
          'Coordinated verification requires npm test or an npm run test/lint/build/typecheck script.',
          'COMMAND_DENIED',
        );
      }
      const workspace = await WorkspaceManager.create(target.path);
      const output = await runCommandTool.execute(
        { program: input.program, args: input.args, cwd: input.cwd, timeoutMs: input.timeoutMs },
        { workspace },
      );
      if (exitCodeOf(output) === 0) dependencies.tracker.verified(target.id);
      return { target: target.name, output };
    },
  };

  const diff: Tool<{ workspace: string; path: string }> = {
    definition: {
      name: 'review_workspace_diff',
      description:
        'Read and mark reviewed the Git diff in an explicitly scoped external workspace.',
      inputSchema: {
        type: 'object',
        properties: { workspace: { type: 'string' }, path: { type: 'string' } },
        required: ['workspace'],
        additionalProperties: false,
      },
    },
    validate(input) {
      const value = objectInput(input);
      return {
        workspace: stringField(value, 'workspace'),
        path: stringField(value, 'path', { optional: true, fallback: '' }),
      };
    },
    async execute(input) {
      const target = targetFor(dependencies.targets, input.workspace);
      const workspace = await WorkspaceManager.create(target.path);
      const output = await gitDiffTool.execute({ path: input.path }, { workspace });
      dependencies.tracker.diffReviewed(target.id);
      return { target: target.name, output };
    },
  };
  return [scope, patch, verify, diff];
};
