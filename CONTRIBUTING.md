# Contributing to ci-failure-detective

Small, focused PRs are welcome.

- Keep it zero-dependency. If a feature needs a package, it probably
  doesn't belong here.
- Add a test for every behavior change (`npm test` runs `node --test`).
- New framework parsers go in `src/parsers.js` with a fixture log in
  `tests/fixtures/` and at least one parser test.
- Keep the CLI contract stable: subcommands, flags, exit codes, and the
  JSON report shape. If you must change them, say so loudly in the PR.
- The tool never auto-applies anything (no auto-retry, no auto-quarantine).
  Keep it that way — suggestions only.
- Run the fixtures before pushing:
  `node bin/cifd.js analyze tests/fixtures/jest-fail.log --format md`
