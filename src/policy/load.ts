import { readFile } from 'node:fs/promises';
import { PolicyError } from './errors.js';
import { parsePolicyYaml } from './parse.js';
import type { Policy } from './schema.js';
import { validatePolicy } from './validate.js';

/** Reads, parses and validates a policy file. Throws {@link PolicyError} on any failure. */
export async function loadPolicy(filePath: string): Promise<Policy> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new PolicyError(
      'read',
      [{ path: '', message: describeReadError(error) }],
      {
        source: filePath,
        cause: error,
      },
    );
  }
  return loadPolicyFromString(text, filePath);
}

/** Parses and validates policy YAML that is already in memory. */
export function loadPolicyFromString(text: string, source?: string): Policy {
  try {
    return validatePolicy(parsePolicyYaml(text));
  } catch (error) {
    if (error instanceof PolicyError && source !== undefined) {
      throw new PolicyError(error.kind, error.issues, { source, cause: error });
    }
    throw error;
  }
}

function describeReadError(error: unknown): string {
  if (error instanceof Error && 'code' in error) {
    if (error.code === 'ENOENT') return 'file does not exist';
    if (error.code === 'EISDIR') return 'path is a directory, not a file';
    if (error.code === 'EACCES') return 'permission denied';
  }
  return error instanceof Error ? error.message : String(error);
}
