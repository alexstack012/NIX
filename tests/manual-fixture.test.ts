import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { createManualFixture } from '../src/dev/manual-fixture.js';

const exec = promisify(execFile);

describe('manual test fixture', () => {
  it('creates a tested, clean Git repository and refuses to overwrite it', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'nix-manual-fixture-'));
    const destination = join(temporaryDirectory, 'profile-app');

    await expect(createManualFixture(destination)).resolves.toBe(destination);
    await expect(exec(process.execPath, ['--test'], { cwd: destination })).resolves.toMatchObject({
      stderr: '',
    });
    await expect(
      exec('git', ['status', '--porcelain'], { cwd: destination }),
    ).resolves.toMatchObject({ stdout: '' });
    await expect(createManualFixture(destination)).rejects.toMatchObject({
      code: 'FIXTURE_EXISTS',
    });
  });
});
