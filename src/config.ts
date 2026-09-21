import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { NixError } from './shared/errors.js';

export interface NixConfig {
  readonly model: {
    readonly provider: 'llama.cpp';
    readonly endpoint: string;
    readonly name: string;
    readonly requestTimeoutMs: number;
  };
  readonly agent: {
    readonly maxIterations: number;
    readonly contextCharacterLimit: number;
  };
  readonly workspace: {
    readonly root: string;
  };
  readonly logging: {
    readonly enabled: boolean;
    readonly directory: string;
  };
  readonly storage: {
    readonly directory: string;
  };
}

interface PartialNixConfig {
  readonly model?: Partial<NixConfig['model']>;
  readonly agent?: Partial<NixConfig['agent']>;
  readonly workspace?: Partial<NixConfig['workspace']>;
  readonly logging?: Partial<NixConfig['logging']>;
  readonly storage?: Partial<NixConfig['storage']>;
}

export interface LoadConfigOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly env?: NodeJS.ProcessEnv;
}

const positiveInteger = (value: string | undefined, fallback: number, name: string): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new NixError(`${name} must be a positive integer.`, 'INVALID_CONFIG');
  }
  return parsed;
};

const readLocalConfig = async (path: string): Promise<PartialNixConfig> => {
  try {
    const text = await readFile(path, 'utf8');
    return JSON.parse(text) as PartialNixConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    if (error instanceof SyntaxError) {
      throw new NixError(`Invalid JSON in config file: ${path}`, 'INVALID_CONFIG', {
        cause: error,
      });
    }
    throw error;
  }
};

export const loadConfig = async (options: LoadConfigOptions = {}): Promise<NixConfig> => {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const configPath = resolve(
    options.configPath ?? env.NIX_CONFIG_PATH ?? resolve(cwd, 'nix.config.json'),
  );
  const file = await readLocalConfig(configPath);
  const storageDirectory = resolve(
    env.NIX_DATA_DIRECTORY ?? file.storage?.directory ?? resolve(homedir(), '.nix-agent'),
  );

  return {
    model: {
      provider: 'llama.cpp',
      endpoint: env.NIX_MODEL_ENDPOINT ?? file.model?.endpoint ?? 'http://127.0.0.1:8080',
      name: env.NIX_MODEL_NAME ?? file.model?.name ?? 'local-coding-model',
      requestTimeoutMs: positiveInteger(
        env.NIX_MODEL_TIMEOUT_MS,
        file.model?.requestTimeoutMs ?? 120_000,
        'NIX_MODEL_TIMEOUT_MS',
      ),
    },
    agent: {
      maxIterations: positiveInteger(
        env.NIX_MAX_ITERATIONS,
        file.agent?.maxIterations ?? 30,
        'NIX_MAX_ITERATIONS',
      ),
      contextCharacterLimit: positiveInteger(
        env.NIX_CONTEXT_CHARACTER_LIMIT,
        file.agent?.contextCharacterLimit ?? 120_000,
        'NIX_CONTEXT_CHARACTER_LIMIT',
      ),
    },
    workspace: {
      root: resolve(env.NIX_WORKSPACE ?? file.workspace?.root ?? cwd),
    },
    logging: {
      enabled: (env.NIX_LOGGING ?? String(file.logging?.enabled ?? true)) !== 'false',
      directory: resolve(
        cwd,
        env.NIX_LOG_DIRECTORY ?? file.logging?.directory ?? resolve(storageDirectory, 'logs'),
      ),
    },
    storage: {
      directory: storageDirectory,
    },
  };
};
