import {
  MEMORY_KINDS,
  MEMORY_STATUSES,
  type WorkspaceMemoryKind,
  type WorkspaceMemoryStatus,
} from '../memory/types.js';
import type { TaskMemory } from '../memory/task-memory.js';
import { NixError } from '../shared/errors.js';
import type { Tool } from './types.js';
import { objectInput, stringField } from './validation.js';

interface NoteInput {
  readonly content: string;
}
interface ProposalToolInput {
  readonly kind: WorkspaceMemoryKind;
  readonly content: string;
  readonly source: string;
  readonly commitHash: string | undefined;
  readonly confidence: number | undefined;
  readonly status: WorkspaceMemoryStatus | undefined;
}

const enumValue = <T extends string>(value: unknown, values: readonly T[], name: string): T => {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new NixError(`Invalid ${name}.`, 'TOOL_INPUT_INVALID');
  }
  return value as T;
};

export const createTaskMemoryTools = (taskMemory: TaskMemory): readonly Tool[] => {
  const note: Tool<NoteInput> = {
    definition: {
      name: 'record_task_note',
      description:
        'Record a concise temporary note for this task only. It is discarded after the run.',
      inputSchema: {
        type: 'object',
        properties: { content: { type: 'string' } },
        required: ['content'],
        additionalProperties: false,
      },
    },
    validate(input) {
      return { content: stringField(objectInput(input), 'content') };
    },
    execute(input) {
      return Promise.resolve(taskMemory.addNote(input.content));
    },
  };
  const list: Tool<Record<string, never>> = {
    definition: {
      name: 'list_task_memory',
      description:
        'List temporary notes and concise tool outcomes for this task. This is not durable workspace memory.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    validate(input) {
      objectInput(input);
      return {};
    },
    execute() {
      return Promise.resolve(taskMemory.snapshot());
    },
  };
  const propose: Tool<ProposalToolInput> = {
    definition: {
      name: 'propose_workspace_memory',
      description:
        'Propose one concise durable workspace fact for user approval. This does not save the fact.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: MEMORY_KINDS },
          content: { type: 'string' },
          source: { type: 'string' },
          commitHash: { type: 'string' },
          confidence: { type: 'number' },
          status: { type: 'string', enum: MEMORY_STATUSES },
        },
        required: ['kind', 'content', 'source'],
        additionalProperties: false,
      },
    },
    validate(input) {
      const value = objectInput(input);
      const confidence = value.confidence;
      if (
        confidence !== undefined &&
        (typeof confidence !== 'number' ||
          !Number.isFinite(confidence) ||
          confidence < 0 ||
          confidence > 1)
      ) {
        throw new NixError('confidence must be between 0 and 1.', 'TOOL_INPUT_INVALID');
      }
      const commitHash = value.commitHash;
      if (commitHash !== undefined && (typeof commitHash !== 'string' || commitHash === ''))
        throw new NixError('commitHash must be a non-empty string.', 'TOOL_INPUT_INVALID');
      return {
        kind: enumValue(value.kind, MEMORY_KINDS, 'memory kind'),
        content: stringField(value, 'content'),
        source: stringField(value, 'source'),
        commitHash,
        confidence,
        status:
          value.status === undefined
            ? undefined
            : enumValue(value.status, MEMORY_STATUSES, 'memory status'),
      };
    },
    execute(input) {
      if (input.content.length > 4_000)
        throw new NixError('Memory proposal is too long.', 'TOOL_INPUT_INVALID');
      return Promise.resolve({
        saved: false,
        proposal: taskMemory.propose({
          kind: input.kind,
          content: input.content,
          source: input.source,
          ...(input.commitHash === undefined ? {} : { commitHash: input.commitHash }),
          ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
          ...(input.status === undefined ? {} : { status: input.status }),
        }),
      });
    },
  };
  return [note, list, propose];
};
