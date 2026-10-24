import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, toMarkdown } from "../src/detective.js";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "bin", "cifd.js");
const fixture = (name) => readFileSync(join(here, "fixtures", name), "utf8");

test("analyze jest log end-to-end", () => {
  const report = analyze(fixture("jest-fail.log"));
  assert.equal(report.framework, "jest");
  assert.equal(report.category.id, "test-failure");
  assert.equal(report.failingTests.length, 2);
  assert.equal(report.verdict, "unknown"); // no history supplied
  assert.ok(report.signature.length === 12);
  assert.ok(report.rootCause.lineNo > 0);
});

test("analyze npm install log → infra verdict", () => {
  const report = analyze(fixture("npm-install-fail.log"));
  assert.equal(report.category.id, "dependency-install");
  assert.equal(report.verdict, "infra");
  assert.equal(report.failingTests.length, 0);
});

test("analyze pytest log finds the failing test", () => {
  const report = analyze(fixture("pytest-fail.log"));
  assert.equal(report.framework, "pytest");
  assert.equal(report.failingTests.length, 1);
  assert.equal(report.failingTests[0].name, "test_payment_retry_exhaustion");
});

test("in-log retry marks the test flaky without history", () => {
  const report = analyze(fixture("jest-flaky.log"));
  assert.equal(report.failingTests.length, 1);
  assert.equal(report.failingTests[0].flaky.verdict, "flaky");
  assert.equal(report.verdict, "flaky");
});

test("history upgrades verdict to real-failure on consistent breakage", () => {
  const history = [
    {
      ts: 1,
      commit: "old999",
      file: "src/cart/pricing.test.js",
      name: "Cart pricing › applies bulk discount over 10 items",
      passed: true,
    },
  ];
  const report = analyze(fixture("jest-fail.log"), { history, commit: "abc123" });
  assert.equal(report.verdict, "real-failure");
});

test("repeat signature is recognized from history cluster", () => {
  const first = analyze(fixture("jest-fail.log"), { commit: "c1" });
  const history = [
    {
      ts: Date.now() - 86400000,
      commit: "c0",
      file: "x",
      name: "y",
      passed: false,
      signature: first.signature,
      categoryId: "test-failure",
    },
  ];
  const second = analyze(fixture("jest-fail.log"), { history, commit: "c1" });
  assert.ok(second.cluster);
  assert.equal(second.cluster.occurrences, 1);
  assert.equal(second.cluster.signature, first.signature);
});

test("suggestedActions proposes quarantine for flaky tests", () => {
  const report = analyze(fixture("jest-flaky.log"));
  assert.equal(report.verdict, "flaky");
  const q = report.suggestedActions.find((a) => a.kind === "quarantine-suggest");
  assert.ok(q, "has a quarantine suggestion");
  assert.ok(q.detail.includes("--testPathIgnorePatterns") || q.detail.includes("quarantin"), q.detail);
});

test("suggestedActions proposes retry for infra failures", () => {
  const report = analyze(fixture("npm-install-fail.log"));
  assert.equal(report.verdict, "infra");
  const r = report.suggestedActions.find((a) => a.kind === "retry-suggest");
  assert.ok(r, "has a retry suggestion");
});

test("suggestedActions points at the first error for real failures", () => {
  const history = [
    {
      ts: 1,
      commit: "old999",
      file: "src/cart/pricing.test.js",
      name: "Cart pricing › applies bulk discount over 10 items",
      passed: true,
    },
  ];
  const report = analyze(fixture("jest-fail.log"), { history, commit: "abc123" });
  const f = report.suggestedActions.find((a) => a.kind === "fix-first");
  assert.ok(f, "has a fix-first suggestion");
  assert.ok(f.detail.includes("line"), f.detail);
});

test("toMarkdown renders a readable summary", () => {
  const report = analyze(fixture("jest-fail.log"));
  const md = toMarkdown(report);
  assert.ok(md.includes("CI Failure Detective"));
  assert.ok(md.includes(report.signature));
  assert.ok(md.includes("Test failure"));
  assert.ok(md.includes("bulk discount"));
});

test("CLI analyze works on a fixture file (json)", () => {
  const r = spawnSync("node", [cli, "analyze", join(here, "fixtures", "jest-fail.log")], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.framework, "jest");
  assert.equal(report.failingTests.length, 2);
});

test("CLI analyze --format md prints markdown", () => {
  const r = spawnSync(
    "node",
    [cli, "analyze", join(here, "fixtures", "pytest-fail.log"), "--format", "md"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("##"));
  assert.ok(r.stdout.includes("test_payment_retry_exhaustion"));
});

test("CLI analyze reads from stdin", () => {
  const r = spawnSync("node", [cli, "analyze", "-"], {
    input: fixture("tsc-fail.log"),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.category.id, "compile-error");
});

test("CLI record + history round-trip", () => {
  const tmp = join(here, "tmp-history.jsonl");
  try {
    // One run with two failing tests is ONE occurrence; two runs are two.
    const rec1 = spawnSync(
      "node",
      [cli, "record", "--history", tmp, "--commit", "deadbee", join(here, "fixtures", "jest-fail.log")],
      { encoding: "utf8" },
    );
    assert.equal(rec1.status, 0, rec1.stderr);
    let hist = spawnSync("node", [cli, "history", "--history", tmp], { encoding: "utf8" });
    assert.equal(hist.status, 0, hist.stderr);
    assert.ok(hist.stdout.includes("test-failure"));
    assert.ok(hist.stdout.includes("1×"), hist.stdout);
    const rec2 = spawnSync(
      "node",
      [cli, "record", "--history", tmp, "--commit", "cafef00", join(here, "fixtures", "jest-fail.log")],
      { encoding: "utf8" },
    );
    assert.equal(rec2.status, 0, rec2.stderr);
    hist = spawnSync("node", [cli, "history", "--history", tmp], { encoding: "utf8" });
    assert.ok(hist.stdout.includes("2×"), hist.stdout);
  } finally {
    try {
      unlinkSync(tmp);
    } catch { /* already gone */ }
  }
});

test("CLI rejects missing input file", () => {
  const r = spawnSync("node", [cli, "analyze", join(here, "fixtures", "nope.log")], {
    encoding: "utf8",
  });
  assert.equal(r.status, 1);
});

test("analyze exposes passingTests for history pass records", () => {
  const log = [
    "PASS src/cart/pricing.test.js",
    "  Cart pricing",
    "    ✓ rounds tax to 2 decimals",
    "    ✕ applies bulk discount over 10 items",
    "  ● Cart pricing › applies bulk discount over 10 items",
    "    Expected: 18",
    "    Received: 17.7",
  ].join("\n");
  const report = analyze(log);
  assert.equal(report.passingTests.length, 1);
  assert.equal(report.passingTests[0].name, "Cart pricing › rounds tax to 2 decimals");
  assert.equal(report.failingTests.length, 1);
});

test("CLI record labels zero-test runs by true outcome", () => {
  const tmp = join(here, "tmp-history2.jsonl");
  try {
    // Infra failure (no test failed) must NOT be recorded as passed.
    const rec = spawnSync(
      "node",
      [cli, "record", "--history", tmp, "--commit", "deadbee", join(here, "fixtures", "npm-install-fail.log")],
      { encoding: "utf8" },
    );
    assert.equal(rec.status, 0, rec.stderr);
    const lines = readFileSync(tmp, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].passed, false);
    assert.equal(lines[0].categoryId, "dependency-install");
    assert.equal(lines[0].run, true);
    // A clean log records a passed run.
    const rec2 = spawnSync(
      "node",
      [cli, "record", "--history", tmp, "--commit", "cafef00", join(here, "fixtures", "clean.log")],
      { encoding: "utf8" },
    );
    assert.equal(rec2.status, 0, rec2.stderr);
  } finally {
    try {
      unlinkSync(tmp);
    } catch { /* already gone */ }
  }
});
