// ci-failure-detective — src/parsers.js
//
// Extract per-test results from CI logs of common frameworks.
// Each parser returns { framework, tests: [{ name, file, status }] }.
// status is "fail" or "pass". Only failing tests are guaranteed; passing
// tests are included on a best-effort basis.

function uniqByName(tests) {
  const seen = new Set();
  return tests.filter((t) => {
    const key = `${t.file}::${t.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- Jest ----------------------------------------------------------------
//   ● Suite name › test name        (failure blocks)
//   PASS path/file.test.js
//   FAIL path/file.test.js
export function parseJest(lines) {
  const tests = [];
  let currentFile = "";
  let currentSuite = "";
  const failHeader = /^\s*●\s+(.+?)\s*›\s*(.+?)\s*$/;
  // Real jest --verbose layout: suite name on its own 2-space line, then
  // 4-space "✓ test name (N ms)" / "✕ test name" lines beneath it.
  const suiteLine = /^  ([^✓✕●\s].*?)\s*$/;
  const resultLine = /^\s*[✓✕]\s+(.+?)\s*(?:\(\d+\s*ms\))?\s*$/;
  const fileLine = /^(PASS|FAIL)\s+(\S+)/;
  // A 2-space line is a suite header only if a ✓/✕ result line follows
  // before the next file line (guards against stray indented output).
  const hasResultAhead = (from) => {
    for (let j = from + 1; j < lines.length; j += 1) {
      if (fileLine.test(lines[j])) return false;
      if (resultLine.test(lines[j])) return true;
    }
    return false;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fl = line.match(fileLine);
    if (fl) {
      currentFile = fl[2];
      currentSuite = "";
      continue;
    }
    const fh = line.match(failHeader);
    if (fh) {
      tests.push({
        name: `${fh[1].trim()} › ${fh[2].trim()}`,
        file: currentFile,
        status: "fail",
      });
      continue;
    }
    const sl = line.match(suiteLine);
    if (sl && hasResultAhead(i)) {
      currentSuite = sl[1].trim();
      continue;
    }
    const rl = line.match(resultLine);
    if (rl) {
      const name = currentSuite ? `${currentSuite} › ${rl[1].trim()}` : rl[1].trim();
      tests.push({
        name,
        file: currentFile,
        status: line.includes("✓") ? "pass" : "fail",
      });
    }
  }
  return { framework: "jest", tests: uniqByName(tests) };
}

// --- pytest ---------------------------------------------------------------
//   FAILED tests/test_x.py::test_name - reason
//   tests/test_x.py ........F....
export function parsePytest(lines) {
  const tests = [];
  const failedRe = /^FAILED\s+(\S+?)(::(\S+))?\s+-/;
  const failedShort = /^FAILED\s+(\S+)/;
  const passedRe = /^PASSED\s+(\S+?)(::(\S+))?\s*$/; // pytest -v passing test
  for (const line of lines) {
    let m = line.match(passedRe);
    if (m) {
      const filePart = m[1].split("::")[0];
      tests.push({
        name: m[3] || filePart,
        file: filePart,
        status: "pass",
      });
      continue;
    }
    m = line.match(failedRe);
    if (m) {
      // m[1] = file part (lazy match stops before "::"), m[3] = test name.
      const filePart = m[1].split("::")[0];
      tests.push({
        name: m[3] || filePart,
        file: filePart,
        status: "fail",
      });
      continue;
    }
    m = line.match(failedShort);
    if (m) {
      const full = m[1];
      const parts = full.split("::");
      tests.push({
        name: parts.slice(1).join("::") || parts[0],
        file: parts[0],
        status: "fail",
      });
    }
  }
  return { framework: "pytest", tests: uniqByName(tests) };
}

// --- go test --------------------------------------------------------------
//   --- FAIL: TestName (1.87s)
//       file_test.go:142: message
//   FAIL  package/path  2.104s
export function parseGoTest(lines) {
  const tests = [];
  const failRe = /^--- FAIL:\s+(\S+)/;
  const pkgFailRe = /^FAIL\s+(\S+)\s+[\d.]+s/;
  const locRe = /^\s+(\S+_test\.go):(\d+):/;
  let pending = null;
  let currentPkg = "";
  for (const line of lines) {
    const pf = line.match(pkgFailRe);
    if (pf) currentPkg = pf[1];
    const f = line.match(failRe);
    if (f) {
      pending = { name: f[1], file: currentPkg, status: "fail" };
      tests.push(pending);
      continue;
    }
    if (pending && !pending.loc) {
      const loc = line.match(locRe);
      if (loc) {
        pending.file = loc[1];
        pending.loc = loc[2];
        pending = null;
      }
    }
  }
  return { framework: "go-test", tests: uniqByName(tests) };
}

// --- mocha ----------------------------------------------------------------
//   1) Suite name test name:
//      AssertionError ...
//   passing / failing summary lines
export function parseMocha(lines) {
  const tests = [];
  const failRe = /^\s*\d+\)\s+(.+?):\s*$/;
  for (const line of lines) {
    const m = line.match(failRe);
    if (m && !/passing|failing|pending/.test(m[1])) {
      tests.push({ name: m[1].trim(), file: "", status: "fail" });
    }
  }
  return { framework: "mocha", tests: uniqByName(tests) };
}

const PARSERS = [parseJest, parsePytest, parseGoTest, parseMocha];

/**
 * Try every parser, return the one that found the most failing tests.
 * Passing tests ride along (for history pass records) but do not decide
 * the parser — only failing tests count toward the match.
 * Returns { framework: 'unknown', tests: [] } when nothing matches.
 */
export function parseTestResults(lines) {
  let best = { framework: "unknown", tests: [] };
  let bestFails = 0;
  for (const parse of PARSERS) {
    const got = parse(lines);
    const fails = got.tests.filter((t) => t.status === "fail").length;
    if (fails > bestFails) {
      bestFails = fails;
      best = got;
    }
  }
  if (bestFails > 0) return best;
  // No failing test anywhere: fall back to the parser that saw the most
  // tests at all (an all-pass log still identifies its framework, and
  // `record` needs those pass records for same-commit flaky evidence).
  // A log with no tests at all still matches nothing ("unknown").
  let bestTotal = 0;
  for (const parse of PARSERS) {
    const got = parse(lines);
    if (got.tests.length > bestTotal) {
      bestTotal = got.tests.length;
      best = got;
    }
  }
  return best;
}

/**
 * Heuristic: did a failing test pass on retry *within this same log*?
 * Catches patterns like jest --onlyFailures retry or explicit "Retrying…".
 */
export function passedOnRetryInLog(lines, testName) {
  const retryMarkers = /retest|retrying|onlyFailures|rerun/i;
  let sawFail = false;
  let sawRetry = false;
  const nameBits = testName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  for (const line of lines) {
    if (retryMarkers.test(line)) sawRetry = true;
    const low = line.toLowerCase();
    if (/fail/.test(low) && nameBits.some((w) => low.includes(w))) sawFail = true;
    if (
      sawFail &&
      sawRetry &&
      /^(PASS|ok\s|✓)/.test(line.trim()) &&
      nameBits.some((w) => low.includes(w))
    ) {
      return true;
    }
  }
  return false;
}
