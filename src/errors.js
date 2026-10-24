// ci-failure-detective — src/errors.js
//
// Error-line detection and failure classification for CI logs.
// The line-level error patterns are adapted from logtrim's isErrorLine
// (techdevfun/logtrim, MIT) — the CI-specific classification on top is new.

const ERROR_RE =
  /(error|fail(ed|s|ure)?|\berr\b|exception|traceback|panic|fatal|assert|uncaught|denied|timeout|timed out|out of memory|segfault|eaddrinuse|enoent|econnrefused|permission denied|not found|invalid|warning)/i;
const STACK_RE =
  /^\s+at\s+\S+\s*\(.*\)\s*$|^\s+File\s+".*",\s+line\s+\d+|^\s+\^+\s*$|^\s+Caused by:/;

export function isErrorLine(line) {
  if (!line) return false;
  if (STACK_RE.test(line)) return true;
  if (/[✖✗❌]/.test(line)) return true;
  return ERROR_RE.test(line);
}

// --- Failure categories -------------------------------------------------
// Each category: a name, a human description, and matchers tried in order.
// Order matters: more specific categories come first.

const CATEGORIES = [
  {
    id: "dependency-install",
    label: "Dependency / install failure",
    hint: "Network or registry problem while installing dependencies — usually not your code.",
    patterns: [
      /npm ERR! code E[A-Z0-9]+/, // E404/E403 are E + digits, not letters
      /npm error code E[A-Z0-9]+/, // npm 10+ prints "npm error" instead of "npm ERR!"
      /npm ERR! network/,
      /pip.*(Could not find|Connection|SSLError|ReadTimeout)/i,
      /go: .*downloading.*: .* (timeout|connection refused|TLS)/i,
      /cargo.*(failed to download|network.*unreachable)/i,
      /Could not resolve .* (maven|gradle)/i,
      /registry.*(unreachable|refused|timed out)/i,
      /socket hang up/i,
      /ECONNRESET|ENOTFOUND|EAI_AGAIN/,
    ],
  },
  {
    id: "out-of-memory",
    label: "Out of memory",
    hint: "The runner ran out of RAM — consider a larger runner or reducing parallelism.",
    patterns: [
      /out of memory/i,
      /JavaScript heap out of memory/,
      /Killed.*(process|node|java)/,
      /OOMKilled/,
      /heap limit/i,
    ],
  },
  {
    id: "timeout",
    label: "Timeout",
    hint: "A step or test exceeded its time limit.",
    patterns: [
      /\btimed? out\b/i,
      /exceeded.*timeout/i,
      /deadline exceeded/i,
      /Test.*timeout after/i,
    ],
  },
  {
    id: "compile-error",
    label: "Compile / type error",
    hint: "The code does not compile — fix the listed errors first.",
    patterns: [
      /error TS\d+:/,
      /error\[E\d+\]/,
      /cannot find (module|symbol|name)/i,
      /SyntaxError/,
      /Compilation failure/i,
      /BUILD FAILED.*compil/i,
      /javac:.*error:/i,
      /rustc.*error(\[|:)/i,
    ],
  },
  {
    id: "test-failure",
    label: "Test failure",
    hint: "At least one test failed — see the first failing test below.",
    patterns: [
      /FAIL\s+\S+/,
      /✖|✗|❌/,
      /AssertionError/,
      /expect\(.*\)\.(toBe|toEqual|toThrow)/,
      /FAILED tests?\//,
      /^FAILED\s+\S/,
      /--- FAIL:/,
      /^_{2,}\s*\S/, // pytest "___ test_name ___" section header
      /^E\s+\S/, // pytest "E ..." error detail line
      /tests? failed/i,
      /test.*failed/i,
    ],
  },
  {
    id: "lint",
    label: "Lint / format failure",
    hint: "Lint or formatting gate failed — usually auto-fixable.",
    patterns: [
      /eslint.*error/i,
      /prettier.*--check/i,
      /ruff.*failed/i,
      /flake8/,
      /gofmt -l/,
      /hadolint/,
    ],
  },
];

function matchCategory(line) {
  for (const cat of CATEGORIES) {
    if (cat.patterns.some((re) => re.test(line))) return cat;
  }
  return null;
}

/**
 * Classify the overall failure of a log.
 *
 * Two passes: first the earliest error line that matches a KNOWN category
 * (skips structural noise like "=== FAILURES ===" headers or code lines
 * that merely mention "fail"); if none matches, fall back to the earliest
 * error line of any kind.
 *
 * Returns { id, label, hint, line, lineNo }.
 */
export function classifyFailure(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isErrorLine(line)) continue;
    const cat = matchCategory(line);
    if (cat) {
      return {
        id: cat.id,
        label: cat.label,
        hint: cat.hint,
        line: line.trim(),
        lineNo: i + 1,
      };
    }
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isErrorLine(line)) continue;
    // Error line, but no known category.
    return {
      id: "unknown-error",
      label: "Unclassified error",
      hint: "An error was found but did not match a known category.",
      line: line.trim(),
      lineNo: i + 1,
    };
  }
  return {
    id: "no-error-found",
    label: "No error line found",
    hint: "The log has no recognizable error line — the failure may be an exit code without output, or output was truncated.",
    line: "",
    lineNo: 0,
  };
}

/**
 * Extract a context window around the first error line:
 * a few lines before (setup context) and the stack-trace lines after.
 */
export function firstErrorContext(lines, { before = 3, after = 12 } = {}) {
  const found = classifyFailure(lines);
  if (found.lineNo === 0) return { ...found, context: [] };
  const start = Math.max(0, found.lineNo - 1 - before);
  const context = [];
  for (let i = start; i < Math.min(lines.length, found.lineNo - 1 + after); i += 1) {
    const text = lines[i];
    // Keep error lines and stack frames; stop the window at the first
    // clearly-unrelated passing line after the error block.
    if (i >= found.lineNo - 1 && !isErrorLine(text) && text.trim() !== "") {
      if (/^(PASS|ok\s|✓|✔)/.test(text.trim())) break;
    }
    context.push({ lineNo: i + 1, text, isFirst: i === found.lineNo - 1 });
  }
  return { ...found, context };
}
