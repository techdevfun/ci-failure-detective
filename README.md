# CI Failure Detective

**Your CI failed. Was it a real break, or just a flake? And where exactly did it break?**

CI Failure Detective reads a failed CI log and answers three questions: what the first real error was, whether each failing test is flaky or genuinely broken, and whether this exact failure happened before. It runs entirely inside your runner — no logs ever leave your repo, no signup, no SaaS bill.

![Demo: flaky verdict, infra verdict, and failure clusters from real terminal runs](docs/demo/demo.gif)

*Demo recorded from a real terminal session on the repo's own fixture logs: a flaky jest verdict with first error and quarantine suggestion, an infra verdict for a failed npm install, and the failure-cluster history.*

## How it works

```sh
npm test 2>&1 | tee ci.log | npx ci-failure-detective analyze --format md
```

```
## 🟡 CI Failure Detective — flaky

**Category:** Test failure
**Framework:** jest
**Signature:** `a3f9c1e2b4d6` — seen 12× before (first 2026-10-18)

**First error** (line 47):
```
● Cart pricing › applies bulk discount over 10 items
```
> At least one test failed — see the first failing test below.

**Failing tests:**

- `Cart pricing › applies bulk discount over 10 items` (src/cart/pricing.test.js) — **🟡 flaky**
  - Failed on abc1234 but passed on the same commit before — classic flake, no code change in between.

**Suggested next steps** (advisory only — nothing is applied automatically):

- **1 flaky test — quarantine suggested (not applied)**
  - Consider quarantining via --testPathIgnorePatterns or jest.retryTimes: "Cart pricing › applies bulk discount over 10 items"
```

## Install

**As a GitHub Action** (recommended) — add one step after your test command:

```yaml
- name: Run tests
  run: npm test 2>&1 | tee ci.log

- name: Diagnose failures
  if: failure()
  uses: techdevfun/ci-failure-detective@v1
  with:
    log-file: ci.log
```

**As a CLI** — zero dependencies, Node.js 18+:

```sh
npx ci-failure-detective analyze ci.log
cifd analyze ci.log --format md >> $GITHUB_STEP_SUMMARY
```

## What it tells you

| Question | How |
|---|---|
| Where did it actually break? | First error line + stack context, classified (test / compile / dependency / OOM / timeout / lint) |
| Flaky or real? | Verdict per test — `flaky`, `real`, or `unknown` — with a confidence score, based on run history |
| Seen this before? | Stable 12-char failure signature; repeats are clustered with first/last seen dates |
| What should I do? | Suggested actions only — quarantine hints, retry guidance, first-error pointer. Nothing is ever applied automatically |

Flaky detection needs history: commit `.cifd-history.jsonl` in your repo and append each run:

```sh
cifd record --history .cifd-history.jsonl --commit $GITHUB_SHA < ci.log
cifd history   # show failure clusters
```

A test is called **flaky** when it fails and passes on the *same commit* (0.95 confidence), or flips frequently across recent runs (0.70). A test that fails consistently on a commit where it used to pass is a **real** regression (0.80). No history yet? You get `unknown` — it never guesses.

Same-commit verdicts need per-test pass records: run tests verbose (`jest --verbose`, `pytest -v`) so passing tests are visible in the log. Plain (non-verbose) logs only record failures, so same-commit evidence is unavailable from them — flip-rate and regression verdicts still work.

## Supported frameworks

Test-result parsing: **Jest, pytest, go test, Mocha** (best-effort — the best-matching parser wins). But you don't need a test framework at all: failure classification and first-error extraction work on **any raw log** — npm/pip/go install failures, `tsc` errors, Docker build failures, OOM kills.

## How this compares

Honest comparison (checked 2026-10-24):

- **BuildPulse / Trunk / Datadog / Mergify** ($18–99/month): full dashboards, trend analytics, auto-quarantine and auto-retry, Slack/PagerDuty alerts. They require uploading all your test data and logs to their cloud. CI Failure Detective has no dashboard and no alerting — it's a local triage step, not a platform.
- **Gradle Develocity**: AI-powered failure grouping across builds, predictive test selection — enterprise sales-led, heavyweight by design.
- **gh-failmap** (OSS): the closest direct rival for failure clustering — CLI-only, needs Python + `gh` login, GitHub-only, no flaky verdicts.
- **flakestat** (OSS, zero-dependency): the closest philosophical rival — local-first flaky hunting — but it only hunts flakes (via re-runs or JUnit XML); it doesn't cluster failures or read logs.
- **ci-why / ci-log-triage**: explain failures with an LLM — which means your logs go to a third-party API and you pay per run.

CI Failure Detective is the only zero-dependency GitHub Action + CLI that does all three — cluster repeat failures, separate flaky from real, point at the first error — without any byte of your log leaving the runner.

## Action inputs

| Input | Default | Description |
|---|---|---|
| `log-file` | — | Path to the CI log (required) |
| `history-file` | `.cifd-history.jsonl` | Run-history file |
| `commit` | `$GITHUB_SHA` | Commit SHA for flaky scoring |
| `fail-on-real` | `false` | Exit 1 when verdict is `real-failure` |
| `summary` | `true` | Append markdown report to `$GITHUB_STEP_SUMMARY` |

Outputs: `verdict`, `signature`, `report-json`.

## CLI reference

```
cifd analyze [logfile] [--format json|md] [--history FILE] [--commit SHA]
cifd record --commit SHA [--history FILE] < logfile
cifd history [--history FILE]
```

## Roadmap

- JUnit XML as an additional input (alongside raw logs)
- Slack webhook output
- More frameworks: PHPUnit, RSpec, .NET
- SARIF output for code scanning integration

Quarantine stays suggest-only by design — automatically retrying or silencing failures hides real bugs.

## License

MIT
