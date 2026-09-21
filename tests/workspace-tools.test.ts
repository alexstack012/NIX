import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createReadOnlyToolRegistry } from '../src/tools/create-default-registry.js';
import { ToolRegistry } from '../src/tools/tool-registry.js';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'nix-workspace-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'src', 'hello.ts'), 'export const hello = "world";\nsecond line\n');
  await writeFile(join(root, 'README.md'), '# Fixture\nHello workspace\n');
  await writeFile(join(root, 'node_modules', 'hidden.js'), 'should not appear');
  return { root, workspace: await WorkspaceManager.create(root) };
};

describe('WorkspaceManager', () => {
  it('allows workspace-relative files', async () => {
    const { workspace } = await fixture();
    await expect(workspace.resolveExisting('src/hello.ts')).resolves.toContain('hello.ts');
  });

  it.each(['../outside.txt', '../../Windows', '.git/config', 'node_modules/hidden.js'])(
    'denies unsafe path %s',
    async (path) => {
      const { workspace } = await fixture();
      await expect(workspace.resolveExisting(path)).rejects.toMatchObject({
        code: 'WORKSPACE_PATH_DENIED',
      });
    },
  );

  it('denies absolute paths', async () => {
    const { workspace, root } = await fixture();
    await expect(workspace.resolveExisting(root)).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_DENIED',
    });
  });
});

describe('read-only tools', () => {
  it('lists, reads ranges, and searches without ignored dependencies', async () => {
    const { workspace } = await fixture();
    const registry = createReadOnlyToolRegistry();
    const context = { workspace };

    const listed = await registry.execute('list_directory', {}, context);
    expect(listed).toMatchObject({ ok: true });
    expect(JSON.stringify(listed)).not.toContain('node_modules');

    await expect(
      registry.execute(
        'read_file_range',
        { path: 'src/hello.ts', startLine: 2, endLine: 2 },
        context,
      ),
    ).resolves.toMatchObject({ ok: true, output: { content: 'second line' } });

    const files = await registry.execute('search_files', { query: 'hello' }, context);
    expect(files).toMatchObject({ ok: true, output: ['src/hello.ts'] });

    const text = await registry.execute('search_text', { query: 'workspace' }, context);
    expect(text).toMatchObject({ ok: true, output: [{ path: 'README.md', line: 2 }] });
    expect(JSON.stringify(text)).not.toContain('hidden.js');
  });

  it('returns structured validation and unknown-tool errors', async () => {
    const { workspace } = await fixture();
    const registry = createReadOnlyToolRegistry();

    await expect(registry.execute('read_file', {}, { workspace })).resolves.toMatchObject({
      ok: false,
      error: { code: 'TOOL_INPUT_INVALID' },
    });
    await expect(registry.execute('not_real', {}, { workspace })).resolves.toMatchObject({
      ok: false,
      error: { code: 'TOOL_NOT_FOUND' },
    });
  });

  it('rejects oversized full reads but streams bounded line ranges', async () => {
    const { root, workspace } = await fixture();
    await writeFile(
      join(root, 'large.txt'),
      `${'x'.repeat(300_000)}\ntarget line\n${'y'.repeat(300_000)}`,
    );
    const registry = createReadOnlyToolRegistry();

    await expect(
      registry.execute('read_file', { path: 'large.txt' }, { workspace }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'FILE_TOO_LARGE' } });
    await expect(
      registry.execute(
        'read_file_range',
        { path: 'large.txt', startLine: 2, endLine: 2 },
        { workspace },
      ),
    ).resolves.toMatchObject({ ok: true, output: { content: 'target line' } });
    await expect(
      registry.execute(
        'read_file_range',
        { path: 'large.txt', startLine: 1, endLine: 2001 },
        { workspace },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'TOOL_INPUT_INVALID' } });
  });

  it('rejects duplicate tool names', () => {
    const registry = new ToolRegistry();
    const tool = {
      definition: { name: 'test', description: 'test', inputSchema: {} },
      validate: (input: unknown) => input,
      execute: (input: unknown) => Promise.resolve(input),
    };
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow('Duplicate tool');
  });
});
