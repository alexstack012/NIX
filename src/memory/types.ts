export const MEMORY_KINDS = [
  'architecture',
  'convention',
  'decision',
  'known_issue',
  'dependency',
] as const;
export type WorkspaceMemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_STATUSES = ['active', 'deprecated', 'superseded'] as const;
export type WorkspaceMemoryStatus = (typeof MEMORY_STATUSES)[number];

export interface WorkspaceMemoryEntry {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: WorkspaceMemoryKind;
  readonly content: string;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly commitHash?: string;
  readonly confidence?: number;
  readonly status: WorkspaceMemoryStatus;
}

export interface AddWorkspaceMemoryInput {
  readonly workspaceId: string;
  readonly kind: WorkspaceMemoryKind;
  readonly content: string;
  readonly source: string;
  readonly commitHash?: string;
  readonly confidence?: number;
  readonly status?: WorkspaceMemoryStatus;
}

export interface ListWorkspaceMemoryOptions {
  readonly kind?: WorkspaceMemoryKind;
  readonly status?: WorkspaceMemoryStatus;
  readonly limit?: number;
}
