import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { CommandPermissionManager } from '../security/command-permission.js';
import { npmVerificationScript } from '../agent/workspace-verification.js';
import { NixError } from '../shared/errors.js';
import type { Tool } from './types.js';
import { integerField, objectInput, stringField } from './validation.js';

interface RunCommandInput {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}

const OUTPUT_LIMIT = 1_000_000;
const permissions = new CommandPermissionManager();

const resolveProgram = async (
  program: string,
  args: readonly string[],
): Promise<{ program: string; args: readonly string[] }> => {
  if (process.platform !== 'win32' || !/^npm(?:\.cmd)?$/iu.test(program)) return { program, args };
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((candidate): candidate is string => candidate !== undefined);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return { program: process.execPath, args: [candidate, ...args] };
    } catch {
      // Try the next standard local npm CLI location.
    }
  }
  throw new NixError(
    'Could not locate npm-cli.js for safe shell-free execution.',
    'COMMAND_UNAVAILABLE',
  );
};

const arrayField = (input: Record<string, unknown>, name: string): string[] => {
  const value = input[name] ?? [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new NixError(`${name} must be an array of strings.`, 'TOOL_INPUT_INVALID');
  }
  return value as string[];
};

export const runCommandTool: Tool<RunCommandInput> = {
  definition: {
    name: 'run_command',
    description:
      'Run an allowlisted verification command without a shell. Unknown/write commands require approval and dangerous commands are denied.',
    inputSchema: {
      type: 'object',
      properties: {
        program: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        cwd: { type: 'string' },
        timeoutMs: { type: 'integer' },
      },
      required: ['program'],
      additionalProperties: false,
    },
  },
  validate(input) {
    const value = objectInput(input);
    return {
      program: stringField(value, 'program'),
      args: arrayField(value, 'args'),
      cwd: stringField(value, 'cwd', { optional: true, fallback: '.' }),
      timeoutMs: integerField(value, 'timeoutMs', 120_000, 600_000),
    };
  },
  async execute(input, { workspace, verification }) {
    const classification = permissions.classify(input.program, input.args);
    if (classification.decision !== 'allow') {
      const code =
        classification.decision === 'deny' ? 'COMMAND_DENIED' : 'COMMAND_APPROVAL_REQUIRED';
      throw new NixError(
        `${classification.reason} (${input.program} ${input.args.join(' ')})`,
        code,
      );
    }
    const cwd = await workspace.resolveExisting(input.cwd);
    if (!(await stat(cwd)).isDirectory())
      throw new NixError('Command cwd is not a directory.', 'PATH_TYPE_INVALID');
    const resolvedCommand = await resolveProgram(input.program, input.args);
    const started = Date.now();
    const result = await new Promise<{
      readonly program: string;
      readonly args: readonly string[];
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly timedOut: boolean;
      readonly stdout: string;
      readonly stderr: string;
      readonly durationMs: number;
      readonly truncated: boolean;
      readonly classification: ReturnType<CommandPermissionManager['classify']>;
    }>((resolve, reject) => {
      const child = spawn(resolvedCommand.program, [...resolvedCommand.args], {
        cwd,
        shell: false,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const append = (current: string, chunk: string): string =>
        (current + chunk).slice(0, OUTPUT_LIMIT);
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr = append(stderr, chunk);
      });
      child.on('error', reject);
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, input.timeoutMs);
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({
          program: resolvedCommand.program,
          args: resolvedCommand.args,
          exitCode: code,
          signal,
          timedOut,
          stdout,
          stderr,
          durationMs: Date.now() - started,
          truncated: stdout.length >= OUTPUT_LIMIT || stderr.length >= OUTPUT_LIMIT,
          classification,
        });
      });
    });
    const verificationScript = npmVerificationScript(input.program, input.args);
    if (result.exitCode === 0 && !result.timedOut && verificationScript !== undefined) {
      await verification?.refreshAvailableCommands();
      verification?.verificationSucceeded(
        verificationScript,
        `${input.program} ${input.args.join(' ')}`.trim(),
      );
    }
    return result;
  },
};
