export type ModelRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ModelMessage {
  readonly role: ModelRole;
  readonly content: string;
  readonly name?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ModelToolCall[];
}

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ModelRequest {
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly rawArguments: string;
}

export interface ModelUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
}

export interface ModelResponse {
  readonly content: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly finishReason?: string;
  readonly usage?: ModelUsage;
}

export interface ModelHealth {
  readonly available: boolean;
  readonly message: string;
}
