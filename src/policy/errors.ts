export type PolicyErrorKind = 'read' | 'parse' | 'validation';

export interface PolicyIssue {
  /** Field path such as `checks[1].expect.status`; empty for the whole document. */
  readonly path: string;
  readonly message: string;
  /** 1-based position in the YAML source, when known. */
  readonly line?: number;
  readonly column?: number;
}

export interface PolicyErrorOptions extends ErrorOptions {
  /** File path or label shown in the message. */
  readonly source?: string;
}

const HEADINGS: Record<PolicyErrorKind, string> = {
  read: 'Cannot read policy',
  parse: 'Invalid YAML in policy',
  validation: 'Invalid policy',
};

export class PolicyError extends Error {
  override readonly name = 'PolicyError';
  readonly kind: PolicyErrorKind;
  readonly issues: readonly PolicyIssue[];
  readonly source: string | undefined;

  constructor(
    kind: PolicyErrorKind,
    issues: readonly PolicyIssue[],
    options: PolicyErrorOptions = {},
  ) {
    super(formatPolicyError(kind, issues, options.source), options);
    this.kind = kind;
    this.issues = issues;
    this.source = options.source;
  }
}

export function formatIssue(issue: PolicyIssue): string {
  const location =
    issue.line === undefined
      ? ''
      : `line ${String(issue.line)}, column ${String(issue.column ?? 1)}`;
  const where = [issue.path, location].filter(Boolean).join(' at ') || '(root)';
  return `${where}: ${issue.message}`;
}

function formatPolicyError(
  kind: PolicyErrorKind,
  issues: readonly PolicyIssue[],
  source: string | undefined,
): string {
  const heading =
    source === undefined ? HEADINGS[kind] : `${HEADINGS[kind]} ${source}`;
  const count =
    issues.length === 1 ? '1 issue' : `${String(issues.length)} issues`;
  return [
    `${heading} (${count}):`,
    ...issues.map((issue) => `  - ${formatIssue(issue)}`),
  ].join('\n');
}
