import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses local-only defaults', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nix-config-'));
    const config = await loadConfig({ cwd, env: {} });

    expect(config.model.endpoint).toBe('http://127.0.0.1:8080');
    expect(config.model.provider).toBe('llama.cpp');
    expect(config.agent.maxIterations).toBe(30);
    expect(config.agent.contextCharacterLimit).toBe(120_000);
    expect(config.agent.maxMalformedToolCallRecoveries).toBe(2);
    expect(config.workspace.root).toBe(cwd);
  });

  it('merges file configuration and environment overrides', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nix-config-'));
    const path = join(cwd, 'custom.json');
    await writeFile(
      path,
      JSON.stringify({ agent: { maxIterations: 12 }, model: { name: 'file-model' } }),
    );

    const config = await loadConfig({
      cwd,
      configPath: path,
      env: { NIX_MODEL_NAME: 'environment-model' },
    });

    expect(config.agent.maxIterations).toBe(12);
    expect(config.model.name).toBe('environment-model');
  });

  it('rejects invalid numeric environment values', async () => {
    await expect(loadConfig({ env: { NIX_MAX_ITERATIONS: 'forever' } })).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
    });
  });
});
