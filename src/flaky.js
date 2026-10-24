// ci-failure-detective — src/flaky.js
//
// Tell flaky tests apart from real breakage using run history.
//
// Model: every CI run appends one record per failing test:
//   { ts, commit, branch, test, file, framework, signature, categoryId }
//
// A test is FLAKY when it fails AND passes on the same commit
// (rerun flipped the result without any code change), or when its
// pass/fail pattern flips frequently across recent runs.
// A failure is REAL when it fails consistently on the same commit
// and never passed there.

/**
 * Score one failing test against history.
 *
 * The caller only scores tests that FAILED in the current run, so the
 * current outcome is always "failed" — history holds past runs only.
 *
 * @param {string} testKey  "file::name" of the failing test
 * @param {string} commit   commit SHA of the current run
 * @param {Array} history   past run records: { file, name, commit, passed, ... }
 * @returns {{ verdict: 'flaky'|'real'|'unknown', confidence: number, reason: string }}
 */
export function scoreFlakiness(testKey, commit, history) {
  const related = history.filter((r) => `${r.file}::${r.name}` === testKey);
  if (related.length === 0) {
    return {
      verdict: "unknown",
      confidence: 0,
      reason: "No history for this test yet — record a few runs first.",
    };
  }

  // Strongest signal: it fails now, but passed on the SAME commit before.
  const passedSameCommit = related.some((r) => r.commit === commit && r.passed);
  if (passedSameCommit) {
    return {
      verdict: "flaky",
      confidence: 0.95,
      reason: `Failed on ${shortSha(commit)} but passed on the same commit before — classic flake, no code change in between.`,
    };
  }

  // Next: flip rate across recent runs, with the current failure as the
  // latest data point.
  const recent = related.slice(-9);
  const points = [...recent.map((r) => !!r.passed), false];
  let flips = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i] !== points[i - 1]) flips += 1;
  }
  const flipRate = flips / (points.length - 1);
  if (flipRate >= 0.5 && points.length >= 4) {
    return {
      verdict: "flaky",
      confidence: 0.7,
      reason: `Result flipped ${flips} times in the last ${points.length} runs — unstable test.`,
    };
  }

  // Fails on this commit, passed on earlier commits → real regression.
  const everPassed = related.some((r) => r.passed);
  if (everPassed) {
    return {
      verdict: "real",
      confidence: 0.8,
      reason: `Fails on ${shortSha(commit)} and passed on earlier commits — likely a real regression from this change.`,
    };
  }

  return {
    verdict: "real",
    confidence: 0.55,
    reason: "Has never passed in recorded history — probably a real, persistent failure (or a new test).",
  };
}

function shortSha(sha) {
  return String(sha || "").slice(0, 7);
}

/**
 * Roll up per-test verdicts into one run-level verdict.
 */
export function rollupVerdict(testVerdicts) {
  if (testVerdicts.length === 0) return "unknown";
  const flakes = testVerdicts.filter((v) => v.verdict === "flaky").length;
  const reals = testVerdicts.filter((v) => v.verdict === "real").length;
  if (reals > 0 && flakes === 0) return "real-failure";
  if (flakes > 0 && reals === 0) return "flaky";
  if (reals > 0 && flakes > 0) return "mixed";
  return "unknown";
}
