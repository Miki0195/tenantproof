import * as z from 'zod';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const PATH_CHARACTERS = /^[\x21-\x7e]*$/;

/** Type-level error that distinguishes a missing field from a wrong value. */
function expected(description: string) {
  return {
    error: (issue: { readonly input?: unknown }) =>
      issue.input === undefined ? 'is required' : `must be ${description}`,
  };
}

const idSchema = z
  .string(expected('a string'))
  .regex(
    ID_PATTERN,
    'must be 1-64 letters, digits, ".", "_" or "-", starting with a letter or digit',
  );

const actorSchema = z
  .strictObject({
    tokenEnv: z
      .string(expected('a string'))
      .regex(
        ENV_VAR_PATTERN,
        'must be an UPPERCASE environment variable name such as API_TOKEN',
      )
      .optional(),
    anonymous: z.literal(true, expected('true')).optional(),
  })
  .refine(
    (actor) =>
      (actor.tokenEnv === undefined) !== (actor.anonymous === undefined),
    'must set exactly one of "tokenEnv" or "anonymous: true"',
  )
  .transform((actor): Actor =>
    actor.tokenEnv === undefined
      ? { anonymous: true }
      : { tokenEnv: actor.tokenEnv },
  );

const pathSchema = z
  .string(expected('a string'))
  .startsWith(
    '/',
    'must start with "/" and be relative to baseUrl, such as /api/projects',
  )
  .refine(
    (path) => !path.startsWith('//'),
    'must not start with "//", which would point at a different host',
  )
  .regex(
    PATH_CHARACTERS,
    'must contain only printable ASCII without spaces; percent-encode other characters',
  )
  .refine((path) => !path.includes('\\'), 'must not contain backslashes');

const checkSchema = z.strictObject({
  id: idSchema,
  actor: idSchema,
  method: z.enum(['GET', 'HEAD'], expected('GET or HEAD')),
  path: pathSchema,
  expect: z.strictObject({
    status: z
      .int(expected('an integer HTTP status code'))
      .min(100, 'must be an HTTP status code from 100 to 599')
      .max(599, 'must be an HTTP status code from 100 to 599'),
  }),
});

export const policySchema = z
  .strictObject(
    {
      version: z.literal(1, expected('1')),
      baseUrl: z.url({
        protocol: /^https?$/,
        ...expected('an absolute http:// or https:// URL'),
      }),
      timeoutMs: z
        .int(expected('an integer number of milliseconds'))
        .min(100, 'must be between 100 and 30000')
        .max(30_000, 'must be between 100 and 30000')
        .default(5000),
      actors: z.record(idSchema, actorSchema),
      checks: z.array(checkSchema).min(1, 'must contain at least one check'),
    },
    expected('a YAML mapping with version, baseUrl, actors and checks'),
  )
  .superRefine((policy, ctx) => {
    const firstIndexById = new Map<string, number>();

    policy.checks.forEach((check, index) => {
      const firstIndex = firstIndexById.get(check.id);
      if (firstIndex === undefined) {
        firstIndexById.set(check.id, index);
      } else {
        ctx.addIssue({
          code: 'custom',
          path: ['checks', index, 'id'],
          message: `duplicate check ID "${check.id}" (first used at checks[${String(firstIndex)}].id)`,
        });
      }

      if (!Object.hasOwn(policy.actors, check.actor)) {
        const known = Object.keys(policy.actors);
        ctx.addIssue({
          code: 'custom',
          path: ['checks', index, 'actor'],
          message: `unknown actor "${check.actor}" (${
            known.length > 0
              ? `defined actors: ${known.join(', ')}`
              : 'no actors are defined'
          })`,
        });
      }
    });
  });

export type Actor =
  { readonly tokenEnv: string } | { readonly anonymous: true };
export type Policy = z.output<typeof policySchema>;
export type PolicyCheck = Policy['checks'][number];
export type HttpMethod = PolicyCheck['method'];
