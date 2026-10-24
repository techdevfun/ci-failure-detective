# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

## Design

ci-failure-detective is intentionally boring from a security perspective:

- **Zero dependencies** — no supply chain beyond Node.js itself.
- **No network access** — the CLI and the Action never make HTTP requests.
  Your logs are read from disk and never leave the runner.
- **No secrets handled** — it parses log text; it never reads env vars,
  tokens, or credentials. (If your log contains a secret, that's a logging
  problem in your own pipeline — rotate it.)
- **Nothing is auto-applied** — quarantine and retry are suggestions in the
  report, never executed actions.

## Reporting a vulnerability

Open a GitHub issue with `[security]` in the title, or email the maintainer
via the profile address. Please do not open a public issue with exploit
details before a fix is available.
