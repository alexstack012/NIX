import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgentRunner } from '../src/agent/agent-runner.js';
import type { TaskLogEvent, TaskLogger } from '../src/agent/task-logger.js';
import type { ModelProvider } from '../src/model/model-provider.js';
import type { ModelRequest, ModelResponse } from '../src/model/types.js';
import { createReadOnlyToolRegistry } from '../src/tools/create-default-registry.js';
import { ToolRegistry } from '../src/tools/tool-registry.js';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';

class FakeProvider implements ModelProvider {
  public readonly id = 'fake';
  public readonly requests: ModelRequest[] = [];
  public constructor(private readonly responses: ModelResponse[]) {}
  public healthCheck() {
    return Promise.resolve({ available: true, message: 'ok' });
  }
  public generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) throw new Error('No fake response');
    return Promise.resolve(response);
  }
}

class CapturingLogger implements TaskLogger {
  public readonly events: TaskLogEvent[] = [];
  public log(event: TaskLogEvent) {
    this.events.push(event);
    return Promise.resolve();
  }
}

const response = (content: string, toolCalls: ModelResponse['toolCalls'] = []): ModelResponse => ({
  content,
  toolCalls,
});

const workspace = async () => {
  const root = await mkdtemp(join(tmpdir(), 'nix-agent-'));
  await writeFile(join(root, 'README.md'), '# Local fixture');
  return WorkspaceManager.create(root);
};

describe('AgentRunner', () => {
  it('executes a tool and returns its result to the model', async () => {
    const provider = new FakeProvider([
      response('', [
        {
          id: 'call-1',
          name: 'read_file',
          arguments: { path: 'README.md' },
          rawArguments: '{"path":"README.md"}',
        },
      ]),
      response('The fixture is local.'),
    ]);
    const logger = new CapturingLogger();
    const runner = new AgentRunner({
      provider,
      tools: createReadOnlyToolRegistry(),
      workspace: await workspace(),
      logger,
    });

    const result = await runner.run('Explain the readme.');

    expect(result).toMatchObject({ status: 'completed', iterations: 2, toolCalls: 1, errors: 0 });
    expect(provider.requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
    });
    expect(provider.requests[1]?.messages.at(-1)?.content).toContain('Local fixture');
    expect(provider.requests[0]?.messages[0]?.content).toContain(
      'current source, current tests, current configuration, workspace memory',
    );
    expect(logger.events.some((event) => event.type === 'tool_result')).toBe(true);
  });

  it('returns tool errors to the model so it can recover', async () => {
    const provider = new FakeProvider([
      response('', [
        {
          id: 'bad',
          name: 'read_file',
          arguments: { path: '../secret' },
          rawArguments: '{"path":"../secret"}',
        },
      ]),
      response('I could not access that path.'),
    ]);
    const runner = new AgentRunner({
      provider,
      tools: createReadOnlyToolRegistry(),
      workspace: await workspace(),
    });
    await expect(runner.run('Read outside.')).resolves.toMatchObject({
      status: 'completed',
      errors: 1,
    });
  });

  it('stops a model that keeps requesting tools', async () => {
    const toolCall = { id: 'loop', name: 'list_directory', arguments: {}, rawArguments: '{}' };
    const provider = new FakeProvider([
      response('', [toolCall]),
      response('', [toolCall]),
      response('', [toolCall]),
    ]);
    const runner = new AgentRunner({
      provider,
      tools: createReadOnlyToolRegistry(),
      workspace: await workspace(),
      maxIterations: 3,
    });
    await expect(runner.run('Loop forever.')).resolves.toMatchObject({
      status: 'max_iterations',
      iterations: 3,
      toolCalls: 3,
    });
  });

  it('logs provider failures with duration before rethrowing', async () => {
    const logger = new CapturingLogger();
    const runner = new AgentRunner({
      provider: new FakeProvider([]),
      tools: createReadOnlyToolRegistry(),
      workspace: await workspace(),
      logger,
    });

    await expect(runner.run('Fail locally.')).rejects.toThrow('No fake response');

    const failure = logger.events.find((event) => event.type === 'task_failed');
    expect(failure).toBeDefined();
    expect(failure?.data).toMatchObject({ errors: 1, toolCalls: 0 });
    expect(typeof failure?.data.durationMs).toBe('number');
  });

  it('truncates oversized tool results while preserving valid structured feedback', async () => {
    const provider = new FakeProvider([
      response('', [{ id: 'large', name: 'large_output', arguments: {}, rawArguments: '{}' }]),
      response('Recovered from bounded output.'),
    ]);
    const logger = new CapturingLogger();
    const tools = new ToolRegistry();
    tools.register({
      definition: { name: 'large_output', description: 'test', inputSchema: {} },
      validate: () => ({}),
      execute: () => Promise.resolve({ content: 'x'.repeat(5_000) }),
    });
    const runner = new AgentRunner({
      provider,
      tools,
      workspace: await workspace(),
      logger,
      maxToolResultCharacters: 1_000,
    });

    await expect(runner.run('Bound the output.')).resolves.toMatchObject({ status: 'completed' });

    const toolMessage = provider.requests[1]?.messages.at(-1);
    expect(toolMessage?.content.length).toBeLessThanOrEqual(1_000);
    const parsed = JSON.parse(toolMessage?.content ?? '{}') as unknown;
    expect(parsed).toMatchObject({ truncated: true });
    expect(logger.events.some((event) => event.type === 'tool_result_truncated')).toBe(true);
  });

  it('lets the model correct malformed tool calls within a logged retry budget', async () => {
    const issueResponse: ModelResponse = {
      content: 'I attempted a bad call.',
      toolCalls: [],
      issues: [
        {
          code: 'MALFORMED_TOOL_CALL',
          toolName: 'read_file',
          message: 'Tool call read_file contained invalid JSON arguments.',
        },
      ],
    };
    const recoveringProvider = new FakeProvider([
      issueResponse,
      response('', [
        {
          id: 'corrected',
          name: 'read_file',
          arguments: { path: 'README.md' },
          rawArguments: '{"path":"README.md"}',
        },
      ]),
      response('Recovered.'),
    ]);
    const logger = new CapturingLogger();
    const runner = new AgentRunner({
      provider: recoveringProvider,
      tools: createReadOnlyToolRegistry(),
      workspace: await workspace(),
      logger,
    });

    await expect(runner.run('Recover safely.')).resolves.toMatchObject({
      status: 'completed',
      errors: 1,
      toolCalls: 1,
    });
    expect(
      recoveringProvider.requests[1]?.messages.some((message) =>
        message.content.includes('No tools from that response were executed'),
      ),
    ).toBe(true);
    expect(logger.events.some((event) => event.type === 'model_response_recovery')).toBe(true);
  });

  it('fails after the malformed tool-call recovery budget is exhausted', async () => {
    const malformed: ModelResponse = {
      content: '',
      toolCalls: [],
      issues: [
        {
          code: 'MALFORMED_TOOL_CALL',
          message: 'Invalid arguments.',
        },
      ],
    };
    const logger = new CapturingLogger();
    const runner = new AgentRunner({
      provider: new FakeProvider([malformed, malformed]),
      tools: createReadOnlyToolRegistry(),
      workspace: await workspace(),
      logger,
      maxMalformedToolCallRecoveries: 1,
    });

    await expect(runner.run('Keep failing.')).rejects.toMatchObject({
      code: 'MODEL_RESPONSE_INVALID',
    });
    expect(logger.events.filter((event) => event.type === 'model_response_recovery')).toHaveLength(
      2,
    );
    expect(logger.events.at(-1)?.type).toBe('task_failed');
  });

  it('stops before sending a request that exceeds the total task-context limit', async () => {
    const provider = new FakeProvider([]);
    const logger = new CapturingLogger();
    const runner = new AgentRunner({
      provider,
      tools: new ToolRegistry(),
      workspace: await workspace(),
      logger,
      maxTaskContextCharacters: 1_000,
    });

    await expect(runner.run('x'.repeat(2_000))).resolves.toMatchObject({
      status: 'context_limit',
      iterations: 0,
      toolCalls: 0,
    });
    expect(provider.requests).toHaveLength(0);
    expect(logger.events.some((event) => event.type === 'context_usage')).toBe(true);
  });
});
