# Changelog — ci-failure-detective

## 0.1.0 — 2026-10-24 (initial flagship release)

- CLI `cifd analyze` (file/stdin) → JSON + GitHub markdown; `cifd record` /
  `cifd history` with JSONL run history in the repo.
- Failure classification: dependency-install, out-of-memory, timeout,
  compile-error, test-failure, lint, unknown; first-error line + context.
- Test-result parsers: Jest, pytest, go test, Mocha (best match wins).
- Flaky scoring: same-commit flip 0.95, flip-rate 0.70, regression 0.80,
  in-log retry 0.60; run verdicts real-failure / flaky / mixed / infra /
  unknown. Actions are suggest-only — nothing is ever applied automatically.
- Stable 12-char SHA-1 failure signatures; clusters counted per distinct
  run (not per failing-test record).
- Composite GitHub Action (`action.yml`): log-file input, verdict /
  signature / report-json outputs, `fail-on-real` opt-in, step-summary
  markdown.
- Known limits (see README roadmap): no JUnit XML input yet, no native
  node:test parser, no dashboard / alerting / auto-quarantine-apply.
