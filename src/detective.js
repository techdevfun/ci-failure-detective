// ci-failure-detective — src/detective.js
//
// Orchestrator: turn a raw CI log (+ optional run history) into a
// structured failure report.

import { classifyFailure, firstErrorContext } from "./errors.js";
import { parseTestResults, passedOnRetryInLog } from "./parsers.js";
import { signatureFor, clusterBySignature } from "./signature.js";
import { scoreFlakiness, rollupVerdict } from "./flaky.js";

function splitLines(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "" && text.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

/**
 * Analyze a CI log.
 *
 * @param {string} logText
 * @param {object} opts
 * @param {Array}  opts.history  past run records for flaky scoring/clustering
 * @param {string} opts.commit   commit SHA of this run (for flaky scoring)
 * @param {string} opts.branch
 * @returns {object} report
 */
export function analyze(logText, opts = {}) {
  const { history = [], commit = "", branch = "" } = opts;
  const lines = splitLines(logText);

  const rootCause = firstErrorContext(lines);
  const parsed = parseTestResults(lines);

  const failingTests = parsed.tests
    .filter((t) => t.status === "fail")
    .map((t) => {
      const key = `${t.file}::${t.name}`;
      const flakyScore =
        history.length > 0
          ? scoreFlakiness(key, commit, history)
          : {
              verdict: "unknown",
              confidence: 0,
              reason: "No history supplied — pass --history to separate flaky from real.",
            };
      // In-log retry evidence upgrades an "unknown" to "likely flaky".
      let verdict = flakyScore.verdict;
      let reason = flakyScore.reason;
      let confidence = flakyScore.confidence;
      if (verdict === "unknown" && passedOnRetryInLog(lines, t.name)) {
        verdict = "flaky";
        confidence = 0.6;
        reason = "Test failed, then passed on retry inside this same log.";
      }
      return { ...t, key, flaky: { verdict, confidence, reason } };
    });

  const signature = signatureFor({
    categoryId: rootCause.id,
    firstErrorLine: rootCause.line,
    failingTests: failingTests.map((t) => t.name),
  });

  const clusters = history.length > 0 ? clusterBySignature(history) : [];
  const thisCluster = clusters.find((c) => c.signature === signature) || null;

  const runVerdict =
    rootCause.id === "dependency-install" ||
    rootCause.id === "out-of-memory" ||
    rootCause.id === "timeout"
      ? "infra"
      : rollupVerdict(failingTests.map((t) => t.flaky));

  const report = {
    version: "0.1.0",
    verdict: runVerdict,
    framework: parsed.framework,
    category: {
      id: rootCause.id,
      label: rootCause.label,
      hint: rootCause.hint,
    },
    rootCause: {
      line: rootCause.line,
      lineNo: rootCause.lineNo,
      context: rootCause.context,
    },
    failingTests,
    passingTests: parsed.tests.filter((t) => t.status === "pass"),
    signature,
    cluster: thisCluster
      ? {
          signature: thisCluster.signature,
          occurrences: thisCluster.count,
          firstSeen: thisCluster.firstSeen,
          lastSeen: thisCluster.lastSeen,
        }
      : null,
    logLines: lines.length,
  };
  report.suggestedActions = suggestActions(report);
  return report;
}

/**
 * Suggest-only next steps (never auto-applied): quarantine hints for flaky
 * tests, retry guidance for infra failures, first-error pointer for real ones.
 */
export function suggestActions(report) {
  const actions = [];
  const flakyTests = report.failingTests.filter((t) => t.flaky.verdict === "flaky");
  const realTests = report.failingTests.filter((t) => t.flaky.verdict === "real");

  if (flakyTests.length > 0) {
    const names = flakyTests.map((t) => t.name);
    let quarantineHint = "Add these to your quarantine list and investigate separately.";
    if (report.framework === "jest") {
      quarantineHint = `Consider quarantining via --testPathIgnorePatterns or jest.retryTimes: ${names.map((n) => `"${n}"`).join(", ")}`;
    } else if (report.framework === "pytest") {
      quarantineHint = `Consider quarantining via --deselect: ${names.map((n) => `"${n}"`).join(" ")}`;
    } else if (report.framework === "go-test") {
      quarantineHint = `Consider quarantining via -run exclusion or build tags: ${names.join(", ")}`;
    }
    actions.push({
      kind: "quarantine-suggest",
      title: `${flakyTests.length} flaky test${flakyTests.length > 1 ? "s" : ""} — quarantine suggested (not applied)`,
      detail: quarantineHint,
    });
  }

  if (report.verdict === "infra") {
    actions.push({
      kind: "retry-suggest",
      title: "Infrastructure failure — safe to retry",
      detail:
        report.category.id === "dependency-install"
          ? "Network/registry hiccup. Re-run the job; if it repeats, check registry status and proxy config."
          : report.category.id === "out-of-memory"
            ? "Runner ran out of RAM. Re-run with a larger runner or lower parallelism."
            : "A step timed out. Re-run; if it repeats, raise the timeout or split the job.",
    });
  }

  if (realTests.length > 0 && report.rootCause.lineNo > 0) {
    actions.push({
      kind: "fix-first",
      title: "Real failure — start here",
      detail: `First error at line ${report.rootCause.lineNo}: ${report.rootCause.line}`,
    });
  }

  if (report.cluster && report.cluster.occurrences > 0) {
    actions.push({
      kind: "known-issue",
      title: "Seen before",
      detail: `This exact failure occurred ${report.cluster.occurrences} time${report.cluster.occurrences > 1 ? "s" : ""} before — check the linked issue/run before debugging from scratch.`,
    });
  }

  return actions;
}

/**
 * Render a report as GitHub-flavored markdown (for step summaries / PR comments).
 */
export function toMarkdown(report) {
  const out = [];
  const verdictEmoji = {
    "real-failure": "🔴",
    flaky: "🟡",
    mixed: "🟠",
    infra: "🔧",
    unknown: "⚪",
  };
  out.push(
    `## ${verdictEmoji[report.verdict] || "⚪"} CI Failure Detective — ${report.verdict}`,
    "",
    `**Category:** ${report.category.label}`,
    `**Framework:** ${report.framework}`,
    `**Signature:** \`${report.signature}\`` +
      (report.cluster
        ? ` — seen ${report.cluster.occurrences}× before (first ${new Date(report.cluster.firstSeen).toISOString().slice(0, 10)})`
        : " — first occurrence on record"),
    "",
  );
  if (report.rootCause.line) {
    out.push(
      `**First error** (line ${report.rootCause.lineNo}):`,
      "```",
      report.rootCause.line,
      "```",
      `> ${report.category.hint}`,
      "",
    );
  }
  if (report.failingTests.length > 0) {
    out.push("**Failing tests:**", "");
    for (const t of report.failingTests) {
      const mark =
        t.flaky.verdict === "flaky" ? "🟡 flaky" : t.flaky.verdict === "real" ? "🔴 real" : "⚪ unknown";
      out.push(`- \`${t.name}\`${t.file ? ` (${t.file})` : ""} — **${mark}**`);
      out.push(`  - ${t.flaky.reason}`);
    }
    out.push("");
  }
  if (report.suggestedActions && report.suggestedActions.length > 0) {
    out.push("**Suggested next steps** (advisory only — nothing is applied automatically):", "");
    for (const a of report.suggestedActions) {
      out.push(`- **${a.title}**`);
      out.push(`  - ${a.detail}`);
    }
    out.push("");
  }
  out.push(
    "<sub>Analyzed locally by [ci-failure-detective](https://github.com/techdevfun/ci-failure-detective) — no logs leave your runner.</sub>",
  );
  return out.join("\n");
}
