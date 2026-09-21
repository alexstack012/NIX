import { NixError } from '../shared/errors.js';

export const objectInput = (input: unknown): Record<string, unknown> => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new NixError('Tool input must be a JSON object.', 'TOOL_INPUT_INVALID');
  }
  return input as Record<string, unknown>;
};

export const stringField = (
  input: Record<string, unknown>,
  name: string,
  options: { optional?: boolean; fallback?: string } = {},
): string => {
  const value = input[name];
  if (value === undefined && options.optional) return options.fallback ?? '';
  if (typeof value !== 'string' || value.length === 0) {
    throw new NixError(`${name} must be a non-empty string.`, 'TOOL_INPUT_INVALID');
  }
  return value;
};

export const integerField = (
  input: Record<string, unknown>,
  name: string,
  fallback: number,
  maximum = 10_000,
): number => {
  const value = input[name] ?? fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new NixError(
      `${name} must be an integer from 1 to ${String(maximum)}.`,
      'TOOL_INPUT_INVALID',
    );
  }
  return value as number;
};
