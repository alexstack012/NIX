import { NixError } from '../shared/errors.js';
import type { Tool, ToolContext, ToolResult } from './types.js';

export class ToolRegistry {
  readonly #tools = new Map<string, Tool>();

  public register(tool: Tool): void {
    if (this.#tools.has(tool.definition.name)) {
      throw new NixError(`Duplicate tool: ${tool.definition.name}`, 'DUPLICATE_TOOL');
    }
    this.#tools.set(tool.definition.name, tool);
  }

  public definitions() {
    return [...this.#tools.values()].map((tool) => tool.definition);
  }

  public async execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (tool === undefined) {
      return { ok: false, error: { code: 'TOOL_NOT_FOUND', message: `Unknown tool: ${name}` } };
    }
    try {
      return { ok: true, output: await tool.execute(tool.validate(input), context) };
    } catch (error) {
      const normalized =
        error instanceof NixError
          ? { code: error.code, message: error.message }
          : {
              code: 'TOOL_EXECUTION_FAILED',
              message: error instanceof Error ? error.message : String(error),
            };
      return { ok: false, error: normalized };
    }
  }
}
