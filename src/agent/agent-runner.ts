import { randomUUID } from 'node:crypto';

import type { ModelProvider } from '../model/model-provider.js';
import type { ModelMessage, ModelToolDefinition } from '../model/types.js';
import { TaskMemory, type WorkspaceMemoryProposal } from '../memory/task-memory.js';
import { NixError } from '../shared/errors.js';
import type { CoordinationTracker, CoordinatedWorkspaceState } from './coordination-tracker.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { ToolResult } from '../tools/types.js';
import type { WorkspaceManager } from '../workspace/workspace-manager.js';
import { NullTaskLogger, type TaskLogger } from './task-logger.js';
import {
  WorkspaceVerificationTracker,
  type PrimaryWorkspaceVerificationState,
} from './workspace-verification.js';

export interface AgentRunnerOptions {
  readonly provider: ModelProvider;
  readonly tools: ToolRegistry;
  readonly workspace: WorkspaceManager;
  readonly maxIterations?: number;
  readonly logger?: TaskLogger;
  readonly taskMemory?: TaskMemory;
  readonly coordination?: CoordinationTracker;
  readonly maxToolResultCharacters?: number;
  readonly maxTaskContextCharacters?: number;
  readonly maxMalformedToolCallRecoveries?: number;
}

export interface AgentRunResult {
  readonly taskId: string;
  readonly status: 'completed' | 'max_iterations' | 'context_limit';
  readonly response: string;
  readonly iterations: number;
  readonly toolCalls: number;
  readonly errors: number;
  readonly durationMs: number;
  readonly modifiedFiles: readonly string[];
  readonly memoryProposals: readonly WorkspaceMemoryProposal[];
  readonly coordination: readonly CoordinatedWorkspaceState[];
  readonly workspaceVerification: PrimaryWorkspaceVerificationState;
}

const SYSTEM_PROMPT = `You are Nix, a local coding agent. Work progressively: inspect, implement if requested, verify, review the diff, and report. After modifying the primary workspace, run an available safe project verification command and call git_diff without a path after the most recent change before reporting completion. Do not invent file contents or tool arguments. Keep tool requests narrow and workspace-relative. Prefer precise patches over full-file replacement. Evidence priority is: current source, current tests, current configuration, workspace memory, then historical task information. Workspace memory is advisory and may be stale; verify it against the repository. Task notes are temporary. If a concise durable fact was learned, use propose_workspace_memory; proposals are shown for user approval and are not saved automatically.`;

export class AgentRunner {
  readonly #provider: ModelProvider;
  readonly #tools: ToolRegistry;
  readonly #workspace: WorkspaceManager;
  readonly #maxIterations: number;
  readonly #logger: TaskLogger;
  readonly #taskMemory: TaskMemory;
  readonly #coordination: CoordinationTracker | undefined;
  readonly #maxToolResultCharacters: number;
  readonly #maxTaskContextCharacters: number;
  readonly #maxMalformedToolCallRecoveries: number;

  public constructor(options: AgentRunnerOptions) {
    this.#provider = options.provider;
    this.#tools = options.tools;
    this.#workspace = options.workspace;
    this.#maxIterations = options.maxIterations ?? 30;
    this.#logger = options.logger ?? new NullTaskLogger();
    this.#taskMemory = options.taskMemory ?? new TaskMemory();
    this.#coordination = options.coordination;
    this.#maxTaskContextCharacters = options.maxTaskContextCharacters ?? 120_000;
    this.#maxToolResultCharacters =
      options.maxToolResultCharacters ??
      Math.max(1_000, Math.floor(this.#maxTaskContextCharacters / 2));
    this.#maxMalformedToolCallRecoveries = options.maxMalformedToolCallRecoveries ?? 2;
    if (this.#maxToolResultCharacters < 1_000) {
      throw new Error('maxToolResultCharacters must be at least 1000.');
    }
    if (this.#maxTaskContextCharacters < 1_000) {
      throw new Error('maxTaskContextCharacters must be at least 1000.');
    }
    if (this.#maxMalformedToolCallRecoveries < 0) {
      throw new Error('maxMalformedToolCallRecoveries cannot be negative.');
    }
  }

  public async run(task: string): Promise<AgentRunResult> {
    const taskId = randomUUID();
    const started = Date.now();
    let toolCalls = 0;
    let errors = 0;
    let malformedToolCallRecoveries = 0;
    const modifiedFiles = new Set<string>();
    const verification = new WorkspaceVerificationTracker(this.#workspace.root);
    await verification.refreshAvailableCommands();
    const toolDefinitions = this.#tools.definitions();
    const messages: ModelMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: task },
    ];
    await this.#event(taskId, 'task_started', {
      workspace: this.#workspace.root,
      provider: this.#provider.id,
    });

    try {
      for (let iteration = 1; iteration <= this.#maxIterations; iteration += 1) {
        const contextCharacters = this.#estimateContextCharacters(messages, toolDefinitions);
        await this.#event(taskId, 'context_usage', {
          iteration,
          characters: contextCharacters,
          limit: this.#maxTaskContextCharacters,
        });
        if (contextCharacters > this.#maxTaskContextCharacters) {
          const result = this.#result(
            taskId,
            'context_limit',
            `Stopped before another model request because accumulated task context exceeded ${String(this.#maxTaskContextCharacters)} characters.`,
            iteration - 1,
            toolCalls,
            errors,
            started,
            modifiedFiles,
            verification,
          );
          await this.#event(taskId, 'task_stopped', { ...result });
          return result;
        }
        await this.#event(taskId, 'iteration_started', { iteration, contextCharacters });
        const response = await this.#provider.generate({
          messages,
          tools: toolDefinitions,
        });
        if (response.issues !== undefined && response.issues.length > 0) {
          malformedToolCallRecoveries += 1;
          errors += response.issues.length;
          await this.#event(taskId, 'model_response_recovery', {
            iteration,
            attempt: malformedToolCallRecoveries,
            maximum: this.#maxMalformedToolCallRecoveries,
            issues: response.issues,
          });
          if (malformedToolCallRecoveries > this.#maxMalformedToolCallRecoveries) {
            throw new NixError(
              `Model exceeded the malformed tool-call recovery limit of ${String(this.#maxMalformedToolCallRecoveries)}.`,
              'MODEL_RESPONSE_INVALID',
            );
          }
          messages.push({ role: 'assistant', content: response.content });
          messages.push({
            role: 'user',
            content: `Your previous response contained invalid tool calls. No tools from that response were executed. Correct the call using the supplied tool schema and valid JSON. Problems: ${response.issues.map((issue) => issue.message).join(' | ')}`,
          });
          continue;
        }
        if (response.toolCalls.length === 0) {
          await verification.refreshAvailableCommands();
          const blockers = [
            ...verification.blockers().map((blocker) => `primary workspace: ${blocker}`),
            ...(this.#coordination?.blockers() ?? []),
          ];
          if (blockers.length > 0) {
            messages.push({
              role: 'user',
              content: `Cannot complete task yet. Resolve these requirements with the available safe tools: ${blockers.join(' | ')}`,
            });
            continue;
          }
          const result = this.#result(
            taskId,
            'completed',
            response.content,
            iteration,
            toolCalls,
            errors,
            started,
            modifiedFiles,
            verification,
          );
          await this.#event(taskId, 'task_completed', { ...result });
          return result;
        }

        messages.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls,
        });
        for (const call of response.toolCalls) {
          toolCalls += 1;
          const result = await this.#tools.execute(call.name, call.arguments, {
            workspace: this.#workspace,
            modifiedFiles,
            verification,
          });
          this.#taskMemory.recordToolResult(call.name, result);
          if (!result.ok) errors += 1;
          await this.#event(taskId, 'tool_result', {
            iteration,
            tool: call.name,
            callId: call.id,
            ok: result.ok,
            ...(result.ok ? {} : { error: result.error }),
          });
          const serialized = this.#serializeToolResult(result);
          messages.push({
            role: 'tool',
            name: call.name,
            toolCallId: call.id,
            content: serialized.content,
          });
          if (serialized.truncated) {
            await this.#event(taskId, 'tool_result_truncated', {
              iteration,
              tool: call.name,
              callId: call.id,
              originalCharacters: serialized.originalCharacters,
            });
          }
        }
      }

      const result = this.#result(
        taskId,
        'max_iterations',
        `Stopped after ${String(this.#maxIterations)} iterations without a final response.`,
        this.#maxIterations,
        toolCalls,
        errors,
        started,
        modifiedFiles,
        verification,
      );
      await this.#event(taskId, 'task_stopped', { ...result });
      return result;
    } catch (error) {
      errors += 1;
      await this.#event(taskId, 'task_failed', {
        errors,
        toolCalls,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        ...(typeof error === 'object' && error !== null && 'code' in error
          ? { code: String(error.code) }
          : {}),
      });
      throw error;
    }
  }

  #result(
    taskId: string,
    status: AgentRunResult['status'],
    response: string,
    iterations: number,
    toolCalls: number,
    errors: number,
    started: number,
    modifiedFiles: Set<string>,
    verification: WorkspaceVerificationTracker,
  ): AgentRunResult {
    return {
      taskId,
      status,
      response,
      iterations,
      toolCalls,
      errors,
      durationMs: Date.now() - started,
      modifiedFiles: [...modifiedFiles].sort(),
      memoryProposals: this.#taskMemory.snapshot().proposals,
      coordination: this.#coordination?.snapshot() ?? [],
      workspaceVerification: verification.snapshot(),
    };
  }

  #event(taskId: string, type: string, data: Readonly<Record<string, unknown>>): Promise<void> {
    return this.#logger.log({ timestamp: new Date().toISOString(), taskId, type, data });
  }

  #serializeToolResult(result: ToolResult): {
    readonly content: string;
    readonly truncated: boolean;
    readonly originalCharacters: number;
  } {
    const serialized = JSON.stringify(result);
    if (serialized.length <= this.#maxToolResultCharacters) {
      return { content: serialized, truncated: false, originalCharacters: serialized.length };
    }
    const previewLength = Math.max(1, this.#maxToolResultCharacters - 160);
    const content = JSON.stringify({
      ok: result.ok,
      truncated: true,
      originalCharacters: serialized.length,
      preview: serialized.slice(0, previewLength),
    });
    return { content, truncated: true, originalCharacters: serialized.length };
  }

  #estimateContextCharacters(
    messages: readonly ModelMessage[],
    tools: readonly ModelToolDefinition[],
  ): number {
    return JSON.stringify({ messages, tools }).length;
  }
}
