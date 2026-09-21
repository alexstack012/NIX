import { spawn } from 'node:child_process';

import type { WorkspaceMemory } from '../memory/workspace-memory.js';
import { NixError } from '../shared/errors.js';
import { buildRepositoryMap } from '../workspace/repository-map.js';
import { WorkspaceManager } from '../workspace/workspace-manager.js';
import type { WorkspaceRegistry } from '../workspace/workspace-registry.js';
import type { WorkspaceRelationshipRegistry } from '../workspace/workspace-relationships.js';
import { searchTextTool } from './read-tools.js';
import type { Tool } from './types.js';
import { integerField, objectInput, stringField } from './validation.js';

export interface ConsultationDependencies {
  readonly currentWorkspaceId: string;
  readonly registry: WorkspaceRegistry;
  readonly relationships: WorkspaceRelationshipRegistry;
  readonly memory: WorkspaceMemory;
}

interface ConsultationInput {
  readonly workspace: string;
  readonly query: string;
  readonly maxResults: number;
}

const gitRevision = async (cwd: string): Promise<string | null> =>
  new Promise((resolve) => {
    const child = spawn('git', ['rev-parse', 'HEAD'], { cwd, shell: false, windowsHide: true });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? output.trim() : null));
  });

export const createConsultWorkspaceTool = (
  dependencies: ConsultationDependencies,
): Tool<ConsultationInput> => ({
  definition: {
    name: 'consult_workspace',
    description:
      'Read narrowly relevant map, text, and memory facts from an explicitly authorized registered workspace. Never modifies the target.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string' },
        query: { type: 'string' },
        maxResults: { type: 'integer' },
      },
      required: ['workspace', 'query'],
      additionalProperties: false,
    },
  },
  validate(input) {
    const value = objectInput(input);
    return {
      workspace: stringField(value, 'workspace'),
      query: stringField(value, 'query'),
      maxResults: integerField(value, 'maxResults', 20, 50),
    };
  },
  async execute(input) {
    const target = await dependencies.registry.get(input.workspace);
    if (
      !(await dependencies.relationships.canConsult(dependencies.currentWorkspaceId, target.id))
    ) {
      throw new NixError(
        `Consultation access is not granted to workspace: ${target.name}`,
        'WORKSPACE_CONSULT_DENIED',
      );
    }
    const workspace = await WorkspaceManager.create(target.path);
    const map = await buildRepositoryMap(workspace, { query: input.query, maxFiles: 500 });
    const text = await searchTextTool.execute(
      { path: '.', query: input.query, maxResults: input.maxResults },
      { workspace },
    );
    return {
      target: { id: target.id, name: target.name, path: target.path },
      provenance: {
        gitCommit: await gitRevision(target.path),
        inspectedAt: new Date().toISOString(),
      },
      query: input.query,
      repositoryMap: {
        entries: map.entries.slice(0, input.maxResults),
        filesScanned: map.filesScanned,
        filesMapped: map.filesMapped,
        truncated: map.truncated || map.entries.length > input.maxResults,
      },
      textMatches: text,
      memory: dependencies.memory.search(target.id, input.query, { limit: input.maxResults }),
      advisory:
        'Consulted information is read-only and may be stale; verify contracts against target source and revision.',
    };
  },
});
