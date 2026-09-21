import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildRepositoryMap } from '../src/workspace/repository-map.js';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';

describe('buildRepositoryMap', () => {
  it('maps source symbols, filters queries, and ignores generated paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-map-'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'node_modules'));
    await writeFile(
      join(root, 'src', 'auth.ts'),
      'export class AuthService {\n  login() { return true; }\n}\nexport const logout = () => false;\n',
    );
    await writeFile(join(root, 'src', 'notes.md'), '# not source');
    await writeFile(join(root, 'node_modules', 'hidden.ts'), 'export class Hidden {}');
    const workspace = await WorkspaceManager.create(root);

    const result = await buildRepositoryMap(workspace, { query: 'auth' });

    expect(result.entries).toEqual([
      { path: 'src/auth.ts', symbols: ['AuthService', 'login()', 'logout'] },
    ]);
    expect(result).toMatchObject({
      filesScanned: 2,
      filesMapped: 1,
      filesReturned: 1,
      truncated: false,
    });
  });
});
