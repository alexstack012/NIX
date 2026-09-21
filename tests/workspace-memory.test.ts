import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WorkspaceMemory } from '../src/memory/workspace-memory.js';
import { createDefaultToolRegistry } from '../src/tools/create-default-registry.js';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';

describe('WorkspaceMemory', () => {
  it('persists sourced metadata and isolates workspace retrieval', async () => {
    const storage = await mkdtemp(join(tmpdir(), 'nix-memory-'));
    const memory = await WorkspaceMemory.open(storage);
    const entry = memory.add({
      workspaceId: 'workspace-one',
      kind: 'decision',
      content: 'Scanner detection remains site-agnostic.',
      source: 'docs/architecture.md',
      commitHash: 'abc123',
      confidence: 0.9,
    });
    memory.add({
      workspaceId: 'workspace-two',
      kind: 'known_issue',
      content: 'Scanner form replaces nodes.',
      source: 'test failure',
    });
    memory.close();

    const reopened = await WorkspaceMemory.open(storage);
    expect(reopened.list('workspace-one')).toEqual([entry]);
    expect(reopened.search('workspace-one', 'site-agnostic')).toEqual([entry]);
    expect(reopened.search('workspace-one', 'replaces nodes')).toEqual([]);
    expect(reopened.remove('workspace-two', entry.id)).toBe(false);
    expect(reopened.remove('workspace-one', entry.id)).toBe(true);
    expect(reopened.list('workspace-one')).toEqual([]);
    reopened.close();
  });

  it('filters kind/status and treats SQL wildcard characters literally', async () => {
    const storage = await mkdtemp(join(tmpdir(), 'nix-memory-'));
    const memory = await WorkspaceMemory.open(storage);
    const active = memory.add({
      workspaceId: 'workspace',
      kind: 'architecture',
      content: 'Coverage target is 90% for core logic.',
      source: 'README',
    });
    memory.add({
      workspaceId: 'workspace',
      kind: 'architecture',
      content: 'Old coverage rule.',
      source: 'README',
      status: 'superseded',
    });

    expect(memory.search('workspace', '90%')).toEqual([active]);
    expect(memory.search('workspace', 'coverage')).toEqual([active]);
    expect(memory.list('workspace', { status: 'superseded' })).toHaveLength(1);
    memory.close();
  });

  it('rejects invalid facts and confidence values', async () => {
    const memory = await WorkspaceMemory.open(await mkdtemp(join(tmpdir(), 'nix-memory-')));
    expect(() =>
      memory.add({ workspaceId: 'one', kind: 'decision', content: '', source: 'user' }),
    ).toThrow('non-empty');
    expect(() =>
      memory.add({
        workspaceId: 'one',
        kind: 'decision',
        content: 'fact',
        source: 'user',
        confidence: 2,
      }),
    ).toThrow('between 0 and 1');
    memory.close();
  });
});

describe('workspace memory tools', () => {
  it('retrieves only scoped facts and warns that source outranks memory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nix-memory-tool-'));
    const memory = await WorkspaceMemory.open(join(root, 'storage'));
    memory.add({
      workspaceId: 'current',
      kind: 'convention',
      content: 'Use strict TypeScript.',
      source: 'AGENTS.md',
    });
    memory.add({
      workspaceId: 'other',
      kind: 'convention',
      content: 'Use JavaScript.',
      source: 'other project',
    });
    const workspace = await WorkspaceManager.create(root);
    const registry = createDefaultToolRegistry({ memory, workspaceId: 'current' });

    const result = await registry.execute(
      'search_workspace_memory',
      { query: 'TypeScript' },
      { workspace },
    );

    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).toContain(
      'Current source, tests, and configuration take precedence',
    );
    expect(JSON.stringify(result)).toContain('Use strict TypeScript');
    expect(JSON.stringify(result)).not.toContain('Use JavaScript');
    memory.close();
  });
});
