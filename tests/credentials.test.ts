import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  ActorCredentials,
  CredentialError,
  resolveActors,
  type CredentialProblem,
  type EnvSource,
} from '../src/credentials/index.js';
import { validatePolicy, type Policy } from '../src/policy/index.js';

const ALICE_SECRET = 'tp_alice_secret_7f3a9c';
const BOB_SECRET = 'tp_bob_secret_51e2d8';

function policyWith(
  actors: Record<string, unknown>,
  checkActors: readonly string[] = Object.keys(actors),
): Policy {
  return validatePolicy({
    version: 1,
    baseUrl: 'http://localhost:3000',
    actors,
    checks: checkActors.map((actor, index) => ({
      id: `check-${String(index)}`,
      actor,
      method: 'GET',
      path: '/api/projects',
      expect: { status: 200 },
    })),
  });
}

function recordingEnv(values: Record<string, string>): {
  env: EnvSource;
  read: string[];
} {
  const read: string[] = [];
  const env = new Proxy(values, {
    get(target, key) {
      if (typeof key === 'string') read.push(key);
      return Reflect.get(target, key) as unknown;
    },
  });
  return { env, read };
}

function catchCredentialError(run: () => unknown): CredentialError {
  try {
    run();
  } catch (error) {
    if (error instanceof CredentialError) return error;
    throw error;
  }
  throw new Error('expected a CredentialError to be thrown');
}

function headersFor(
  credentials: ReadonlyMap<string, ActorCredentials>,
  actorId: string,
): Readonly<Record<string, string>> | undefined {
  return credentials.get(actorId)?.headers();
}

describe('anonymous actors', () => {
  it('resolve to no Authorization header without reading the environment', () => {
    const { env, read } = recordingEnv({ GUEST_TOKEN: 'should-not-be-used' });

    const credentials = resolveActors(
      policyWith({ guest: { anonymous: true } }),
      env,
    );

    expect(headersFor(credentials, 'guest')).toEqual({});
    expect(credentials.get('guest')?.scheme).toBe('none');
    expect(read).toEqual([]);
  });

  it('skips actors that no check references', () => {
    const { env, read } = recordingEnv({});

    const credentials = resolveActors(
      policyWith(
        { guest: { anonymous: true }, unused: { tokenEnv: 'UNUSED_TOKEN' } },
        ['guest'],
      ),
      env,
    );

    expect([...credentials.keys()]).toEqual(['guest']);
    expect(read).toEqual([]);
  });
});

describe('valid tokens', () => {
  it.each([
    { name: 'an opaque token', token: 'ghp_1234567890abcdef' },
    {
      name: 'a JWT',
      token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.c2lnbmF0dXJl',
    },
    { name: 'a token with RFC 6750 punctuation', token: 'abc-._~+/XYZ==' },
    { name: 'a one-character token', token: 'x' },
  ])('turns $name into a Bearer header', ({ token }) => {
    const credentials = resolveActors(
      policyWith({ alice: { tokenEnv: 'ALICE_TOKEN' } }),
      {
        ALICE_TOKEN: token,
      },
    );

    expect(headersFor(credentials, 'alice')).toEqual({
      Authorization: `Bearer ${token}`,
    });
  });

  it('reads only the variables of referenced actors', () => {
    const { env, read } = recordingEnv({
      ALICE_TOKEN: ALICE_SECRET,
      BOB_TOKEN: BOB_SECRET,
    });

    const credentials = resolveActors(
      policyWith(
        {
          alice: { tokenEnv: 'ALICE_TOKEN' },
          bob: { tokenEnv: 'BOB_TOKEN' },
          guest: { anonymous: true },
        },
        ['alice', 'guest'],
      ),
      env,
    );

    expect(read).toEqual(['ALICE_TOKEN']);
    expect([...credentials.keys()]).toEqual(['alice', 'guest']);
  });

  it('returns frozen headers that cannot be changed through the map', () => {
    const credentials = resolveActors(
      policyWith({ alice: { tokenEnv: 'ALICE_TOKEN' } }),
      {
        ALICE_TOKEN: ALICE_SECRET,
      },
    );

    expect(Object.isFrozen(headersFor(credentials, 'alice'))).toBe(true);
  });
});

describe('missing tokens', () => {
  it.each<{
    name: string;
    env: Record<string, string>;
    problems: CredentialProblem[];
  }>([
    {
      name: 'an unset variable',
      env: { BOB_TOKEN: BOB_SECRET },
      problems: [
        { actorId: 'alice', tokenEnv: 'ALICE_TOKEN', reason: 'missing' },
      ],
    },
    {
      name: 'every unset variable, in actor order',
      env: {},
      problems: [
        { actorId: 'alice', tokenEnv: 'ALICE_TOKEN', reason: 'missing' },
        { actorId: 'bob', tokenEnv: 'BOB_TOKEN', reason: 'missing' },
      ],
    },
    {
      name: 'a variable with a differently cased name',
      env: { alice_token: ALICE_SECRET, BOB_TOKEN: BOB_SECRET },
      problems: [
        { actorId: 'alice', tokenEnv: 'ALICE_TOKEN', reason: 'missing' },
      ],
    },
  ])('reports $name', ({ env, problems }) => {
    const policy = policyWith({
      alice: { tokenEnv: 'ALICE_TOKEN' },
      bob: { tokenEnv: 'BOB_TOKEN' },
    });

    const error = catchCredentialError(() => resolveActors(policy, env));

    expect(error.problems).toEqual(problems);
  });

  it('names the actor and variable in the message', () => {
    const error = catchCredentialError(() =>
      resolveActors(
        policyWith({ 'acme-admin': { tokenEnv: 'ACME_ADMIN_TOKEN' } }),
        {},
      ),
    );

    expect(error.message).toBe(
      'Cannot resolve credentials for 1 actor:\n' +
        '  - actor "acme-admin": environment variable ACME_ADMIN_TOKEN is not set',
    );
  });
});

describe('whitespace', () => {
  it.each([
    { name: 'leading and trailing spaces', value: `  ${ALICE_SECRET}  ` },
    { name: 'a trailing newline', value: `${ALICE_SECRET}\n` },
    { name: 'a trailing CRLF', value: `${ALICE_SECRET}\r\n` },
    { name: 'surrounding tabs', value: `\t${ALICE_SECRET}\t` },
  ])('trims $name around a token', ({ value }) => {
    const credentials = resolveActors(
      policyWith({ alice: { tokenEnv: 'ALICE_TOKEN' } }),
      {
        ALICE_TOKEN: value,
      },
    );

    expect(headersFor(credentials, 'alice')).toEqual({
      Authorization: `Bearer ${ALICE_SECRET}`,
    });
  });

  it.each([
    { name: 'an empty string', value: '', reason: 'blank' },
    { name: 'only spaces', value: '   ', reason: 'blank' },
    { name: 'only a newline', value: '\n', reason: 'blank' },
    { name: 'a non-breaking space only', value: '\u00a0', reason: 'blank' },
    { name: 'an inner space', value: 'tp_alice secret', reason: 'invalid' },
    {
      name: 'an inner newline (header injection)',
      value: 'tp_alice\r\nX-Admin: 1',
      reason: 'invalid',
    },
    {
      name: 'a control character',
      value: 'tp_alice\u0000secret',
      reason: 'invalid',
    },
    {
      name: 'a non-ASCII character',
      value: 'tp_alicé_secret',
      reason: 'invalid',
    },
  ] as const)('rejects $name as $reason', ({ value, reason }) => {
    const error = catchCredentialError(() =>
      resolveActors(policyWith({ alice: { tokenEnv: 'ALICE_TOKEN' } }), {
        ALICE_TOKEN: value,
      }),
    );

    expect(error.problems).toEqual([
      { actorId: 'alice', tokenEnv: 'ALICE_TOKEN', reason },
    ]);
  });
});

describe('redaction', () => {
  const policy = policyWith({
    alice: { tokenEnv: 'ALICE_TOKEN' },
    bob: { tokenEnv: 'BOB_TOKEN' },
    guest: { anonymous: true },
  });
  const env = { ALICE_TOKEN: ALICE_SECRET, BOB_TOKEN: BOB_SECRET };

  it('keeps tokens out of every serialized form of the credentials', () => {
    const credentials = resolveActors(policy, env);
    const alice = credentials.get('alice');

    const renderings = [
      JSON.stringify([...credentials]),
      JSON.stringify(Object.fromEntries(credentials)),
      inspect(credentials, { depth: Infinity, showHidden: true }),
      String(alice),
      JSON.stringify(structuredClone(alice)),
      JSON.stringify(Object.entries(alice ?? {})),
    ];

    for (const rendering of renderings) {
      expect(rendering).not.toContain(ALICE_SECRET);
      expect(rendering).not.toContain(BOB_SECRET);
    }
  });

  it('snapshots a token-free summary', () => {
    const credentials = resolveActors(policy, env);

    expect([...credentials.values()]).toMatchInlineSnapshot(`
      [
        {
          "actorId": "alice",
          "scheme": "bearer",
          "tokenEnv": "ALICE_TOKEN",
        },
        {
          "actorId": "bob",
          "scheme": "bearer",
          "tokenEnv": "BOB_TOKEN",
        },
        {
          "actorId": "guest",
          "scheme": "none",
        },
      ]
    `);
  });

  it('does not add credentials to the policy', () => {
    const before = JSON.stringify(policy);

    resolveActors(policy, env);

    expect(JSON.stringify(policy)).toBe(before);
    expect(before).not.toContain(ALICE_SECRET);
  });

  it('keeps valid and invalid values out of the error when resolution fails', () => {
    const blankValue = ' \t ';
    const invalidValue = 'tp_carol secret value';
    const failingPolicy = policyWith({
      alice: { tokenEnv: 'ALICE_TOKEN' },
      bob: { tokenEnv: 'BOB_TOKEN' },
      carol: { tokenEnv: 'CAROL_TOKEN' },
      dave: { tokenEnv: 'DAVE_TOKEN' },
    });

    const error = catchCredentialError(() =>
      resolveActors(failingPolicy, {
        ALICE_TOKEN: ALICE_SECRET,
        CAROL_TOKEN: invalidValue,
        DAVE_TOKEN: blankValue,
      }),
    );

    const renderings = [
      error.message,
      error.stack ?? '',
      JSON.stringify(error),
      JSON.stringify(error.problems),
      inspect(error, { depth: Infinity, showHidden: true }),
    ];
    for (const rendering of renderings) {
      expect(rendering).not.toContain(ALICE_SECRET);
      expect(rendering).not.toContain(invalidValue);
      expect(rendering).not.toContain('tp_carol');
    }
    expect(error.message).not.toContain(blankValue);
    expect(error.cause).toBeUndefined();
    expect(error.message).toBe(
      [
        'Cannot resolve credentials for 3 actors:',
        '  - actor "bob": environment variable BOB_TOKEN is not set',
        '  - actor "carol": environment variable CAROL_TOKEN contains spaces, control characters or non-ASCII characters',
        '  - actor "dave": environment variable DAVE_TOKEN is empty or only whitespace',
      ].join('\n'),
    );
  });
});
