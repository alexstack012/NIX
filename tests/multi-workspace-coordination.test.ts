import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { AgentRunner } from '../src/agent/agent-runner.js';
import { CoordinationTracker } from '../src/agent/coordination-tracker.js';
import type { ModelProvider } from '../src/model/model-provider.js';
import type {
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
} from '../src/model/types.js';
import { createDefaultToolRegistry } from '../src/tools/create-default-registry.js';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';
import type { RegisteredWorkspace } from '../src/workspace/workspace-registry.js';
import { WorkspaceRelationshipRegistry } from '../src/workspace/workspace-relationships.js';

const exec = promisify(execFile);
const call = (id: string, name: string, args: unknown): ModelToolCall => ({
  id,
  name,
  arguments: args,
  rawArguments: JSON.stringify(args),
});

class CoordinationProvider implements ModelProvider {
  public readonly id = 'coordination-test';
  public readonly requests: ModelRequest[] = [];
  readonly #responses: ModelResponse[] = [
    { content: '', toolCalls: [call('scope', 'coordination_scope', {})] },
    {
      content: '',
      toolCalls: [
        call('patch', 'apply_workspace_patch', {
          workspace: 'target',
          path: 'math.mjs',
          oldText: 'a - b',
          newText: 'a + b',
        }),
      ],
    },
    { content: 'Done too early.', toolCalls: [] },
    {
      content: '',
      toolCalls: [
        call('verify', 'run_workspace_verification', {
          workspace: 'target',
          program: 'npm',
          args: ['test'],
          timeoutMs: 30_000,
        }),
      ],
    },
    {
      content: '',
      toolCalls: [call('diff', 'review_workspace_diff', { workspace: 'target' })],
    },
    { content: 'Target change tested and reviewed.', toolCalls: [] },
  ];
  public healthCheck() {
    return Promise.resolve({ available: true, message: 'ok' });
  }
  public generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response = this.#responses.shift();
    if (response === undefined) throw new Error('No response.');
    return Promise.resolve(response);
  }
}

const targetRecord = (path: string): RegisteredWorkspace => ({
  id: 'target-id',
  name: 'target',
  path,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

describe('multi-workspace coordination', () => {
  it('requires target verification and diff review before completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-coordination-'));
    const sourcePath = join(root, 'source');
    const targetPath = join(root, 'target');
    await mkdir(sourcePath);
    await mkdir(targetPath);
    await writeFile(
      join(targetPath, 'package.json'),
      JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }),
    );
    await writeFile(join(targetPath, 'math.mjs'), 'export const add = (a, b) => a - b;\n');
    await writeFile(
      join(targetPath, 'math.test.mjs'),
      "import assert from 'node:assert/strict'; import test from 'node:test'; import { add } from './math.mjs'; test('adds', () => assert.equal(add(2, 3), 5));\n",
    );
    await exec('git', ['init'], { cwd: targetPath });
    await exec('git', ['add', '.'], { cwd: targetPath });
    await exec(
      'git',
      ['-c', 'user.name=Nix Test', '-c', 'user.email=nix@local.invalid', 'commit', '-m', 'fixture'],
      { cwd: targetPath },
    );
    const tracker = new CoordinationTracker();
    tracker.register('target-id', 'target');
    const provider = new CoordinationProvider();
    const workspace = await WorkspaceManager.create(sourcePath);
    const runner = new AgentRunner({
      provider,
      tools: createDefaultToolRegistry({
        coordination: { targets: [targetRecord(targetPath)], tracker },
      }),
      workspace,
      coordination: tracker,
      maxIterations: 10,
    });

    const result = await runner.run('Fix and verify the target workspace.');

    expect(result).toMatchObject({ status: 'completed', iterations: 6 });
    expect(result.coordination).toEqual([
      {
        workspaceId: 'target-id',
        name: 'target',
        modifiedFiles: ['math.mjs'],
        verified: true,
        diffReviewed: true,
      },
    ]);
    const thirdRequestMessages: readonly ModelMessage[] = provider.requests[3]?.messages ?? [];
    expect(
      thirdRequestMessages.some((message) => message.content.includes('Cannot complete task yet')),
    ).toBe(true);
    expect(await readFile(join(targetPath, 'math.mjs'), 'utf8')).toContain('a + b');
  }, 30_000);

  it('denies workspaces outside explicit task scope and distinguishes modify grants', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-coordination-'));
    const targetPath = join(root, 'target');
    await mkdir(targetPath);
    await writeFile(join(targetPath, 'file.txt'), 'old');
    const tracker = new CoordinationTracker();
    tracker.register('target-id', 'target');
    const registry = createDefaultToolRegistry({
      coordination: { targets: [targetRecord(targetPath)], tracker },
    });
    const workspace = await WorkspaceManager.create(root);

    await expect(
      registry.execute(
        'apply_workspace_patch',
        { workspace: 'not-scoped', path: 'file.txt', oldText: 'old', newText: 'new' },
        { workspace },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'WORKSPACE_MODIFY_SCOPE_DENIED' },
    });

    const relationships = new WorkspaceRelationshipRegistry(join(root, 'storage'));
    await relationships.grant('source', 'target', 'consult');
    expect(await relationships.canModify('source', 'target')).toBe(false);
    await relationships.grant('source', 'target', 'modify');
    expect(await relationships.canModify('source', 'target')).toBe(true);
  });
});
