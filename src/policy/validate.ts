import type * as z from 'zod';
import { PolicyError, type PolicyIssue } from './errors.js';
import { policySchema, type Policy } from './schema.js';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Validates already-parsed data against the policy schema and applies defaults. */
export function validatePolicy(data: unknown): Policy {
  const result = policySchema.safeParse(data, {
    error: (issue) => (issue.input === undefined ? 'is required' : undefined),
  });

  if (!result.success) {
    throw new PolicyError('validation', result.error.issues.flatMap(toIssues));
  }

  return result.data;
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') return `${formatted}[${String(segment)}]`;
    const key = String(segment);
    if (!IDENTIFIER.test(key)) return `${formatted}[${JSON.stringify(key)}]`;
    return formatted === '' ? key : `${formatted}.${key}`;
  }, '');
}

function toIssues(issue: z.core.$ZodIssue): PolicyIssue[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      path: formatPath([...issue.path, key]),
      message: 'unknown field',
    }));
  }

  if (issue.code === 'invalid_key') {
    return issue.issues.map((keyIssue) => ({
      path: formatPath(issue.path),
      message: `invalid key: ${keyIssue.message}`,
    }));
  }

  return [{ path: formatPath(issue.path), message: issue.message }];
}
