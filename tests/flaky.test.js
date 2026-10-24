import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreFlakiness, rollupVerdict } from "../src/flaky.js";

const key = "src/auth/session.test.js::Session › refreshes token";

test("no history → unknown", () => {
  const r = scoreFlakiness(key, "abc123", []);
  assert.equal(r.verdict, "unknown");
});

test("fail+pass on the same commit → flaky with high confidence", () => {
  const history = [
    { file: "src/auth/session.test.js", name: "Session › refreshes token", commit: "abc123", passed: false },
    { file: "src/auth/session.test.js", name: "Session › refreshes token", commit: "abc123", passed: true },
  ];
  const r = scoreFlakiness(key, "abc123", history);
  assert.equal(r.verdict, "flaky");
  assert.ok(r.confidence >= 0.9);
});

test("consistent failure, passed before on older commit → real regression", () => {
  const history = [
    { file: "src/auth/session.test.js", name: "Session › refreshes token", commit: "old999", passed: true },
    { file: "src/auth/session.test.js", name: "Session › refreshes token", commit: "abc123", passed: false },
  ];
  const r = scoreFlakiness(key, "abc123", history);
  assert.equal(r.verdict, "real");
});

test("frequent flips across runs → flaky", () => {
  const history = [];
  for (let i = 0; i < 6; i += 1) {
    history.push({
      file: "src/auth/session.test.js",
      name: "Session › refreshes token",
      commit: `c${i}`,
      passed: i % 2 === 0,
    });
  }
  const r = scoreFlakiness(key, "c5", history);
  assert.equal(r.verdict, "flaky");
});

test("rollupVerdict combines per-test verdicts", () => {
  assert.equal(rollupVerdict([]), "unknown");
  assert.equal(rollupVerdict([{ verdict: "real" }]), "real-failure");
  assert.equal(rollupVerdict([{ verdict: "flaky" }]), "flaky");
  assert.equal(rollupVerdict([{ verdict: "real" }, { verdict: "flaky" }]), "mixed");
  assert.equal(rollupVerdict([{ verdict: "unknown" }]), "unknown");
});
