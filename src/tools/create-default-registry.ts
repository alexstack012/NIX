import { gitDiffTool, gitStatusTool } from './git-tools.js';
import { applyPatchTool, createFileTool, writeFileTool } from './file-tools.js';
import { runCommandTool } from './command-tool.js';
import { repositoryMapTool } from './repository-map-tool.js';
import {
  listDirectoryTool,
  readFileRangeTool,
  readFileTool,
  searchFilesTool,
  searchTextTool,
} from './read-tools.js';
import { ToolRegistry } from './tool-registry.js';
import type { WorkspaceMemory } from '../memory/workspace-memory.js';
import { createWorkspaceMemoryTools } from './memory-tools.js';
import type { TaskMemory } from '../memory/task-memory.js';
import { createTaskMemoryTools } from './task-memory-tools.js';
import { createConsultWorkspaceTool, type ConsultationDependencies } from './consultation-tool.js';
import { createCoordinationTools, type CoordinationDependencies } from './coordination-tools.js';

export const createReadOnlyToolRegistry = (): ToolRegistry => {
  const registry = new ToolRegistry();
  for (const tool of [
    listDirectoryTool,
    readFileTool,
    readFileRangeTool,
    searchFilesTool,
    searchTextTool,
    gitStatusTool,
    gitDiffTool,
    repositoryMapTool,
  ])
    registry.register(tool);
  return registry;
};

export const createDefaultToolRegistry = (
  options: {
    readonly memory?: WorkspaceMemory;
    readonly workspaceId?: string;
    readonly taskMemory?: TaskMemory;
    readonly consultation?: ConsultationDependencies;
    readonly coordination?: CoordinationDependencies;
  } = {},
): ToolRegistry => {
  const registry = createReadOnlyToolRegistry();
  for (const tool of [createFileTool, writeFileTool, applyPatchTool, runCommandTool])
    registry.register(tool);
  if (options.memory !== undefined && options.workspaceId !== undefined) {
    for (const tool of createWorkspaceMemoryTools(options.memory, options.workspaceId))
      registry.register(tool);
  }
  if (options.taskMemory !== undefined) {
    for (const tool of createTaskMemoryTools(options.taskMemory)) registry.register(tool);
  }
  if (options.consultation !== undefined) {
    registry.register(createConsultWorkspaceTool(options.consultation));
  }
  if (options.coordination !== undefined) {
    for (const tool of createCoordinationTools(options.coordination)) registry.register(tool);
  }
  return registry;
};
