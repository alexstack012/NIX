import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { LlamaCppProvider } from '../src/model/llama-cpp-provider.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(async (server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

const listen = async (handler: RequestListener): Promise<string> => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
};

describe('LlamaCppProvider', () => {
  it('reports a healthy local server', async () => {
    const endpoint = await listen((request, response) => {
      expect(request.url).toBe('/health');
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    });
    const provider = new LlamaCppProvider({ endpoint, model: 'test-model' });

    await expect(provider.healthCheck()).resolves.toMatchObject({ available: true });
  });

  it('sends an OpenAI-compatible chat request and normalizes tool calls', async () => {
    const endpoint = await listen((request, response) => {
      expect(request.url).toBe('/v1/chat/completions');
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: null,
                tool_calls: [
                  { id: 'one', function: { name: 'read_file', arguments: '{"path":"README.md"}' } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 4 },
        }),
      );
    });
    const provider = new LlamaCppProvider({ endpoint, model: 'test-model' });

    const result = await provider.generate({ messages: [{ role: 'user', content: 'Inspect.' }] });

    expect(result.toolCalls[0]).toMatchObject({
      id: 'one',
      name: 'read_file',
      arguments: { path: 'README.md' },
    });
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 4 });
  });

  it('reports an unavailable server without a cloud fallback', async () => {
    const provider = new LlamaCppProvider({
      endpoint: 'http://127.0.0.1:1',
      model: 'test-model',
      timeoutMs: 100,
    });

    await expect(
      provider.generate({ messages: [{ role: 'user', content: 'Hello' }] }),
    ).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
    });
    await expect(provider.healthCheck()).resolves.toMatchObject({ available: false });
  });

  it('rejects malformed tool-call arguments', async () => {
    const endpoint = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          choices: [
            { message: { tool_calls: [{ function: { name: 'read_file', arguments: '{bad' } }] } },
          ],
        }),
      );
    });
    const provider = new LlamaCppProvider({ endpoint, model: 'test-model' });

    await expect(provider.generate({ messages: [] })).rejects.toMatchObject({
      code: 'MODEL_RESPONSE_INVALID',
    });
  });
});
