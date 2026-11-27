import { LineCounter, parseDocument, type YAMLError } from 'yaml';
import { PolicyError, type PolicyIssue } from './errors.js';

/**
 * Parses a single YAML document into plain JavaScript data without validating its shape.
 * Duplicate keys, multiple documents and parser warnings (such as unknown tags) are errors.
 */
export function parsePolicyYaml(text: string): unknown {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, prettyErrors: false });
  const problems = [...document.errors, ...document.warnings];

  if (problems.length > 0) {
    throw new PolicyError(
      'parse',
      problems.map((problem) => toIssue(problem, lineCounter)),
    );
  }

  return document.toJS();
}

function toIssue(problem: YAMLError, lineCounter: LineCounter): PolicyIssue {
  const { line, col } = lineCounter.linePos(problem.pos[0]);
  return { path: '', message: problem.message, line, column: col };
}
