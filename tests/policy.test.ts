import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  loadPolicy,
  loadPolicyFromString,
  parsePolicyYaml,
  PolicyError,
  validatePolicy,
  type PolicyIssue,
} from '../src/policy/index.js';

const EXAMPLE_PATH = fileURLToPath(
  new URL('../examples/tenantproof.yaml', import.meta.url),
);

const ACTORS = {
  alice: { tokenEnv: 'ALICE_TOKEN' },
  bob: { tokenEnv: 'BOB_TOKEN' },
  guest: { anonymous: true },
};

function check(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    actor: 'alice',
    method: 'GET',
    path: `/api/${id}`,
    expect: { status: 200 },
    ...overrides,
  };
}

function policy(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    baseUrl: 'http://localhost:3000',
    actors: ACTORS,
    checks: [check('first')],
    ...overrides,
  };
}

function catchPolicyError(run: () => unknown): PolicyError {
  try {
    run();
  } catch (error) {
    if (error instanceof PolicyError) return error;
    throw error;
  }
  throw new Error('expected a PolicyError to be thrown');
}

describe('valid configuration', () => {
  it('loads the example policy with every field typed', async () => {
    await expect(loadPolicy(EXAMPLE_PATH)).resolves.toEqual({
      version: 1,
      baseUrl: 'http://localhost:3000',
      timeoutMs: 3000,
      actors: {
        'acme-admin': { tokenEnv: 'ACME_ADMIN_TOKEN' },
        'globex-member': { tokenEnv: 'GLOBEX_MEMBER_TOKEN' },
        visitor: { anonymous: true },
      },
      checks: [
        {
          id: 'acme-admin-lists-acme-projects',
          actor: 'acme-admin',
          method: 'GET',
          path: '/api/tenants/acme/projects',
          expect: { status: 200 },
        },
        {
          id: 'acme-admin-reads-acme-project-headers',
          actor: 'acme-admin',
          method: 'HEAD',
          path: '/api/tenants/acme/projects/prj_1001',
          expect: { status: 200 },
        },
        {
          id: 'globex-member-cannot-list-acme-projects',
          actor: 'globex-member',
          method: 'GET',
          path: '/api/tenants/acme/projects',
          expect: { status: 403 },
        },
        {
          id: 'globex-member-cannot-see-acme-invoice',
          actor: 'globex-member',
          method: 'GET',
          path: '/api/tenants/acme/invoices/inv_2024_0042',
          expect: { status: 404 },
        },
        {
          id: 'visitor-must-authenticate',
          actor: 'visitor',
          method: 'GET',
          path: '/api/tenants/acme/projects?limit=10',
          expect: { status: 401 },
        },
      ],
    });
  });

  it.each([
    {
      name: 'applies the default timeout of 5000 ms',
      data: policy(),
      expected: { timeoutMs: 5000 },
    },
    {
      name: 'accepts the minimum timeout',
      data: policy({ timeoutMs: 100 }),
      expected: { timeoutMs: 100 },
    },
    {
      name: 'accepts the maximum timeout',
      data: policy({ timeoutMs: 30_000 }),
      expected: { timeoutMs: 30_000 },
    },
    {
      name: 'accepts https base URLs with a path',
      data: policy({ baseUrl: 'https://staging.example.com/v2' }),
      expected: { baseUrl: 'https://staging.example.com/v2' },
    },
    {
      name: 'accepts the lowest and highest HTTP status codes',
      data: policy({
        checks: [
          check('lowest', { expect: { status: 100 } }),
          check('highest', { method: 'HEAD', expect: { status: 599 } }),
        ],
      }),
      expected: {
        checks: [
          { id: 'lowest', method: 'GET', expect: { status: 100 } },
          { id: 'highest', method: 'HEAD', expect: { status: 599 } },
        ],
      },
    },
    {
      name: 'treats check IDs as case-sensitive',
      data: policy({ checks: [check('health'), check('Health')] }),
      expected: { checks: [{ id: 'health' }, { id: 'Health' }] },
    },
    {
      name: 'normalizes actors to exactly one credential field',
      data: policy({
        actors: { guest: { anonymous: true } },
        checks: [check('a', { actor: 'guest' })],
      }),
      expected: { actors: { guest: { anonymous: true } } },
    },
  ])('$name', ({ data, expected }) => {
    expect(validatePolicy(data)).toMatchObject(expected);
  });

  it('parses YAML into plain data without validating it', () => {
    expect(parsePolicyYaml('version: 2\nextra: [1, 2]\n')).toEqual({
      version: 2,
      extra: [1, 2],
    });
  });
});

describe('invalid YAML', () => {
  it.each([
    {
      name: 'unclosed flow sequence',
      yaml: 'version: 1\nchecks: [first, second\nbaseUrl: http://localhost\n',
      line: 3,
      message:
        'Flow sequence in block collection must be sufficiently indented and end with a ]',
    },
    {
      name: 'duplicate mapping key',
      yaml: 'version: 1\nbaseUrl: http://a.test\nbaseUrl: http://b.test\n',
      line: 3,
      message: 'Map keys must be unique',
    },
    {
      name: 'multiple documents',
      yaml: 'version: 1\n---\nversion: 1\n',
      line: 2,
      message: 'Source contains multiple documents',
    },
    {
      name: 'tab indentation',
      yaml: 'actors:\n\talice:\n\t\ttokenEnv: ALICE_TOKEN\n',
      line: 2,
      message: 'Tabs are not allowed as indentation',
    },
    {
      name: 'inconsistent indentation',
      yaml: 'actors:\n  alice:\n    tokenEnv: ALICE_TOKEN\n   bob:\n    anonymous: true\n',
      line: 4,
      message: 'All mapping items must start at the same column',
    },
    {
      name: 'unknown tag',
      yaml: 'version: !!js/function "return 1"\n',
      line: 1,
      message: 'Unresolved tag: tag:yaml.org,2002:js/function',
    },
  ])('rejects $name with its line number', ({ yaml, line, message }) => {
    const error = catchPolicyError(() => parsePolicyYaml(yaml));

    expect(error.kind).toBe('parse');
    expect(error.issues[0]).toMatchObject({ path: '', line });
    expect(error.issues[0]?.message).toContain(message);
  });

  it('names the source and position in the error message', () => {
    const error = catchPolicyError(() =>
      loadPolicyFromString('version: 1\nversion: 1\n', 'policy.yaml'),
    );

    expect(error.message).toBe(
      'Invalid YAML in policy policy.yaml (1 issue):\n  - line 2, column 1: Map keys must be unique',
    );
  });
});

describe('duplicate check IDs', () => {
  it.each<{
    name: string;
    checks: Record<string, unknown>[];
    issues: PolicyIssue[];
  }>([
    {
      name: 'two adjacent checks',
      checks: [check('list-projects'), check('list-projects')],
      issues: [
        {
          path: 'checks[1].id',
          message:
            'duplicate check ID "list-projects" (first used at checks[0].id)',
        },
      ],
    },
    {
      name: 'a duplicate separated by other checks',
      checks: [
        check('read'),
        check('write'),
        check('read', { method: 'HEAD' }),
      ],
      issues: [
        {
          path: 'checks[2].id',
          message: 'duplicate check ID "read" (first used at checks[0].id)',
        },
      ],
    },
    {
      name: 'the same ID three times',
      checks: [check('same'), check('same'), check('same')],
      issues: [
        {
          path: 'checks[1].id',
          message: 'duplicate check ID "same" (first used at checks[0].id)',
        },
        {
          path: 'checks[2].id',
          message: 'duplicate check ID "same" (first used at checks[0].id)',
        },
      ],
    },
    {
      name: 'two different duplicated IDs',
      checks: [check('a'), check('b'), check('a'), check('b')],
      issues: [
        {
          path: 'checks[2].id',
          message: 'duplicate check ID "a" (first used at checks[0].id)',
        },
        {
          path: 'checks[3].id',
          message: 'duplicate check ID "b" (first used at checks[1].id)',
        },
      ],
    },
  ])('rejects $name', ({ checks, issues }) => {
    const error = catchPolicyError(() => validatePolicy(policy({ checks })));

    expect(error.kind).toBe('validation');
    expect(error.issues).toEqual(issues);
  });
});

describe('unknown actor references', () => {
  const defined = 'defined actors: alice, bob, guest';

  it.each<{
    name: string;
    actors: object;
    actor: string;
    issues: PolicyIssue[];
  }>([
    {
      name: 'a misspelled actor',
      actors: ACTORS,
      actor: 'alcie',
      issues: [
        {
          path: 'checks[1].actor',
          message: `unknown actor "alcie" (${defined})`,
        },
      ],
    },
    {
      name: 'a differently cased actor',
      actors: ACTORS,
      actor: 'Alice',
      issues: [
        {
          path: 'checks[1].actor',
          message: `unknown actor "Alice" (${defined})`,
        },
      ],
    },
    {
      name: 'an Object.prototype key',
      actors: ACTORS,
      actor: 'constructor',
      issues: [
        {
          path: 'checks[1].actor',
          message: `unknown actor "constructor" (${defined})`,
        },
      ],
    },
    {
      name: 'another prototype key',
      actors: ACTORS,
      actor: 'toString',
      issues: [
        {
          path: 'checks[1].actor',
          message: `unknown actor "toString" (${defined})`,
        },
      ],
    },
    {
      name: 'every reference when no actors are defined',
      actors: {},
      actor: 'alice',
      issues: [
        {
          path: 'checks[0].actor',
          message: 'unknown actor "bob" (no actors are defined)',
        },
        {
          path: 'checks[1].actor',
          message: 'unknown actor "alice" (no actors are defined)',
        },
      ],
    },
  ])('rejects $name', ({ actors, actor, issues }) => {
    const checks = [
      check('known', { actor: 'bob' }),
      check('under-test', { actor }),
    ];
    const error = catchPolicyError(() =>
      validatePolicy(policy({ actors, checks })),
    );

    expect(error.kind).toBe('validation');
    expect(error.issues).toEqual(issues);
  });

  it('reports duplicate IDs and unknown actors together', () => {
    const error = catchPolicyError(() =>
      validatePolicy(
        policy({ checks: [check('a'), check('a', { actor: 'mallory' })] }),
      ),
    );

    expect(error.issues.map((issue) => issue.path)).toEqual([
      'checks[1].id',
      'checks[1].actor',
    ]);
  });
});

describe('schema rules', () => {
  it.each([
    {
      name: 'unknown root field',
      data: policy({ baseURL: 'http://localhost' }),
      path: 'baseURL',
      message: 'unknown field',
    },
    {
      name: 'unknown actor field',
      data: policy({
        actors: { ...ACTORS, bob: { tokenEnv: 'BOB_TOKEN', token: 'secret' } },
      }),
      path: 'actors.bob.token',
      message: 'unknown field',
    },
    {
      name: 'unknown check field',
      data: policy({
        checks: [check('a', { headers: { 'x-tenant': 'acme' } })],
      }),
      path: 'checks[0].headers',
      message: 'unknown field',
    },
    {
      name: 'unknown expect field',
      data: policy({
        checks: [check('a', { expect: { status: 200, body: 'ok' } })],
      }),
      path: 'checks[0].expect.body',
      message: 'unknown field',
    },
    {
      name: 'path without a leading slash',
      data: policy({ checks: [check('a', { path: 'api/projects' })] }),
      path: 'checks[0].path',
      message:
        'must start with "/" and be relative to baseUrl, such as /api/projects',
    },
    {
      name: 'absolute URL as path',
      data: policy({ checks: [check('a', { path: 'https://evil.example/' })] }),
      path: 'checks[0].path',
      message:
        'must start with "/" and be relative to baseUrl, such as /api/projects',
    },
    {
      name: 'protocol-relative path',
      data: policy({ checks: [check('a', { path: '//evil.example/api' })] }),
      path: 'checks[0].path',
      message:
        'must not start with "//", which would point at a different host',
    },
    {
      name: 'backslash path',
      data: policy({ checks: [check('a', { path: '/\\evil.example' })] }),
      path: 'checks[0].path',
      message: 'must not contain backslashes',
    },
    {
      name: 'path with a space',
      data: policy({ checks: [check('a', { path: '/api/my projects' })] }),
      path: 'checks[0].path',
      message:
        'must contain only printable ASCII without spaces; percent-encode other characters',
    },
    {
      name: 'empty checks',
      data: policy({ checks: [] }),
      path: 'checks',
      message: 'must contain at least one check',
    },
    {
      name: 'missing checks',
      data: policy({ checks: undefined }),
      path: 'checks',
      message: 'is required',
    },
    {
      name: 'missing nested status',
      data: policy({ checks: [check('a', { expect: {} })] }),
      path: 'checks[0].expect.status',
      message: 'is required',
    },
    {
      name: 'version 2',
      data: policy({ version: 2 }),
      path: 'version',
      message: 'must be 1',
    },
    {
      name: 'non-HTTP base URL',
      data: policy({ baseUrl: 'ftp://files.example.com' }),
      path: 'baseUrl',
      message: 'must be an absolute http:// or https:// URL',
    },
    {
      name: 'relative base URL',
      data: policy({ baseUrl: '/api' }),
      path: 'baseUrl',
      message: 'must be an absolute http:// or https:// URL',
    },
    {
      name: 'timeout below range',
      data: policy({ timeoutMs: 99 }),
      path: 'timeoutMs',
      message: 'must be between 100 and 30000',
    },
    {
      name: 'timeout above range',
      data: policy({ timeoutMs: 30_001 }),
      path: 'timeoutMs',
      message: 'must be between 100 and 30000',
    },
    {
      name: 'fractional timeout',
      data: policy({ timeoutMs: 1500.5 }),
      path: 'timeoutMs',
      message: 'must be an integer number of milliseconds',
    },
    {
      name: 'lowercase token variable',
      data: policy({
        actors: { ...ACTORS, alice: { tokenEnv: 'alice_token' } },
      }),
      path: 'actors.alice.tokenEnv',
      message:
        'must be an UPPERCASE environment variable name such as API_TOKEN',
    },
    {
      name: 'actor with both credential fields',
      data: policy({
        actors: {
          ...ACTORS,
          alice: { tokenEnv: 'ALICE_TOKEN', anonymous: true },
        },
      }),
      path: 'actors.alice',
      message: 'must set exactly one of "tokenEnv" or "anonymous: true"',
    },
    {
      name: 'actor with no credential field',
      data: policy({ actors: { ...ACTORS, alice: {} } }),
      path: 'actors.alice',
      message: 'must set exactly one of "tokenEnv" or "anonymous: true"',
    },
    {
      name: 'anonymous set to false',
      data: policy({ actors: { ...ACTORS, guest: { anonymous: false } } }),
      path: 'actors.guest.anonymous',
      message: 'must be true',
    },
    {
      name: 'invalid actor ID',
      data: policy({
        actors: { ...ACTORS, 'tenant admin': { tokenEnv: 'ADMIN_TOKEN' } },
      }),
      path: 'actors["tenant admin"]',
      message:
        'invalid key: must be 1-64 letters, digits, ".", "_" or "-", starting with a letter or digit',
    },
    {
      name: 'unsupported method',
      data: policy({ checks: [check('a', { method: 'POST' })] }),
      path: 'checks[0].method',
      message: 'must be GET or HEAD',
    },
    {
      name: 'status above 599',
      data: policy({ checks: [check('a', { expect: { status: 600 } })] }),
      path: 'checks[0].expect.status',
      message: 'must be an HTTP status code from 100 to 599',
    },
    {
      name: 'status as a string',
      data: policy({ checks: [check('a', { expect: { status: '200' } })] }),
      path: 'checks[0].expect.status',
      message: 'must be an integer HTTP status code',
    },
    {
      name: 'empty document',
      data: null,
      path: '',
      message:
        'must be a YAML mapping with version, baseUrl, actors and checks',
    },
  ])('rejects $name at "$path"', ({ data, path, message }) => {
    const error = catchPolicyError(() => validatePolicy(data));

    expect(error.issues).toEqual([{ path, message }]);
  });
});

describe('loadPolicy', () => {
  it('lists every issue with its field path and the file name', () => {
    const yaml = [
      'version: 1',
      'baseUrl: http://localhost:3000',
      'retries: 3',
      'actors:',
      '  alice: { tokenEnv: ALICE_TOKEN }',
      'checks:',
      '  - { id: a, actor: alice, method: GET, path: projects, expect: { status: 200 } }',
    ].join('\n');

    const error = catchPolicyError(() =>
      loadPolicyFromString(yaml, 'tenantproof.yaml'),
    );

    expect(error.kind).toBe('validation');
    expect(error.source).toBe('tenantproof.yaml');
    expect(error.message).toBe(
      [
        'Invalid policy tenantproof.yaml (2 issues):',
        '  - checks[0].path: must start with "/" and be relative to baseUrl, such as /api/projects',
        '  - retries: unknown field',
      ].join('\n'),
    );
  });

  it('reports a missing file as a read error', async () => {
    const missing = fileURLToPath(
      new URL('./does-not-exist.yaml', import.meta.url),
    );

    await expect(loadPolicy(missing)).rejects.toMatchObject({
      name: 'PolicyError',
      kind: 'read',
      source: missing,
      issues: [{ path: '', message: 'file does not exist' }],
    });
  });
});
