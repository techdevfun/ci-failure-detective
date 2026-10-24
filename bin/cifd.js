#!/usr/bin/env node
// ci-failure-detective — CLI.
// Usage:
//   <ci-command> 2>&1 | cifd analyze [--history FILE] [--commit SHA] [--branch NAME] [--format json|md]
//   cifd analyze [logfile] [options]
//   cifd record --history FILE --commit SHA [--branch NAME]   (append this run to history)
//   cifd history --history FILE                               (show clusters)
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { analyze, toMarkdown } from "../src/detective.js";
import { clusterBySignature } from "../src/signature.js";

const VERSION = "0.1.0";
const DEFAULT_HISTORY = ".cifd-history.jsonl";

const HELP = `cifd ${VERSION} — find the first real error in a failed CI log.

Usage:
  <command> 2>&1 | cifd analyze [options]     analyze piped log output
  cifd analyze [logfile] [options]            analyze a log file ("-" = stdin)
  cifd record [options] < logfile             append this run's failures to history
  cifd history [options]                      show failure clusters from history

Options:
  --history FILE   JSONL run history (default: ${DEFAULT_HISTORY})
  --commit SHA     commit SHA of this run (for flaky detection)
  --branch NAME    branch name of this run
  --format FMT     analyze output: json (default) or md (GitHub markdown)
  --help, -h       show this help
  --version, -v    show version

Exit codes: 0 ok · 1 unreadable input/history · 2 bad arguments.

Examples:
  npm test 2>&1 | tee ci.log | cifd analyze --commit $GITHUB_SHA
  cifd analyze ci.log --format md >> $GITHUB_STEP_SUMMARY
`;

function parseArgs(argv) {
  const args = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > -1) {
        args.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args.flags[a.slice(2)] = argv[i + 1];
        i += 1;
      } else {
        args.flags[a.slice(2)] = true;
      }
    } else if (a === "-h") {
      args.flags.help = true;
    } else if (a === "-v") {
      args.flags.version = true;
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

function readInput(file) {
  if (!file || file === "-") {
    return readFileSync(0, "utf8");
  }
  return readFileSync(file, "utf8");
}

function readHistory(path) {
  if (!existsSync(path)) return [];
  const records = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      records.push(JSON.parse(t));
    } catch {
      // skip corrupt lines, keep going
    }
  }
  return records;
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (flags.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const [cmd, ...rest] = positional;
  const historyPath = flags.history || DEFAULT_HISTORY;

  if (cmd === "analyze") {
    const file = rest[0];
    let text;
    try {
      text = readInput(file);
    } catch (e) {
      process.stderr.write(`cifd: cannot read input: ${e.message}\n`);
      return 1;
    }
    const history = readHistory(historyPath);
    const report = analyze(text, {
      history,
      commit: flags.commit || process.env.GITHUB_SHA || "",
      branch: flags.branch || process.env.GITHUB_REF_NAME || "",
    });
    if (flags.format === "md") {
      process.stdout.write(`${toMarkdown(report)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
    return 0;
  }

  if (cmd === "record") {
    const file = rest[0];
    let text;
    try {
      text = readInput(file);
    } catch (e) {
      process.stderr.write(`cifd: cannot read input: ${e.message}\n`);
      return 1;
    }
    const commit = flags.commit || process.env.GITHUB_SHA || "";
    const branch = flags.branch || process.env.GITHUB_REF_NAME || "";
    if (!commit) {
      process.stderr.write("cifd: --commit is required to record a run\n");
      return 2;
    }
    const report = analyze(text, { history: [], commit, branch });
    const ts = Date.now();
    const lines = [];
    for (const t of report.failingTests) {
      lines.push(
        JSON.stringify({
          ts,
          commit,
          branch,
          name: t.name,
          file: t.file,
          framework: report.framework,
          signature: report.signature,
          categoryId: report.category.id,
          passed: false,
        }),
      );
    }
    // Per-test pass records: the evidence behind the strongest flaky
    // signal ("failed now but passed on the same commit"). Deliberately
    // no `signature` field — pass records must not inflate failure
    // clusters. Only parsers that see individual passes (jest --verbose,
    // pytest -v) produce these; plain logs record failures only.
    for (const t of report.passingTests || []) {
      lines.push(
        JSON.stringify({
          ts,
          commit,
          branch,
          name: t.name,
          file: t.file,
          framework: report.framework,
          passed: true,
        }),
      );
    }
    // No failing tests: record the run itself, with its TRUE outcome.
    // A log with no error line at all is a clean run; a log whose
    // failure is infra/compile (no test failed) is a FAILED run — it
    // must not be recorded as passed. (An earlier version recorded
    // every zero-test run as passed, mislabeling infra failures.)
    // Per-test "passed on this commit" evidence comes only from the
    // pass records above; a run-level record has no test name and
    // never feeds per-test flaky scoring.
    if (lines.length === 0) {
      const isClean = report.category.id === "no-error-found";
      lines.push(
        JSON.stringify({
          ts,
          commit,
          branch,
          passed: isClean,
          run: true,
          signature: report.signature,
          categoryId: report.category.id,
        }),
      );
    }
    appendFileSync(historyPath, `${lines.join("\n")}\n`);
    process.stderr.write(
      `cifd: recorded ${lines.length} entr${lines.length === 1 ? "y" : "ies"} → ${historyPath}\n`,
    );
    return 0;
  }

  if (cmd === "history") {
    const history = readHistory(historyPath);
    const clusters = clusterBySignature(history.filter((r) => r.signature));
    if (clusters.length === 0) {
      process.stdout.write("No failure history recorded yet.\n");
      return 0;
    }
    for (const c of clusters) {
      const first = new Date(c.firstSeen).toISOString().slice(0, 10);
      const last = new Date(c.lastSeen).toISOString().slice(0, 10);
      process.stdout.write(
        `${c.signature}  ${c.count}×  ${c.categoryId}  first ${first}  last ${last}\n`,
      );
    }
    return 0;
  }

  process.stderr.write(HELP);
  return 2;
}

process.exit(main());
