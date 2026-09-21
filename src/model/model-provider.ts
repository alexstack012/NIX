import type { ModelHealth, ModelRequest, ModelResponse } from './types.js';

export interface ModelProvider {
  readonly id: string;
  healthCheck(): Promise<ModelHealth>;
  generate(request: ModelRequest): Promise<ModelResponse>;
}
