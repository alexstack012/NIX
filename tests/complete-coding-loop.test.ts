import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { AgentRunner } from '../src/agent/agent-runner.js';
import type { ModelProvider } from '../src/model/model-provider.js';
import type { ModelRequest, ModelResponse, ModelToolCall } from '../src/model/types.js';
import { createDefaultToolRegistry } from '../src/tools/create-default-registry.js';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';

const exec = promisify(execFile);
const call = (id: string, name: string, argumentsValue: unknown): ModelToolCall => ({
  id,
  name,
  arguments: argumentsValue,
  rawArguments: JSON.stringify(argumentsValue),
});

class ScriptedCodingProvider implements ModelProvider {
  public readonly id = 'scripted-local-test';
  public readonly requests: ModelRequest[] = [];
  readonly #responses: ModelResponse[] = [
    { content: '', toolCalls: [call('read', 'read_file', { path: 'math.mjs' })] },
    {
      content: '',
      toolCalls: [
        call('patch', 'apply_patch', { path: 'math.mjs', oldText: 'a - b', newText: 'a + b' }),
      ],
    },
    {
      content: '',
      toolCalls: [
        call('test', 'run_command', { program: 'npm', args: ['test'], timeoutMs: 30_000 }),
      ],
    },
    { content: '', toolCalls: [call('diff', 'git_diff', {})] },
    {
      content:
        'Fixed add() and verified the test passes. The reviewed diff only changes the operator.',
      toolCalls: [],
    },
  ];

  public healthCheck() {
    return Promise.resolve({ available: true, message: 'ok' });
  }
  public generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response = this.#responses.shift();
    if (response === undefined) throw new Error('Script exhausted');
    return Promise.resolve(response);
  }
}

describe('complete coding loop', () => {
  it('inspects, edits, tests, reviews the diff, and reports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-complete-loop-'));
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }),
    );
    await writeFile(join(root, 'math.mjs'), 'export const add = (a, b) => a - b;\n');
    await writeFile(
      join(root, 'math.test.mjs'),
      "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { add } from './math.mjs';\ntest('adds', () => assert.equal(add(2, 3), 5));\n",
    );
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['add', '.'], { cwd: root });
    await exec(
      'git',
      ['-c', 'user.name=Nix Test', '-c', 'user.email=nix@local.invalid', 'commit', '-m', 'fixture'],
      { cwd: root },
    );

    const provider = new ScriptedCodingProvider();
    const runner = new AgentRunner({
      provider,
      tools: createDefaultToolRegistry(),
      workspace: await WorkspaceManager.create(root),
      maxIterations: 10,
    });
    const result = await runner.run(
      'Fix the failing add test, verify it, review the diff, and report.',
    );

    expect(result).toMatchObject({
      status: 'completed',
      iterations: 5,
      toolCalls: 4,
      errors: 0,
      modifiedFiles: ['math.mjs'],
    });
    expect(await readFile(join(root, 'math.mjs'), 'utf8')).toContain('a + b');
    const toolMessages = provider.requests
      .flatMap((request) => request.messages)
      .filter((message) => message.role === 'tool');
    expect(
      toolMessages.some(
        (message) => message.name === 'run_command' && message.content.includes('pass'),
      ),
    ).toBe(true);
    expect(
      toolMessages.some(
        (message) => message.name === 'git_diff' && message.content.includes('a + b'),
      ),
    ).toBe(true);
  }, 30_000);
});
