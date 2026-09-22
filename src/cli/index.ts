#!/usr/bin/env node
import { loadConfig } from '../config.js';
import { AgentRunner } from '../agent/agent-runner.js';
import { CoordinationTracker } from '../agent/coordination-tracker.js';
import { JsonlTaskLogger, NullTaskLogger } from '../agent/task-logger.js';
import { TaskMemory } from '../memory/task-memory.js';
import {
  MEMORY_KINDS,
  MEMORY_STATUSES,
  type WorkspaceMemoryKind,
  type WorkspaceMemoryStatus,
} from '../memory/types.js';
import { LlamaCppProvider } from '../model/llama-cpp-provider.js';
import { NixError } from '../shared/errors.js';
import { createDefaultToolRegistry } from '../tools/create-default-registry.js';
import { createReadOnlyToolRegistry } from '../tools/create-default-registry.js';
import { buildRepositoryMap } from '../workspace/repository-map.js';
import { workspaceIdForPath } from '../workspace/workspace-identity.js';
import { WorkspaceManager } from '../workspace/workspace-manager.js';
import { WorkspaceRegistry, type RegisteredWorkspace } from '../workspace/workspace-registry.js';
import { WorkspaceRelationshipRegistry } from '../workspace/workspace-relationships.js';

const help = `Nix — local-first AI coding agent

Usage:
  nix-agent --help
  nix-agent config
  nix-agent model health
  nix-agent prompt <message>
  nix-agent workspace add <path> [--name <name>]
  nix-agent workspace list
  nix-agent workspace remove <name-or-id>
  nix-agent workspace inspect <name-or-id>
  nix-agent workspace allow-consult <from> <to>
  nix-agent workspace revoke-consult <from> <to>
  nix-agent workspace allow-modify <from> <to>
  nix-agent workspace revoke-modify <from> <to>
  nix-agent workspace relationships [from]
  nix-agent --workspace <name-or-id> memory add <fact> --kind <kind> [--source <source>]
  nix-agent --workspace <name-or-id> memory list
  nix-agent --workspace <name-or-id> memory search <query>
  nix-agent --workspace <name-or-id> memory remove <memory-id>
  nix-agent --workspace <name-or-id> run <task>
  nix-agent --workspace <name-or-id> --modify-workspace <target> run <task>
  nix-agent run <task>

Commands:
  config       Print the resolved, non-secret local configuration
  model health Check whether the configured local llama.cpp server is ready
  prompt       Send one prompt to the configured local model
  workspace    Manage registered repositories and directional access
  memory       Add, list, search, or remove structured workspace facts
  run          Run a bounded repository coding task through safe tools

Environment:
  NIX_MODEL_ENDPOINT            Local inference endpoint (default http://127.0.0.1:8080)
  NIX_MODEL_NAME                Model identifier sent to the local server
  NIX_MODEL_TIMEOUT_MS          Local HTTP request timeout
  NIX_MAX_ITERATIONS            Agent loop limit (default 30)
  NIX_CONTEXT_CHARACTER_LIMIT   Total task-context character limit (default 120000)
  NIX_MAX_TOOL_CALL_RECOVERIES  Malformed tool-call retry limit (default 2)
  NIX_WORKSPACE                 Explicit workspace root
  NIX_CONFIG_PATH               Optional JSON configuration path
  NIX_DATA_DIRECTORY            Registry and default log storage directory
`;

const extractOption = (
  args: readonly string[],
  option: string,
): { readonly value?: string; readonly remaining: string[] } => {
  const remaining: string[] = [];
  let value: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== option) {
      remaining.push(args[index] ?? '');
      continue;
    }
    const candidate = args[index + 1];
    if (candidate === undefined || candidate.startsWith('--')) {
      throw new NixError(`${option} requires a value.`, 'INVALID_ARGUMENT');
    }
    if (value !== undefined)
      throw new NixError(`${option} may only be specified once.`, 'INVALID_ARGUMENT');
    value = candidate;
    index += 1;
  }
  return { ...(value === undefined ? {} : { value }), remaining };
};

const extractRepeatedOption = (
  args: readonly string[],
  option: string,
): { readonly values: readonly string[]; readonly remaining: string[] } => {
  const values: string[] = [];
  const remaining: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== option) {
      remaining.push(args[index] ?? '');
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new NixError(`${option} requires a value.`, 'INVALID_ARGUMENT');
    }
    values.push(value);
    index += 1;
  }
  return { values, remaining };
};

const memoryKind = (value: string | undefined): WorkspaceMemoryKind => {
  if (value === undefined || !MEMORY_KINDS.includes(value as WorkspaceMemoryKind)) {
    throw new NixError(`--kind must be one of: ${MEMORY_KINDS.join(', ')}.`, 'INVALID_ARGUMENT');
  }
  return value as WorkspaceMemoryKind;
};

const memoryStatus = (value: string | undefined): WorkspaceMemoryStatus | undefined => {
  if (value === undefined) return undefined;
  if (!MEMORY_STATUSES.includes(value as WorkspaceMemoryStatus)) {
    throw new NixError(
      `--status must be one of: ${MEMORY_STATUSES.join(', ')}.`,
      'INVALID_ARGUMENT',
    );
  }
  return value as WorkspaceMemoryStatus;
};

export const runCli = async (args: readonly string[]): Promise<number> => {
  const workspaceOption = extractOption(args, '--workspace');
  const modificationOption = extractRepeatedOption(workspaceOption.remaining, '--modify-workspace');
  const effectiveArgs = modificationOption.remaining;
  const command = effectiveArgs[0];
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(help);
    return 0;
  }
  if (modificationOption.values.length > 0 && command !== 'run') {
    throw new NixError('--modify-workspace is only valid with run.', 'INVALID_ARGUMENT');
  }

  if (command === 'config') {
    const config = await loadConfig();
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  }

  if (command === 'model' && effectiveArgs[1] === 'health') {
    const config = await loadConfig();
    const provider = new LlamaCppProvider({
      endpoint: config.model.endpoint,
      model: config.model.name,
      timeoutMs: config.model.requestTimeoutMs,
    });
    const health = await provider.healthCheck();
    process.stdout.write(`${health.message}\n`);
    return health.available ? 0 : 1;
  }

  if (command === 'prompt') {
    const prompt = effectiveArgs.slice(1).join(' ').trim();
    if (prompt === '') throw new NixError('prompt requires a message.', 'INVALID_ARGUMENT');
    const config = await loadConfig();
    const provider = new LlamaCppProvider({
      endpoint: config.model.endpoint,
      model: config.model.name,
      timeoutMs: config.model.requestTimeoutMs,
    });
    const response = await provider.generate({ messages: [{ role: 'user', content: prompt }] });
    process.stdout.write(`${response.content}\n`);
    return 0;
  }

  if (command === 'workspace') {
    const action = effectiveArgs[1];
    const config = await loadConfig();
    const registry = new WorkspaceRegistry(config.storage.directory);
    if (action === 'list') {
      process.stdout.write(`${JSON.stringify(await registry.list(), null, 2)}\n`);
      return 0;
    }
    if (action === 'add') {
      const nameOption = extractOption(effectiveArgs.slice(2), '--name');
      const path = nameOption.remaining[0];
      if (path === undefined || nameOption.remaining.length !== 1) {
        throw new NixError('workspace add requires exactly one path.', 'INVALID_ARGUMENT');
      }
      const entry = await registry.add(path, nameOption.value);
      process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return 0;
    }
    if (action === 'remove') {
      const identifier = effectiveArgs[2];
      if (identifier === undefined || effectiveArgs.length !== 3) {
        throw new NixError('workspace remove requires exactly one name or ID.', 'INVALID_ARGUMENT');
      }
      const removed = await registry.remove(identifier);
      process.stdout.write(`Removed workspace ${removed.name}.\n`);
      return 0;
    }
    if (action === 'inspect') {
      const identifier = effectiveArgs[2];
      if (identifier === undefined || effectiveArgs.length !== 3) {
        throw new NixError(
          'workspace inspect requires exactly one name or ID.',
          'INVALID_ARGUMENT',
        );
      }
      const entry = await registry.get(identifier);
      const workspace = await WorkspaceManager.create(entry.path);
      const map = await buildRepositoryMap(workspace, { maxFiles: 500 });
      const git = await createReadOnlyToolRegistry().execute('git_status', {}, { workspace });
      process.stdout.write(
        `${JSON.stringify({ workspace: entry, repositoryMap: { filesScanned: map.filesScanned, filesMapped: map.filesMapped, truncated: map.truncated }, git }, null, 2)}\n`,
      );
      return 0;
    }
    if (
      action === 'allow-consult' ||
      action === 'revoke-consult' ||
      action === 'allow-modify' ||
      action === 'revoke-modify'
    ) {
      const fromIdentifier = effectiveArgs[2];
      const toIdentifier = effectiveArgs[3];
      if (
        fromIdentifier === undefined ||
        toIdentifier === undefined ||
        effectiveArgs.length !== 4
      ) {
        throw new NixError(
          `workspace ${action} requires source and target workspace names or IDs.`,
          'INVALID_ARGUMENT',
        );
      }
      const from = await registry.get(fromIdentifier);
      const to = await registry.get(toIdentifier);
      const relationships = new WorkspaceRelationshipRegistry(config.storage.directory);
      const access = action.endsWith('modify') ? 'modify' : 'consult';
      if (action.startsWith('allow')) {
        process.stdout.write(
          `${JSON.stringify(await relationships.grant(from.id, to.id, access), null, 2)}\n`,
        );
      } else {
        const removed = await relationships.revoke(from.id, to.id, access);
        if (!removed)
          throw new NixError('Workspace grant was not found.', 'WORKSPACE_RELATIONSHIP_NOT_FOUND');
        process.stdout.write(`Revoked ${access} access from ${from.name} to ${to.name}.\n`);
      }
      return 0;
    }
    if (action === 'relationships') {
      const identifier = effectiveArgs[2];
      if (effectiveArgs.length > 3)
        throw new NixError(
          'workspace relationships accepts at most one workspace.',
          'INVALID_ARGUMENT',
        );
      const from = identifier === undefined ? undefined : await registry.get(identifier);
      const relationships = await new WorkspaceRelationshipRegistry(config.storage.directory).list(
        from?.id,
      );
      process.stdout.write(`${JSON.stringify(relationships, null, 2)}\n`);
      return 0;
    }
    throw new NixError(
      'workspace requires add, list, remove, inspect, allow-consult, revoke-consult, allow-modify, revoke-modify, or relationships.',
      'INVALID_ARGUMENT',
    );
  }

  if (command === 'memory') {
    if (workspaceOption.value === undefined) {
      throw new NixError('memory commands require --workspace <name-or-id>.', 'INVALID_ARGUMENT');
    }
    const config = await loadConfig();
    const registered = await new WorkspaceRegistry(config.storage.directory).get(
      workspaceOption.value,
    );
    const memory = await (
      await import('../memory/workspace-memory.js')
    ).WorkspaceMemory.open(config.storage.directory);
    try {
      const action = effectiveArgs[1];
      let argumentsList = effectiveArgs.slice(2);
      const kindOption = extractOption(argumentsList, '--kind');
      argumentsList = kindOption.remaining;
      const statusOption = extractOption(argumentsList, '--status');
      argumentsList = statusOption.remaining;
      const sourceOption = extractOption(argumentsList, '--source');
      argumentsList = sourceOption.remaining;
      const commitOption = extractOption(argumentsList, '--commit');
      argumentsList = commitOption.remaining;
      const confidenceOption = extractOption(argumentsList, '--confidence');
      argumentsList = confidenceOption.remaining;
      const limitOption = extractOption(argumentsList, '--limit');
      argumentsList = limitOption.remaining;
      if (argumentsList.some((argument) => argument.startsWith('--'))) {
        throw new NixError('Unknown memory option.', 'INVALID_ARGUMENT');
      }
      const status = memoryStatus(statusOption.value);
      const limit = limitOption.value === undefined ? undefined : Number(limitOption.value);
      if (action === 'add') {
        const content = argumentsList.join(' ').trim();
        if (content === '') throw new NixError('memory add requires a fact.', 'INVALID_ARGUMENT');
        const confidence =
          confidenceOption.value === undefined ? undefined : Number(confidenceOption.value);
        const entry = memory.add({
          workspaceId: registered.id,
          kind: memoryKind(kindOption.value),
          content,
          source: sourceOption.value ?? 'user',
          ...(commitOption.value === undefined ? {} : { commitHash: commitOption.value }),
          ...(confidence === undefined ? {} : { confidence }),
          ...(status === undefined ? {} : { status }),
        });
        process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
        return 0;
      }
      const kind = kindOption.value === undefined ? undefined : memoryKind(kindOption.value);
      if (action === 'list') {
        if (argumentsList.length !== 0)
          throw new NixError(
            'memory list does not accept positional arguments.',
            'INVALID_ARGUMENT',
          );
        process.stdout.write(
          `${JSON.stringify(memory.list(registered.id, { ...(kind === undefined ? {} : { kind }), ...(status === undefined ? {} : { status }), ...(limit === undefined ? {} : { limit }) }), null, 2)}\n`,
        );
        return 0;
      }
      if (action === 'search') {
        const query = argumentsList.join(' ').trim();
        if (query === '') throw new NixError('memory search requires a query.', 'INVALID_ARGUMENT');
        process.stdout.write(
          `${JSON.stringify(memory.search(registered.id, query, { ...(kind === undefined ? {} : { kind }), ...(status === undefined ? {} : { status }), ...(limit === undefined ? {} : { limit }) }), null, 2)}\n`,
        );
        return 0;
      }
      if (action === 'remove') {
        const id = argumentsList[0];
        if (id === undefined || argumentsList.length !== 1)
          throw new NixError('memory remove requires exactly one memory ID.', 'INVALID_ARGUMENT');
        if (!memory.remove(registered.id, id))
          throw new NixError(`Memory entry was not found: ${id}`, 'MEMORY_NOT_FOUND');
        process.stdout.write(`Removed memory ${id}.\n`);
        return 0;
      }
      throw new NixError('memory requires add, list, search, or remove.', 'INVALID_ARGUMENT');
    } finally {
      memory.close();
    }
  }

  if (command === 'run') {
    const task = effectiveArgs.slice(1).join(' ').trim();
    if (task === '') throw new NixError('run requires a task.', 'INVALID_ARGUMENT');
    const config = await loadConfig();
    const registry = new WorkspaceRegistry(config.storage.directory);
    const registered =
      workspaceOption.value === undefined ? undefined : await registry.get(workspaceOption.value);
    const workspaceRoot = registered?.path ?? config.workspace.root;
    if (modificationOption.values.length > 0 && registered === undefined) {
      throw new NixError(
        '--modify-workspace requires a registered source selected with --workspace.',
        'INVALID_ARGUMENT',
      );
    }
    const relationshipRegistry = new WorkspaceRelationshipRegistry(config.storage.directory);
    const coordinationTargets: RegisteredWorkspace[] = [];
    for (const identifier of modificationOption.values) {
      const target = await registry.get(identifier);
      if (
        registered === undefined ||
        !(await relationshipRegistry.canModify(registered.id, target.id))
      ) {
        throw new NixError(
          `Modify access is not granted from ${registered?.name ?? 'current workspace'} to ${target.name}.`,
          'WORKSPACE_MODIFY_DENIED',
        );
      }
      if (!coordinationTargets.some((entry) => entry.id === target.id))
        coordinationTargets.push(target);
    }
    const coordination = new CoordinationTracker();
    for (const target of coordinationTargets) coordination.register(target.id, target.name);
    const workspace = await WorkspaceManager.create(workspaceRoot);
    const workspaceId = registered?.id ?? (await workspaceIdForPath(workspace.root));
    const memory = await (
      await import('../memory/workspace-memory.js')
    ).WorkspaceMemory.open(config.storage.directory);
    const taskMemory = new TaskMemory();
    const provider = new LlamaCppProvider({
      endpoint: config.model.endpoint,
      model: config.model.name,
      timeoutMs: config.model.requestTimeoutMs,
    });
    try {
      const runner = new AgentRunner({
        provider,
        tools: createDefaultToolRegistry({
          memory,
          workspaceId,
          taskMemory,
          ...(registered === undefined
            ? {}
            : {
                consultation: {
                  currentWorkspaceId: registered.id,
                  registry,
                  relationships: relationshipRegistry,
                  memory,
                },
              }),
          ...(coordinationTargets.length === 0
            ? {}
            : { coordination: { targets: coordinationTargets, tracker: coordination } }),
        }),
        workspace,
        taskMemory,
        ...(coordinationTargets.length === 0 ? {} : { coordination }),
        maxIterations: config.agent.maxIterations,
        maxTaskContextCharacters: config.agent.contextCharacterLimit,
        maxMalformedToolCallRecoveries: config.agent.maxMalformedToolCallRecoveries,
        logger: config.logging.enabled
          ? new JsonlTaskLogger(config.logging.directory)
          : new NullTaskLogger(),
      });
      const result = await runner.run(task);
      process.stdout.write(`${result.response}\n`);
      process.stderr.write(
        `Task ${result.taskId}: ${result.status}; ${String(result.iterations)} iterations, ${String(result.toolCalls)} tool calls, ${String(result.errors)} errors, ${String(result.durationMs)}ms.\n`,
      );
      if (result.memoryProposals.length > 0) {
        process.stderr.write(
          `Proposed workspace memory (not saved):\n${JSON.stringify(result.memoryProposals, null, 2)}\n`,
        );
      }
      if (result.coordination.length > 0) {
        process.stderr.write(
          `Coordinated workspace results:\n${JSON.stringify(result.coordination, null, 2)}\n`,
        );
      }
      return result.status === 'completed' ? 0 : 2;
    } finally {
      memory.close();
    }
  }

  process.stderr.write(`Unknown command: ${command}\n\n${help}`);
  return 1;
};

const main = async (): Promise<void> => {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof NixError ? `${error.code}: ${error.message}` : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
};

await main();
