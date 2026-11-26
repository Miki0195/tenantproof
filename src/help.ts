export const PROGRAM_NAME = 'tenantproof';

export function formatHelp(programName: string = PROGRAM_NAME): string {
  return [
    'TenantProof - test explicit HTTP API authorization expectations',
    'Status: pre-v0.1.0, not ready for production use.',
    '',
    `Usage: ${programName} [options]`,
    '',
    'Options:',
    '  -h, --help  Show this help message',
  ].join('\n');
}
