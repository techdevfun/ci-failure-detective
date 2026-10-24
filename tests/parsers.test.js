import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseJest,
  parsePytest,
  parseGoTest,
  parseMocha,
  parseTestResults,
  passedOnRetryInLog,
} from "../src/parsers.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures", name), "utf8").split("\n");

test("parseJest finds both failing tests with files", () => {
  const { framework, tests } = parseJest(fixture("jest-fail.log"));
  assert.equal(framework, "jest");
  assert.equal(tests.length, 2);
  assert.ok(tests.every((t) => t.file === "src/cart/pricing.test.js"));
  assert.ok(tests.some((t) => t.name.includes("bulk discount")));
  assert.ok(tests.some((t) => t.name.includes("rounds tax")));
});

test("parsePytest finds the failing test with file", () => {
  const { framework, tests } = parsePytest(fixture("pytest-fail.log"));
  assert.equal(framework, "pytest");
  assert.equal(tests.length, 1);
  assert.equal(tests[0].name, "test_payment_retry_exhaustion");
  assert.equal(tests[0].file, "tests/test_payments.py");
});

test("parseGoTest finds both failing tests", () => {
  const { framework, tests } = parseGoTest(fixture("go-test-fail.log"));
  assert.equal(framework, "go-test");
  assert.equal(tests.length, 2);
  const names = tests.map((t) => t.name);
  assert.ok(names.includes("TestCheckoutIdempotency"));
  assert.ok(names.includes("TestInventoryReservationTimeout"));
});

test("parseTestResults picks the best parser per log", () => {
  assert.equal(parseTestResults(fixture("jest-fail.log")).framework, "jest");
  assert.equal(parseTestResults(fixture("pytest-fail.log")).framework, "pytest");
  assert.equal(parseTestResults(fixture("go-test-fail.log")).framework, "go-test");
  assert.equal(parseTestResults(["nothing", "here"]).framework, "unknown");
});

test("passedOnRetryInLog detects the flaky retry pattern", () => {
  const lines = fixture("jest-flaky.log");
  assert.ok(passedOnRetryInLog(lines, "Session › refreshes token before expiry"));
  assert.ok(!passedOnRetryInLog(fixture("jest-fail.log"), "Cart pricing › applies bulk discount over 10 items"));
});

test("parseMocha handles numbered failures", () => {
  const lines = [
    "  1) checkout calculates total:",
    "     AssertionError: expected 10 to equal 12",
    "  2 passing (1s)",
    "  1 failing",
  ];
  const { tests } = parseMocha(lines);
  assert.equal(tests.length, 1);
  assert.equal(tests[0].name, "checkout calculates total");
});

test("parseJest captures verbose passing tests for history pass records", () => {
  // Real jest --verbose layout: suite header on its own line, then ✓ lines.
  const lines = [
    "PASS src/cart/pricing.test.js",
    "  Cart pricing",
    "    ✓ rounds tax to 2 decimals (3 ms)",
    "    ✓ keeps cart total stable",
    "  ● Cart pricing › applies bulk discount over 10 items",
  ];
  const { framework, tests } = parseJest(lines);
  assert.equal(framework, "jest");
  assert.equal(tests.filter((t) => t.status === "pass").length, 2);
  assert.equal(tests.filter((t) => t.status === "fail").length, 1);
  assert.equal(tests.find((t) => t.status === "pass").file, "src/cart/pricing.test.js");
  assert.equal(
    tests.find((t) => t.status === "pass").name,
    "Cart pricing › rounds tax to 2 decimals",
  );
});

test("parsePytest captures -v PASSED lines", () => {
  const lines = [
    "PASSED tests/test_cart.py::test_bulk_discount",
    "FAILED tests/test_cart.py::test_tax_rounding - assert 2.675 == 2.68",
  ];
  const { tests } = parsePytest(lines);
  assert.equal(tests.filter((t) => t.status === "pass").length, 1);
  assert.equal(tests.filter((t) => t.status === "fail").length, 1);
  assert.equal(tests.find((t) => t.status === "pass").name, "test_bulk_discount");
});

test("parseTestResults still picks by failing count, passes ride along", () => {
  const lines = [
    "PASS src/a.test.js",
    "  Suite",
    "    ✓ keeps passing",
    "    ✕ breaks sometimes",
  ];
  const r = parseTestResults(lines);
  assert.equal(r.framework, "jest");
  assert.equal(r.tests.filter((t) => t.status === "fail").length, 1);
  assert.equal(r.tests.filter((t) => t.status === "pass").length, 1);
});

test("parseTestResults falls back to most-tests parser on all-pass logs", () => {
  const lines = [
    "PASS src/auth/session.test.js",
    "  Session",
    "    ✓ refreshes token before expiry (12 ms)",
  ];
  const r = parseTestResults(lines);
  assert.equal(r.framework, "jest");
  assert.equal(r.tests.filter((t) => t.status === "pass").length, 1);
  assert.equal(parseTestResults(["nothing", "here"]).framework, "unknown");
});
