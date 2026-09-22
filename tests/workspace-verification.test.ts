import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  npmVerificationScript,
  WorkspaceVerificationTracker,
} from '../src/agent/workspace-verification.js';

describe('WorkspaceVerificationTracker', () => {
  it('detects exposed scripts and makes verification and diff review stale after every edit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-verification-'));
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'node --test', custom: 'node custom.js' } }),
    );
    const tracker = new WorkspaceVerificationTracker(root);
    await tracker.refreshAvailableCommands();

    tracker.modified('src/first.ts');
    tracker.verificationSucceeded('test', 'npm test');
    tracker.diffReviewed();
    expect(tracker.blockers()).toEqual([]);

    tracker.modified('src/second.ts');
    expect(tracker.blockers()).toEqual([
      'successful project verification required (available npm scripts: test)',
      'full Git diff review required',
    ]);
    expect(tracker.snapshot()).toMatchObject({
      modifiedFiles: ['src/first.ts', 'src/second.ts'],
      verified: false,
      diffReviewed: false,
    });
  });

  it('only recognizes safe npm verification forms', () => {
    expect(npmVerificationScript('npm.cmd', ['test'])).toBe('test');
    expect(npmVerificationScript('npm', ['run', 'typecheck'])).toBe('typecheck');
    expect(npmVerificationScript('npm', ['install'])).toBeUndefined();
    expect(npmVerificationScript('powershell', ['npm', 'test'])).toBeUndefined();
  });
});
