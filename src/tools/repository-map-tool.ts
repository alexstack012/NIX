import { buildRepositoryMap } from '../workspace/repository-map.js';
import type { Tool } from './types.js';
import { integerField, objectInput, stringField } from './validation.js';

export const repositoryMapTool: Tool<{ query: string; maxFiles: number }> = {
  definition: {
    name: 'repository_map',
    description:
      'Return a lightweight map of source files and declared symbols without reading the whole repository into context.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, maxFiles: { type: 'integer' } },
      additionalProperties: false,
    },
  },
  validate(input) {
    const value = objectInput(input);
    return {
      query: stringField(value, 'query', { optional: true, fallback: '' }),
      maxFiles: integerField(value, 'maxFiles', 500, 5_000),
    };
  },
  execute(input, { workspace }) {
    return buildRepositoryMap(workspace, input);
  },
};
