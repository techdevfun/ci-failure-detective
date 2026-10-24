import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeForSignature,
  signatureFor,
  clusterBySignature,
} from "../src/signature.js";

test("normalizeForSignature strips volatile details", () => {
  const a = normalizeForSignature("FAIL src/cart/pricing.test.js:14:18 - Expected 8991, got 9080");
  const b = normalizeForSignature("FAIL src/cart/other.test.js:99:2 - Expected 12, got 13");
  assert.equal(a, b);
  assert.ok(!/\d{2,}/.test(a.replace(/<num>/g, "")), a);
});

test("same failure shape gives same signature across runs", () => {
  const s1 = signatureFor({
    categoryId: "test-failure",
    firstErrorLine: "FAIL src/cart/pricing.test.js:14:18",
    failingTests: ["Cart pricing › applies bulk discount"],
  });
  const s2 = signatureFor({
    categoryId: "test-failure",
    firstErrorLine: "FAIL src/cart/pricing.test.js:102:7",
    failingTests: ["Cart pricing › applies bulk discount"],
  });
  assert.equal(s1, s2);
  assert.equal(s1.length, 12);
});

test("different failures give different signatures", () => {
  const s1 = signatureFor({
    categoryId: "test-failure",
    firstErrorLine: "FAIL a.test.js",
    failingTests: ["suite › one"],
  });
  const s2 = signatureFor({
    categoryId: "dependency-install",
    firstErrorLine: "npm ERR! network",
    failingTests: [],
  });
  assert.notEqual(s1, s2);
});

test("clusterBySignature groups repeats and tracks first/last seen", () => {
  const records = [
    { signature: "aaa", ts: 100, categoryId: "test-failure" },
    { signature: "bbb", ts: 150, categoryId: "dependency-install" },
    { signature: "aaa", ts: 200, categoryId: "test-failure" },
  ];
  const clusters = clusterBySignature(records);
  assert.equal(clusters.length, 2);
  const aaa = clusters.find((c) => c.signature === "aaa");
  assert.equal(aaa.count, 2);
  assert.equal(aaa.firstSeen, 100);
  assert.equal(aaa.lastSeen, 200);
});

test("cluster count is distinct runs, not records", () => {
  // One run with two failing tests records two lines but is ONE occurrence.
  const records = [
    { signature: "aaa", ts: 100, commit: "c1", name: "test one" },
    { signature: "aaa", ts: 100, commit: "c1", name: "test two" },
    { signature: "aaa", ts: 200, commit: "c2", name: "test one" },
  ];
  const clusters = clusterBySignature(records);
  assert.equal(clusters[0].count, 2);
});
