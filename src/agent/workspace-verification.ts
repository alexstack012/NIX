import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const KNOWN_VERIFICATION_SCRIPTS = ['test', 'lint', 'build', 'typecheck', 'format:check'] as const;

export interface PrimaryWorkspaceVerificationState {
  readonly modifiedFiles: readonly string[];
  readonly availableVerificationScripts: readonly string[];
  readonly verified: boolean;
  readonly verificationCommand?: string;
  readonly diffReviewed: boolean;
}

export class WorkspaceVerificationTracker {
  readonly #root: string;
  readonly #modifiedFiles = new Set<string>();
  #availableVerificationScripts: readonly string[] = [];
  #verified = false;
  #verificationCommand: string | undefined;
  #diffReviewed = false;

  public constructor(root: string) {
    this.#root = root;
  }

  public async refreshAvailableCommands(): Promise<void> {
    try {
      const parsed = JSON.parse(
        await readFile(join(this.#root, 'package.json'), 'utf8'),
      ) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        this.#availableVerificationScripts = [];
        return;
      }
      const scripts = (parsed as { readonly scripts?: unknown }).scripts;
      if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) {
        this.#availableVerificationScripts = [];
        return;
      }
      this.#availableVerificationScripts = KNOWN_VERIFICATION_SCRIPTS.filter(
        (name) => typeof (scripts as Record<string, unknown>)[name] === 'string',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
        this.#availableVerificationScripts = [];
        return;
      }
      throw error;
    }
  }

  public modified(path: string): void {
    this.#modifiedFiles.add(path);
    this.#verified = false;
    this.#verificationCommand = undefined;
    this.#diffReviewed = false;
  }

  public verificationSucceeded(script: string, command: string): void {
    if (!this.#availableVerificationScripts.includes(script)) return;
    this.#verified = true;
    this.#verificationCommand = command;
  }

  public diffReviewed(): void {
    this.#diffReviewed = true;
  }

  public blockers(): readonly string[] {
    if (this.#modifiedFiles.size === 0) return [];
    const blockers: string[] = [];
    if (this.#availableVerificationScripts.length > 0 && !this.#verified) {
      blockers.push(
        `successful project verification required (available npm scripts: ${this.#availableVerificationScripts.join(', ')})`,
      );
    }
    if (!this.#diffReviewed) blockers.push('full Git diff review required');
    return blockers;
  }

  public snapshot(): PrimaryWorkspaceVerificationState {
    return {
      modifiedFiles: [...this.#modifiedFiles].sort(),
      availableVerificationScripts: [...this.#availableVerificationScripts],
      verified: this.#verified,
      ...(this.#verificationCommand === undefined
        ? {}
        : { verificationCommand: this.#verificationCommand }),
      diffReviewed: this.#diffReviewed,
    };
  }
}

export const npmVerificationScript = (
  program: string,
  args: readonly string[],
): string | undefined => {
  if (!/^npm(?:\.cmd|\.exe)?$/iu.test(program)) return undefined;
  if (args[0]?.toLowerCase() === 'test') return 'test';
  if (args[0]?.toLowerCase() !== 'run') return undefined;
  const script = args[1]?.toLowerCase();
  return KNOWN_VERIFICATION_SCRIPTS.includes(script as (typeof KNOWN_VERIFICATION_SCRIPTS)[number])
    ? script
    : undefined;
};
