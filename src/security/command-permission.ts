import { basename } from 'node:path';

export type CommandRisk = 'safe' | 'write' | 'dangerous' | 'unknown';
export type PermissionDecision = 'allow' | 'ask' | 'deny';

export interface CommandClassification {
  readonly risk: CommandRisk;
  readonly decision: PermissionDecision;
  readonly reason: string;
}

const executableName = (program: string): string =>
  basename(program)
    .toLowerCase()
    .replace(/\.(cmd|exe|bat)$/u, '');

export class CommandPermissionManager {
  public classify(program: string, args: readonly string[]): CommandClassification {
    const executable = executableName(program);
    const first = args[0]?.toLowerCase();

    if (['rm', 'del', 'erase', 'rmdir', 'rd', 'format', 'shutdown'].includes(executable)) {
      return { risk: 'dangerous', decision: 'deny', reason: 'Destructive system command.' };
    }
    if (executable === 'git') {
      if (
        ['reset', 'clean', 'push', 'commit', 'checkout', 'switch', 'rebase', 'merge'].includes(
          first ?? '',
        )
      ) {
        return {
          risk: 'dangerous',
          decision: 'deny',
          reason: `Git mutation '${first ?? ''}' is denied.`,
        };
      }
      if (['status', 'diff', 'log', 'branch', 'rev-parse', 'show'].includes(first ?? '')) {
        return { risk: 'safe', decision: 'allow', reason: 'Read-only Git command.' };
      }
    }
    if (executable === 'npm') {
      if (first === 'publish' || first === 'unpublish')
        return { risk: 'dangerous', decision: 'deny', reason: 'Package publishing is denied.' };
      if (first === 'install' || first === 'uninstall' || first === 'update')
        return { risk: 'write', decision: 'ask', reason: 'Dependency changes require approval.' };
      const script = args[1]?.toLowerCase();
      if (
        first === 'test' ||
        (first === 'run' &&
          ['test', 'lint', 'build', 'typecheck', 'format:check'].includes(script ?? ''))
      ) {
        return { risk: 'safe', decision: 'allow', reason: 'Known project verification command.' };
      }
    }
    if (executable === 'node' && ['--version', '-v'].includes(first ?? '')) {
      return { risk: 'safe', decision: 'allow', reason: 'Runtime version inspection.' };
    }
    return {
      risk: 'unknown',
      decision: 'ask',
      reason: 'Command is not in the initial safe allowlist.',
    };
  }
}
