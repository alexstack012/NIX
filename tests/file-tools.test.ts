import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDefaultToolRegistry } from '../src/tools/create-default-registry.js';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'nix-write-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'value.txt'), 'alpha\nbeta\nalpha\n');
  return {
    root,
    workspace: await WorkspaceManager.create(root),
    registry: createDefaultToolRegistry(),
  };
};

describe('file modification tools', () => {
  it('creates, writes, patches, and tracks files', async () => {
    const { root, workspace, registry } = await setup();
    const modifiedFiles = new Set<string>();
    const context = { workspace, modifiedFiles };

    await expect(
      registry.execute('create_file', { path: 'src/new.txt', content: 'one' }, context),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      registry.execute('write_file', { path: 'src/new.txt', content: 'one two' }, context),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      registry.execute(
        'apply_patch',
        { path: 'src/new.txt', oldText: 'two', newText: 'three' },
        context,
      ),
    ).resolves.toMatchObject({ ok: true });

    expect(await readFile(join(root, 'src', 'new.txt'), 'utf8')).toBe('one three');
    expect([...modifiedFiles]).toEqual(['src/new.txt']);
  });

  it('refuses overwrite, ambiguous patches, and traversal writes', async () => {
    const { workspace, registry } = await setup();
    const context = { workspace };

    await expect(
      registry.execute('create_file', { path: 'src/value.txt', content: 'x' }, context),
    ).resolves.toMatchObject({ ok: false, error: { code: 'FILE_EXISTS' } });
    await expect(
      registry.execute(
        'apply_patch',
        { path: 'src/value.txt', oldText: 'alpha', newText: 'x' },
        context,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'PATCH_AMBIGUOUS' } });
    await expect(
      registry.execute('create_file', { path: '../escape.txt', content: 'x' }, context),
    ).resolves.toMatchObject({ ok: false, error: { code: 'WORKSPACE_PATH_DENIED' } });
  });
});
