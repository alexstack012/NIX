import { execFile } from 'node:child_process';
import { cp, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { NixError } from '../shared/errors.js';

const exec = promisify(execFile);
const templateDirectory = fileURLToPath(
  new URL('../../fixtures/static-profile-app/', import.meta.url),
);

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

export const createManualFixture = async (destination: string): Promise<string> => {
  const target = resolve(destination);
  if (await exists(target)) {
    throw new NixError(
      `Manual test destination already exists; choose a new path: ${target}`,
      'FIXTURE_EXISTS',
    );
  }

  await mkdir(dirname(target), { recursive: true });
  await cp(templateDirectory, target, { recursive: true, errorOnExist: true });
  await exec('git', ['init'], { cwd: target });
  await exec('git', ['add', '.'], { cwd: target });
  await exec(
    'git',
    [
      '-c',
      'user.name=Nix Fixture',
      '-c',
      'user.email=nix-fixture@localhost',
      'commit',
      '-m',
      'Create manual test baseline',
    ],
    { cwd: target },
  );
  return target;
};
