# Contributing to TenantProof

Thanks for considering a contribution. TenantProof is pre-v0.1.0 and is not
ready for production use. The CLI currently prints a help banner. The first
release is planned to add a YAML policy, terminal output, redacted JSON
results, and a runnable local example.

## Setup

You need Node.js 22 or newer. [`.nvmrc`](.nvmrc) pins Node 24, and CI installs
that version.

```bash
git clone https://github.com/Miki0195/tenantproof.git
cd tenantproof
npm ci
```

`npm ci` installs the exact dependency tree in `package-lock.json`.

## Checks

Run these before you open a pull request:

| Command                | What it does                                     |
| ---------------------- | ------------------------------------------------ |
| `npm run format`       | Rewrite files with Prettier                      |
| `npm run format:check` | Fail if formatting differs                       |
| `npm run lint`         | ESLint for `src` and `tests`                     |
| `npm run typecheck`    | `tsc --noEmit`                                   |
| `npm test`             | Vitest once (`tests/**/*.test.ts`)               |
| `npm run build`        | Bundle `src/cli.ts` with tsup into `dist/cli.js` |
| `npm run verify`       | Format check, lint, typecheck, build, then test  |

After a build, `node dist/cli.js` prints the help banner.

CI runs the same checks on pull requests and on pushes to `main`, then
`npm pack --dry-run`. The workflow is
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). The npm package is
`"private": true` and is not published.

EditorConfig uses UTF-8, LF, two-space indents, and a final newline.

## Issues, branches, and pull requests

- Look through the existing issues, then open one for a bug or a change.
- Report vulnerabilities through [SECURITY.md](SECURITY.md). A public issue
  is the wrong place for those.
- Create a branch from `main`.
- Open a pull request back to `main`. The template asks for Why, What,
  Tradeoffs, Tests, Security, and `Closes #N` when an issue exists.
- The `verify` check has to pass. A maintainer reviews the pull request and
  merges it. Nothing in this repository merges automatically.

Dependabot opens weekly pull requests for npm and GitHub Actions version
updates. Review those the same way as any other pull request.

## Code of conduct

Be respectful, specific, and patient. Comment on the work, and give people
room to explain their choices. Harassment, insults, and demeaning language
are not welcome. Maintainers may edit or close comments, issues, and pull
requests that do not meet this bar.

## License

By contributing, you agree that your contributions are licensed under the
MIT License in [LICENSE](LICENSE).
