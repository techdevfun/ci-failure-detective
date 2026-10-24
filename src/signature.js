// ci-failure-detective — src/signature.js
//
// Stable failure signatures for clustering repeat CI failures.
// Two failures with the same signature are (almost certainly) the same
// underlying problem, even across different commits, branches, or runners.

import { createHash } from "node:crypto";

/**
 * Normalize an error line so incidental details don't change the signature:
 * numbers, paths, timestamps, hashes, durations, memory sizes, line/col.
 */
export function normalizeForSignature(text) {
  return text
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*/g, "<ts>") // timestamps
    .replace(/0x[0-9a-fA-F]+/g, "<hex>") // hex addresses
    .replace(/[0-9a-f]{7,40}/gi, (m) =>
      /^\d+$/.test(m) ? m : "<hash>",
    ) // hashes (keep pure numbers for the next rule)
    .replace(/\b\d+(\.\d+)+\b/g, "<num>") // versions, decimals
    .replace(/\b\d+\b/g, "<num>") // integers (line numbers, counts, ports)
    .replace(/(['"`])(?:(?!\1).){0,120}\1/g, "<str>") // quoted strings
    .replace(/(\/[^\s:;()[\]]+)+/g, "<path>") // unix paths
    .replace(/([A-Za-z]:\\[^\s:;()[\]]+)+/g, "<path>") // windows paths
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Signature for one failure: category + normalized first-error line +
 * normalized failing test names (sorted). Returns a short hex id.
 */
export function signatureFor({ categoryId = "unknown", firstErrorLine = "", failingTests = [] }) {
  const testPart = failingTests
    .map((t) => normalizeForSignature(t))
    .sort()
    .join("|");
  const canonical = [categoryId, normalizeForSignature(firstErrorLine), testPart].join("\n");
  return createHash("sha1").update(canonical).digest("hex").slice(0, 12);
}

/**
 * Group a list of failure records by signature.
 * Each record: { signature, ts, commit, branch, ... }.
 * `count` is the number of distinct runs (distinct commit+timestamp
 * pairs), NOT the number of records — one run with two failing tests
 * is one occurrence, not two.
 * Returns [{ signature, count, firstSeen, lastSeen, records }] sorted by recency.
 */
export function clusterBySignature(records) {
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.signature)) map.set(r.signature, []);
    map.get(r.signature).push(r);
  }
  const clusters = [];
  for (const [signature, rs] of map) {
    const sorted = [...rs].sort((a, b) => a.ts - b.ts);
    const runs = new Set(sorted.map((r) => `${r.commit}::${r.ts}`));
    clusters.push({
      signature,
      count: runs.size,
      firstSeen: sorted[0].ts,
      lastSeen: sorted[sorted.length - 1].ts,
      categoryId: sorted[sorted.length - 1].categoryId || "unknown",
      records: sorted,
    });
  }
  clusters.sort((a, b) => b.lastSeen - a.lastSeen);
  return clusters;
}
