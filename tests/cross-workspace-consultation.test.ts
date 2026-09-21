import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { WorkspaceMemory } from '../src/memory/workspace-memory.js';
import { createDefaultToolRegistry } from '../src/tools/create-default-registry.js';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';
import { WorkspaceRegistry } from '../src/workspace/workspace-registry.js';
import { WorkspaceRelationshipRegistry } from '../src/workspace/workspace-relationships.js';

const exec = promisify(execFile);

describe('WorkspaceRelationshipRegistry', () => {
  it('persists directional consultation grants and revokes them', async () => {
    const storage = await mkdtemp(join(tmpdir(), 'nix-relations-'));
    const registry = new WorkspaceRelationshipRegistry(storage);
    const relationship = await registry.grant('source', 'target', 'consult');

    expect(await new WorkspaceRelationshipRegistry(storage).canConsult('source', 'target')).toBe(
      true,
    );
    expect(await registry.canConsult('target', 'source')).toBe(false);
    await expect(registry.grant('source', 'target', 'consult')).resolves.toEqual(relationship);
    expect(await registry.revoke('source', 'target', 'consult')).toBe(true);
    expect(await registry.revoke('source', 'target', 'consult')).toBe(false);
  });
});

describe('consult_workspace tool', () => {
  it('denies ungranted access and returns bounded, revisioned relevant information after grant', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-consult-'));
    const storage = join(root, 'storage');
    const sourcePath = join(root, 'source');
    const targetPath = join(root, 'target');
    await mkdir(sourcePath);
    await mkdir(targetPath);
    await writeFile(join(sourcePath, 'app.ts'), 'export const app = true;\n');
    const targetContent =
      'export interface PaymentRequest { amount: number; }\nexport const PaymentRequestPath = "/payments";\n';
    await writeFile(join(targetPath, 'payment.ts'), targetContent);
    await exec('git', ['init'], { cwd: targetPath });
    await exec('git', ['add', '.'], { cwd: targetPath });
    await exec(
      'git',
      ['-c', 'user.name=Nix Test', '-c', 'user.email=nix@local.invalid', 'commit', '-m', 'fixture'],
      { cwd: targetPath },
    );

    const workspaces = new WorkspaceRegistry(storage);
    const source = await workspaces.add(sourcePath, 'source');
    const target = await workspaces.add(targetPath, 'payments');
    const relationships = new WorkspaceRelationshipRegistry(storage);
    const memory = await WorkspaceMemory.open(storage);
    memory.add({
      workspaceId: target.id,
      kind: 'architecture',
      content: 'PaymentRequest is accepted by the payments endpoint.',
      source: 'payment.ts',
    });
    const workspace = await WorkspaceManager.create(sourcePath);
    const registry = createDefaultToolRegistry({
      consultation: {
        currentWorkspaceId: source.id,
        registry: workspaces,
        relationships,
        memory,
      },
    });

    await expect(
      registry.execute(
        'consult_workspace',
        { workspace: 'payments', query: 'PaymentRequest', maxResults: 5 },
        { workspace },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'WORKSPACE_CONSULT_DENIED' },
    });

    await relationships.grant(source.id, target.id, 'consult');
    const result = await registry.execute(
      'consult_workspace',
      { workspace: 'payments', query: 'PaymentRequest', maxResults: 5 },
      { workspace },
    );

    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('"name":"payments"');
    expect(serialized).toContain('"path":"payment.ts"');
    expect(serialized).toMatch(/"gitCommit":"[0-9a-f]{40}"/u);
    expect(serialized).toContain('payments endpoint');
    expect(await readFile(join(targetPath, 'payment.ts'), 'utf8')).toBe(targetContent);
    memory.close();
  });
});
