import type { Policy } from '../policy/index.js';
import { ActorCredentials } from './actor-credentials.js';

export type EnvSource = Readonly<Record<string, string | undefined>>;

export type CredentialProblemReason = 'missing' | 'blank' | 'invalid';

/** Names the actor and variable only; the variable's value is never kept. */
export interface CredentialProblem {
  readonly actorId: string;
  readonly tokenEnv: string;
  readonly reason: CredentialProblemReason;
}

const REASONS: Record<CredentialProblemReason, string> = {
  missing: 'is not set',
  blank: 'is empty or only whitespace',
  invalid: 'contains spaces, control characters or non-ASCII characters',
};

const TOKEN_CHARACTERS = /^[\x21-\x7e]+$/;

export class CredentialError extends Error {
  override readonly name = 'CredentialError';
  readonly problems: readonly CredentialProblem[];

  constructor(problems: readonly CredentialProblem[]) {
    super(formatCredentialError(problems));
    this.problems = problems;
  }
}

/**
 * Resolves credentials for every actor referenced by a check, before any request is sent.
 * Bearer tokens come from the named environment variable with surrounding whitespace removed.
 * Throws {@link CredentialError} listing every unusable variable by name.
 */
export function resolveActors(
  policy: Pick<Policy, 'actors' | 'checks'>,
  env: EnvSource = process.env,
): ReadonlyMap<string, ActorCredentials> {
  const referenced = new Set(policy.checks.map((check) => check.actor));
  const resolved = new Map<string, ActorCredentials>();
  const problems: CredentialProblem[] = [];

  for (const [actorId, actor] of Object.entries(policy.actors)) {
    if (!referenced.has(actorId)) continue;

    if ('anonymous' in actor) {
      resolved.set(actorId, ActorCredentials.anonymous(actorId));
      continue;
    }

    const token = env[actor.tokenEnv]?.trim();
    if (token !== undefined && TOKEN_CHARACTERS.test(token)) {
      resolved.set(
        actorId,
        ActorCredentials.bearer(actorId, actor.tokenEnv, token),
      );
    } else {
      const reason =
        token === undefined ? 'missing' : token === '' ? 'blank' : 'invalid';
      problems.push({ actorId, tokenEnv: actor.tokenEnv, reason });
    }
  }

  if (problems.length > 0) throw new CredentialError(problems);
  return resolved;
}

function formatCredentialError(problems: readonly CredentialProblem[]): string {
  const count =
    problems.length === 1 ? '1 actor' : `${String(problems.length)} actors`;
  return [
    `Cannot resolve credentials for ${count}:`,
    ...problems.map(
      ({ actorId, tokenEnv, reason }) =>
        `  - actor "${actorId}": environment variable ${tokenEnv} ${REASONS[reason]}`,
    ),
  ].join('\n');
}
