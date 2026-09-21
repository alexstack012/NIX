import { randomUUID } from 'node:crypto';

import type { ToolResult } from '../tools/types.js';
import type { WorkspaceMemoryKind, WorkspaceMemoryStatus } from './types.js';

export interface TaskMemoryNote {
  readonly id: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface WorkspaceMemoryProposal {
  readonly id: string;
  readonly kind: WorkspaceMemoryKind;
  readonly content: string;
  readonly source: string;
  readonly commitHash?: string;
  readonly confidence?: number;
  readonly status: WorkspaceMemoryStatus;
}

export interface ProposalInput {
  readonly kind: WorkspaceMemoryKind;
  readonly content: string;
  readonly source: string;
  readonly commitHash?: string;
  readonly confidence?: number;
  readonly status?: WorkspaceMemoryStatus;
}

export interface TaskToolSummary {
  readonly tool: string;
  readonly ok: boolean;
  readonly errorCode?: string;
}

export class TaskMemory {
  readonly #notes: TaskMemoryNote[] = [];
  readonly #proposals: WorkspaceMemoryProposal[] = [];
  readonly #toolSummaries: TaskToolSummary[] = [];

  public constructor(
    private readonly maxNotes = 100,
    private readonly maxProposals = 20,
    private readonly maxToolSummaries = 200,
  ) {}

  public addNote(content: string): TaskMemoryNote {
    const normalized = content.trim();
    if (normalized === '' || normalized.length > 2_000) {
      throw new Error('Task note must contain 1-2000 characters.');
    }
    const note = { id: randomUUID(), content: normalized, createdAt: new Date().toISOString() };
    this.#notes.push(note);
    if (this.#notes.length > this.maxNotes) this.#notes.shift();
    return note;
  }

  public propose(input: ProposalInput): WorkspaceMemoryProposal {
    const proposal: WorkspaceMemoryProposal = {
      id: randomUUID(),
      kind: input.kind,
      content: input.content.trim(),
      source: input.source.trim(),
      ...(input.commitHash === undefined ? {} : { commitHash: input.commitHash }),
      ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
      status: input.status ?? 'active',
    };
    this.#proposals.push(proposal);
    if (this.#proposals.length > this.maxProposals) this.#proposals.shift();
    return proposal;
  }

  public recordToolResult(tool: string, result: ToolResult): void {
    this.#toolSummaries.push({
      tool,
      ok: result.ok,
      ...(result.error === undefined ? {} : { errorCode: result.error.code }),
    });
    if (this.#toolSummaries.length > this.maxToolSummaries) this.#toolSummaries.shift();
  }

  public snapshot(): {
    readonly notes: readonly TaskMemoryNote[];
    readonly proposals: readonly WorkspaceMemoryProposal[];
    readonly toolSummaries: readonly TaskToolSummary[];
  } {
    return {
      notes: [...this.#notes],
      proposals: [...this.#proposals],
      toolSummaries: [...this.#toolSummaries],
    };
  }
}
