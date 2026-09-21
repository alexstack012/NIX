import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';

export const workspaceIdForPath = async (path: string): Promise<string> => {
  const canonical = await realpath(path);
  const normalized = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  return `path-${createHash('sha256').update(normalized).digest('hex').slice(0, 32)}`;
};
