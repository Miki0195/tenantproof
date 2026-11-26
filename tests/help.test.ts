import { describe, expect, it } from 'vitest';
import { formatHelp, PROGRAM_NAME } from '../src/help.js';

describe('formatHelp', () => {
  it('uses the default program name in the usage line', () => {
    expect(formatHelp()).toContain(`Usage: ${PROGRAM_NAME} [options]`);
  });

  it('uses a custom program name when provided', () => {
    expect(formatHelp('tp')).toContain('Usage: tp [options]');
  });

  it('documents the help flag and pre-release status', () => {
    const help = formatHelp();
    expect(help).toContain('-h, --help');
    expect(help).toContain('pre-v0.1.0');
  });

  it('does not end with a trailing newline', () => {
    expect(formatHelp().endsWith('\n')).toBe(false);
  });
});
