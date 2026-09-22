import type { ModelToolDefinition } from '../model/types.js';
import type { WorkspaceVerificationTracker } from '../agent/workspace-verification.js';
import type { WorkspaceManager } from '../workspace/workspace-manager.js';

export interface ToolContext {
  readonly workspace: WorkspaceManager;
  readonly modifiedFiles?: Set<string>;
  readonly verification?: WorkspaceVerificationTracker;
}

export interface ToolResult {
  readonly ok: boolean;
  readonly output?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface Tool<TInput = unknown> {
  readonly definition: ModelToolDefinition;
  validate(input: unknown): TInput;
  execute(input: TInput, context: ToolContext): Promise<unknown>;
}
