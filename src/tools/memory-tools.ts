import {
  MEMORY_KINDS,
  MEMORY_STATUSES,
  type WorkspaceMemoryKind,
  type WorkspaceMemoryStatus,
} from '../memory/types.js';
import type { WorkspaceMemory } from '../memory/workspace-memory.js';
import { NixError } from '../shared/errors.js';
import type { Tool } from './types.js';
import { integerField, objectInput, stringField } from './validation.js';

const advisory =
  'Memory is advisory and may be stale. Current source, tests, and configuration take precedence.';

const optionalKind = (value: Record<string, unknown>): WorkspaceMemoryKind | undefined => {
  const kind = value.kind;
  if (kind === undefined) return undefined;
  if (typeof kind !== 'string' || !MEMORY_KINDS.includes(kind as WorkspaceMemoryKind)) {
    throw new NixError('Invalid workspace memory kind.', 'TOOL_INPUT_INVALID');
  }
  return kind as WorkspaceMemoryKind;
};

const optionalStatus = (value: Record<string, unknown>): WorkspaceMemoryStatus | undefined => {
  const status = value.status;
  if (status === undefined) return undefined;
  if (typeof status !== 'string' || !MEMORY_STATUSES.includes(status as WorkspaceMemoryStatus)) {
    throw new NixError('Invalid workspace memory status.', 'TOOL_INPUT_INVALID');
  }
  return status as WorkspaceMemoryStatus;
};

interface SearchMemoryToolInput {
  readonly query: string;
  readonly kind: WorkspaceMemoryKind | undefined;
  readonly status: WorkspaceMemoryStatus | undefined;
  readonly limit: number;
}

interface ListMemoryToolInput {
  readonly kind: WorkspaceMemoryKind | undefined;
  readonly status: WorkspaceMemoryStatus | undefined;
  readonly limit: number;
}

export const createWorkspaceMemoryTools = (
  memory: WorkspaceMemory,
  workspaceId: string,
): readonly Tool[] => {
  const searchTool: Tool<SearchMemoryToolInput> = {
    definition: {
      name: 'search_workspace_memory',
      description: `Search concise stored facts for this workspace. ${advisory}`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          kind: { type: 'string', enum: MEMORY_KINDS },
          status: { type: 'string', enum: MEMORY_STATUSES },
          limit: { type: 'integer' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    validate(input) {
      const value = objectInput(input);
      return {
        query: stringField(value, 'query'),
        kind: optionalKind(value),
        status: optionalStatus(value),
        limit: integerField(value, 'limit', 20, 100),
      };
    },
    execute(input) {
      return Promise.resolve({
        advisory,
        entries: memory.search(workspaceId, input.query, {
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.status === undefined ? {} : { status: input.status }),
          limit: input.limit,
        }),
      });
    },
  };
  const listTool: Tool<ListMemoryToolInput> = {
    definition: {
      name: 'list_workspace_memory',
      description: `List bounded structured facts for this workspace. ${advisory}`,
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: MEMORY_KINDS },
          status: { type: 'string', enum: MEMORY_STATUSES },
          limit: { type: 'integer' },
        },
        additionalProperties: false,
      },
    },
    validate(input) {
      const value = objectInput(input);
      return {
        kind: optionalKind(value),
        status: optionalStatus(value),
        limit: integerField(value, 'limit', 20, 100),
      };
    },
    execute(input) {
      return Promise.resolve({
        advisory,
        entries: memory.list(workspaceId, {
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.status === undefined ? {} : { status: input.status }),
          limit: input.limit,
        }),
      });
    },
  };
  return [searchTool, listTool];
};
