import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isErrorLine, classifyFailure, firstErrorContext } from "../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures", name), "utf8").split("\n");

test("isErrorLine flags real error lines", () => {
  assert.ok(isErrorLine("ERROR: something broke"));
  assert.ok(isErrorLine("npm ERR! code ELIFECYCLE"));
  assert.ok(isErrorLine("    at Object.<anonymous> (foo.js:14:18)"));
  assert.ok(isErrorLine('    File "test_x.py", line 88'));
  assert.ok(!isErrorLine("PASS src/routes/health.test.js"));
  assert.ok(!isErrorLine("collected 48 items"));
  assert.ok(!isErrorLine(""));
});

test("jest fixture classifies as test-failure with the right first error", () => {
  const c = classifyFailure(fixture("jest-fail.log"));
  assert.equal(c.id, "test-failure");
  assert.ok(c.line.includes("FAIL") || c.line.includes("●"), c.line);
});

test("pytest fixture classifies as test-failure", () => {
  const c = classifyFailure(fixture("pytest-fail.log"));
  assert.equal(c.id, "test-failure");
});

test("go test fixture classifies as test-failure", () => {
  const c = classifyFailure(fixture("go-test-fail.log"));
  assert.equal(c.id, "test-failure");
});

test("npm install failure classifies as dependency-install", () => {
  const c = classifyFailure(fixture("npm-install-fail.log"));
  assert.equal(c.id, "dependency-install");
});

test("npm 10+ 'npm error code E404' classifies as dependency-install", () => {
  // Real npm 10/11 output format (no "ERR!" anymore). Found by running a
  // genuinely failing `npm install` of a nonexistent package, 2026-10-24.
  const lines = [
    "npm error code E404",
    "npm error 404 Not Found - GET https://registry.npmjs.org/this-package-does-not-exist-xyz-12345 - Not found",
    "npm error 404",
    "npm error 404  'this-package-does-not-exist-xyz-12345@*' is not in this registry.",
  ];
  const c = classifyFailure(lines);
  assert.equal(c.id, "dependency-install");
  assert.ok(c.line.includes("E404"), c.line);
});

test("tsc failure classifies as compile-error", () => {
  const c = classifyFailure(fixture("tsc-fail.log"));
  assert.equal(c.id, "compile-error");
  assert.ok(c.line.includes("TS2322"), c.line);
});

test("firstErrorContext returns the error plus surrounding lines", () => {
  const lines = fixture("jest-fail.log");
  const ctx = firstErrorContext(lines);
  assert.ok(ctx.context.length > 0);
  const first = ctx.context.find((c) => c.isFirst);
  assert.ok(first, "marks the first error line");
  assert.equal(first.lineNo, ctx.lineNo);
});

test("clean log reports no-error-found", () => {
  const c = classifyFailure(["all good", "PASS everything", "done"]);
  assert.equal(c.id, "no-error-found");
});
