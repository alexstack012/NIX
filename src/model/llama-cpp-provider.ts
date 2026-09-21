import { NixError } from '../shared/errors.js';
import type { ModelProvider } from './model-provider.js';
import type {
  ModelHealth,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
  ModelUsage,
} from './types.js';

export interface LlamaCppProviderOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

interface ChatCompletionPayload {
  readonly choices?: readonly {
    readonly finish_reason?: string;
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: readonly RawToolCall[];
    };
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

interface RawToolCall {
  readonly id?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}

const endpointUrl = (base: string, path: string): URL =>
  new URL(path, `${base.replace(/\/$/, '')}/`);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class LlamaCppProvider implements ModelProvider {
  public readonly id = 'llama.cpp';
  readonly #endpoint: string;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  public constructor(options: LlamaCppProviderOptions) {
    this.#endpoint = options.endpoint;
    this.#model = options.model;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public async healthCheck(): Promise<ModelHealth> {
    try {
      const response = await this.#request(endpointUrl(this.#endpoint, 'health'), {
        method: 'GET',
      });
      if (!response.ok) {
        return {
          available: false,
          message: `llama.cpp health check returned HTTP ${String(response.status)}.`,
        };
      }
      return { available: true, message: 'Local llama.cpp server is available.' };
    } catch (error) {
      return {
        available: false,
        message: `Local llama.cpp server is unavailable at ${this.#endpoint}: ${errorMessage(error)}`,
      };
    }
  }

  public async generate(request: ModelRequest): Promise<ModelResponse> {
    let response: Response;
    try {
      response = await this.#request(endpointUrl(this.#endpoint, 'v1/chat/completions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.#model,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.name === undefined ? {} : { name: message.name }),
            ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
            ...(message.toolCalls === undefined
              ? {}
              : {
                  tool_calls: message.toolCalls.map((call) => ({
                    id: call.id,
                    type: 'function',
                    function: { name: call.name, arguments: call.rawArguments },
                  })),
                }),
          })),
          ...(request.tools === undefined
            ? {}
            : {
                tools: request.tools.map((tool) => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  },
                })),
                tool_choice: 'auto',
              }),
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
          stream: false,
        }),
      });
    } catch (error) {
      throw new NixError(
        `Local inference server is unavailable at ${this.#endpoint}. Start llama.cpp and try again.`,
        'MODEL_UNAVAILABLE',
        { cause: error },
      );
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2_000);
      throw new NixError(
        `llama.cpp request failed with HTTP ${String(response.status)}${detail === '' ? '' : `: ${detail}`}`,
        'MODEL_HTTP_ERROR',
      );
    }

    const payload = (await response.json()) as ChatCompletionPayload;
    const choice = payload.choices?.[0];
    if (choice?.message === undefined) {
      throw new NixError('llama.cpp returned no assistant message.', 'MODEL_RESPONSE_INVALID');
    }

    const toolCalls = (choice.message.tool_calls ?? []).map((call, index) =>
      this.#parseToolCall(call, index),
    );
    const usage: ModelUsage | undefined = payload.usage
      ? {
          ...(payload.usage.prompt_tokens === undefined
            ? {}
            : { promptTokens: payload.usage.prompt_tokens }),
          ...(payload.usage.completion_tokens === undefined
            ? {}
            : { completionTokens: payload.usage.completion_tokens }),
        }
      : undefined;

    return {
      content: choice.message.content ?? '',
      toolCalls,
      ...(choice.finish_reason === undefined ? {} : { finishReason: choice.finish_reason }),
      ...(usage === undefined ? {} : { usage }),
    };
  }

  async #request(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  #parseToolCall(call: RawToolCall, index: number): ModelToolCall {
    const name = call.function?.name;
    const rawArguments = call.function?.arguments ?? '{}';
    if (name === undefined || name === '') {
      throw new NixError(
        'llama.cpp returned a tool call without a name.',
        'MODEL_RESPONSE_INVALID',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawArguments) as unknown;
    } catch (error) {
      throw new NixError(
        `Tool call ${name} contained invalid JSON arguments.`,
        'MODEL_RESPONSE_INVALID',
        {
          cause: error,
        },
      );
    }

    return {
      id: call.id ?? `call-${String(index + 1)}`,
      name,
      arguments: parsed,
      rawArguments,
    };
  }
}
