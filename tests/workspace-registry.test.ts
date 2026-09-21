import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { WorkspaceRegistry } from '../src/workspace/workspace-registry.js';

const exec = promisify(execFile);

describe('WorkspaceRegistry', () => {
  it('persists, resolves, sorts, and removes canonical workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-registry-'));
    const storage = join(root, 'storage');
    const firstPath = join(root, 'first');
    const secondPath = join(root, 'second');
    await mkdir(firstPath);
    await mkdir(secondPath);
    const registry = new WorkspaceRegistry(storage);

    const second = await registry.add(secondPath, 'Zulu');
    const first = await registry.add(firstPath, 'alpha');
    const reloaded = new WorkspaceRegistry(storage);

    expect((await reloaded.list()).map((entry) => entry.name)).toEqual(['alpha', 'Zulu']);
    await expect(reloaded.get('ALPHA')).resolves.toEqual(first);
    await expect(reloaded.get(second.id)).resolves.toEqual(second);
    await expect(reloaded.remove('zulu')).resolves.toEqual(second);
    expect((await reloaded.list()).map((entry) => entry.name)).toEqual(['alpha']);
  });

  it('rejects duplicate names, duplicate paths, and invalid names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-registry-'));
    const firstPath = join(root, 'first');
    const secondPath = join(root, 'second');
    await mkdir(firstPath);
    await mkdir(secondPath);
    const registry = new WorkspaceRegistry(join(root, 'storage'));
    await registry.add(firstPath, 'Project');

    await expect(registry.add(secondPath, 'project')).rejects.toMatchObject({
      code: 'WORKSPACE_EXISTS',
    });
    await expect(registry.add(firstPath, 'different')).rejects.toMatchObject({
      code: 'WORKSPACE_EXISTS',
    });
    await expect(registry.add(secondPath, 'bad name')).rejects.toMatchObject({
      code: 'INVALID_WORKSPACE_NAME',
    });
  });

  it('rejects malformed registry storage rather than discarding it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-registry-'));
    const storage = join(root, 'storage');
    await mkdir(storage);
    await writeFile(join(storage, 'workspaces.json'), '{broken');

    await expect(new WorkspaceRegistry(storage).list()).rejects.toMatchObject({
      code: 'WORKSPACE_REGISTRY_INVALID',
    });
  });
});

describe('workspace CLI', () => {
  it('adds, lists, inspects, and removes a workspace when launched elsewhere', async () => {
    const projectRoot = process.cwd();
    const root = await mkdtemp(join(tmpdir(), 'nix-registry-cli-'));
    const repository = join(root, 'repository');
    const targetRepository = join(root, 'target-repository');
    const elsewhere = join(root, 'elsewhere');
    const storage = join(root, 'storage');
    await mkdir(repository);
    await mkdir(targetRepository);
    await mkdir(elsewhere);
    await writeFile(join(repository, 'index.ts'), 'export class Example {}\n');
    await writeFile(join(targetRepository, 'api.ts'), 'export interface ApiContract {}\n');
    await exec('git', ['init'], { cwd: repository });
    const cli = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const run = (args: string[]) =>
      exec(process.execPath, [cli, join(projectRoot, 'src', 'cli', 'index.ts'), ...args], {
        cwd: elsewhere,
        env: { ...process.env, NIX_DATA_DIRECTORY: storage },
      });

    const added = await run(['workspace', 'add', repository, '--name', 'example']);
    expect(added.stdout).toContain('"name": "example"');
    await run(['workspace', 'add', targetRepository, '--name', 'target']);
    const listed = await run(['workspace', 'list']);
    expect(listed.stdout).toContain(repository.replaceAll('\\', '\\\\'));
    const inspected = await run(['workspace', 'inspect', 'example']);
    expect(inspected.stdout).toContain('"filesMapped": 1');
    const memoryAdded = await run([
      '--workspace',
      'example',
      'memory',
      'add',
      'Prefer repository source over stored facts.',
      '--kind',
      'decision',
      '--source',
      'integration-test',
      '--confidence',
      '0.8',
    ]);
    expect(memoryAdded.stdout).toContain('"kind": "decision"');
    const memoryId = /"id": "([^"]+)"/u.exec(memoryAdded.stdout)?.[1];
    if (memoryId === undefined) throw new Error('Memory command returned no ID.');
    const memorySearch = await run(['--workspace', 'example', 'memory', 'search', 'stored facts']);
    expect(memorySearch.stdout).toContain('Prefer repository source');
    await expect(
      run(['--workspace', 'example', 'memory', 'remove', memoryId]),
    ).resolves.toMatchObject({ stdout: `Removed memory ${memoryId}.\n` });
    const grant = await run(['workspace', 'allow-consult', 'example', 'target']);
    expect(grant.stdout).toContain('"access": "consult"');
    const relationships = await run(['workspace', 'relationships', 'example']);
    expect(relationships.stdout).toContain('"toWorkspaceId"');
    await expect(run(['workspace', 'revoke-consult', 'example', 'target'])).resolves.toMatchObject({
      stdout: 'Revoked consult access from example to target.\n',
    });
    const modifyGrant = await run(['workspace', 'allow-modify', 'example', 'target']);
    expect(modifyGrant.stdout).toContain('"access": "modify"');
    await expect(run(['workspace', 'revoke-modify', 'example', 'target'])).resolves.toMatchObject({
      stdout: 'Revoked modify access from example to target.\n',
    });
    await expect(run(['workspace', 'remove', 'example'])).resolves.toMatchObject({
      stdout: 'Removed workspace example.\n',
    });
    await run(['workspace', 'remove', 'target']);
    await expect(run(['workspace', 'list'])).resolves.toMatchObject({ stdout: '[]\n' });
  }, 30_000);
});
