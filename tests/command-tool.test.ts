import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CommandPermissionManager } from '../src/security/command-permission.js';
import { createDefaultToolRegistry } from '../src/tools/create-default-registry.js';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';

describe('CommandPermissionManager', () => {
  const manager = new CommandPermissionManager();

  it.each([
    ['git', ['status'], 'allow'],
    ['npm', ['test'], 'allow'],
    ['npm.cmd', ['run', 'build'], 'allow'],
    ['npm', ['install'], 'ask'],
    ['git', ['reset', '--hard'], 'deny'],
    ['rm', ['-rf', '.'], 'deny'],
    ['powershell', ['anything'], 'ask'],
  ] as const)('classifies %s %j as %s', (program, args, decision) => {
    expect(manager.classify(program, args).decision).toBe(decision);
  });
});

describe('run_command', () => {
  it('runs an allowlisted command and captures output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-command-'));
    const workspace = await WorkspaceManager.create(root);
    const result = await createDefaultToolRegistry().execute(
      'run_command',
      { program: 'node', args: ['--version'], timeoutMs: 10_000 },
      { workspace },
    );
    expect(result).toMatchObject({ ok: true, output: { exitCode: 0, timedOut: false } });
    expect(JSON.stringify(result)).toContain('v');
  });

  it('denies dangerous and approval-required commands before spawning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-command-'));
    const workspace = await WorkspaceManager.create(root);
    const registry = createDefaultToolRegistry();
    await expect(
      registry.execute('run_command', { program: 'git', args: ['reset', '--hard'] }, { workspace }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'COMMAND_DENIED' } });
    await expect(
      registry.execute('run_command', { program: 'npm', args: ['install'] }, { workspace }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'COMMAND_APPROVAL_REQUIRED' } });
  });
});
