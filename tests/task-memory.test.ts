import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgentRunner } from '../src/agent/agent-runner.js';
import { TaskMemory } from '../src/memory/task-memory.js';
import { WorkspaceMemory } from '../src/memory/workspace-memory.js';
import type { ModelProvider } from '../src/model/model-provider.js';
import type { ModelResponse } from '../src/model/types.js';
import { createDefaultToolRegistry } from '../src/tools/create-default-registry.js';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';

describe('TaskMemory', () => {
  it('bounds temporary notes and tool summaries', () => {
    const memory = new TaskMemory(2, 2, 2);
    memory.addNote('first');
    memory.addNote('second');
    memory.addNote('third');
    memory.recordToolResult('one', { ok: true });
    memory.recordToolResult('two', { ok: false, error: { code: 'FAIL', message: 'failed' } });
    memory.recordToolResult('three', { ok: true });

    expect(memory.snapshot().notes.map((note) => note.content)).toEqual(['second', 'third']);
    expect(memory.snapshot().toolSummaries).toEqual([
      { tool: 'two', ok: false, errorCode: 'FAIL' },
      { tool: 'three', ok: true },
    ]);
  });

  it('creates proposals without changing durable workspace memory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-task-memory-'));
    const taskMemory = new TaskMemory();
    const durable = await WorkspaceMemory.open(join(root, 'storage'));
    const workspace = await WorkspaceManager.create(root);
    const registry = createDefaultToolRegistry({
      memory: durable,
      workspaceId: 'workspace',
      taskMemory,
    });

    const result = await registry.execute(
      'propose_workspace_memory',
      {
        kind: 'decision',
        content: 'Use exact patches for narrow changes.',
        source: 'task verification',
        confidence: 0.8,
      },
      { workspace },
    );

    expect(result).toMatchObject({ ok: true, output: { saved: false } });
    expect(taskMemory.snapshot().proposals).toHaveLength(1);
    expect(durable.list('workspace')).toEqual([]);
    durable.close();
  });

  it('rejects malformed proposals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-task-memory-'));
    const registry = createDefaultToolRegistry({ taskMemory: new TaskMemory() });
    const workspace = await WorkspaceManager.create(root);

    await expect(
      registry.execute(
        'propose_workspace_memory',
        { kind: 'conversation', content: 'bad', source: 'task' },
        { workspace },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'TOOL_INPUT_INVALID' } });
  });
});

class ProposalProvider implements ModelProvider {
  public readonly id = 'proposal-test';
  readonly #responses: ModelResponse[] = [
    {
      content: '',
      toolCalls: [
        {
          id: 'proposal',
          name: 'propose_workspace_memory',
          arguments: {
            kind: 'architecture',
            content: 'The CLI uses structured tool requests.',
            source: 'src/cli/index.ts',
          },
          rawArguments: '{}',
        },
      ],
    },
    { content: 'Done.', toolCalls: [] },
  ];
  public healthCheck() {
    return Promise.resolve({ available: true, message: 'ok' });
  }
  public generate(): Promise<ModelResponse> {
    const response = this.#responses.shift();
    if (response === undefined) throw new Error('No response.');
    return Promise.resolve(response);
  }
}

describe('AgentRunner task-memory proposals', () => {
  it('returns proposals in the result without durable promotion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-task-agent-'));
    const taskMemory = new TaskMemory();
    const workspace = await WorkspaceManager.create(root);
    const runner = new AgentRunner({
      provider: new ProposalProvider(),
      tools: createDefaultToolRegistry({ taskMemory }),
      workspace,
      taskMemory,
    });

    const result = await runner.run('Inspect the CLI.');

    expect(result.memoryProposals).toMatchObject([
      { kind: 'architecture', content: 'The CLI uses structured tool requests.' },
    ]);
  });
});
