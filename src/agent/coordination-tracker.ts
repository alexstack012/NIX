export interface CoordinatedWorkspaceState {
  readonly workspaceId: string;
  readonly name: string;
  readonly modifiedFiles: readonly string[];
  readonly verified: boolean;
  readonly diffReviewed: boolean;
}

interface MutableState {
  readonly workspaceId: string;
  readonly name: string;
  readonly modifiedFiles: Set<string>;
  verified: boolean;
  diffReviewed: boolean;
}

export class CoordinationTracker {
  readonly #states = new Map<string, MutableState>();

  public register(workspaceId: string, name: string): void {
    this.#states.set(workspaceId, {
      workspaceId,
      name,
      modifiedFiles: new Set(),
      verified: false,
      diffReviewed: false,
    });
  }

  public modified(workspaceId: string, path: string): void {
    const state = this.#required(workspaceId);
    state.modifiedFiles.add(path);
    state.verified = false;
    state.diffReviewed = false;
  }

  public verified(workspaceId: string): void {
    this.#required(workspaceId).verified = true;
  }

  public diffReviewed(workspaceId: string): void {
    this.#required(workspaceId).diffReviewed = true;
  }

  public blockers(): readonly string[] {
    return this.snapshot()
      .filter((state) => state.modifiedFiles.length > 0 && (!state.verified || !state.diffReviewed))
      .map((state) =>
        `${state.name}: ${state.verified ? '' : 'successful verification required; '}${state.diffReviewed ? '' : 'Git diff review required'}`.trim(),
      );
  }

  public snapshot(): readonly CoordinatedWorkspaceState[] {
    return [...this.#states.values()].map((state) => ({
      workspaceId: state.workspaceId,
      name: state.name,
      modifiedFiles: [...state.modifiedFiles].sort(),
      verified: state.verified,
      diffReviewed: state.diffReviewed,
    }));
  }

  #required(workspaceId: string): MutableState {
    const state = this.#states.get(workspaceId);
    if (state === undefined)
      throw new Error(`Workspace is outside coordination scope: ${workspaceId}`);
    return state;
  }
}
