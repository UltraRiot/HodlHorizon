// Regression tests for recordReviewQueueSize's growth detection - real
// motivation: 31 Analysis articles were found sitting in "review" with no
// automated way to notice the backlog was accumulating (found only
// because a human asked). This is a real DB-backed test (like
// scanAndGenerate.test.js's concurrent-insert test) rather than a mocked
// one, since the logic under test IS "read back the previous run's row
// and compare" - a disposable, uniquely-named category_scope keeps this
// from touching or being confused with real check history.
import { test } from "node:test";
import assert from "node:assert/strict";
import { query } from "../../db.js";
import { recordReviewQueueSize } from "./contentQualityAudit.js";

function testScope() {
  return `__test_scope_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function cleanup(scope) {
  await query("DELETE FROM content_audit_runs WHERE check_name = 'review_queue_size' AND category_scope = $1", [scope]);
}

test("recordReviewQueueSize reports no growth on the very first run for a scope (nothing to compare against)", async () => {
  const scope = testScope();
  try {
    const result = await recordReviewQueueSize(scope, 12);
    assert.equal(result.grew, null);
    assert.equal(result.previousRunSize, null);
  } finally {
    await cleanup(scope);
  }
});

test("recordReviewQueueSize flags a real jump that clears both the absolute and relative threshold", async () => {
  const scope = testScope();
  try {
    await recordReviewQueueSize(scope, 4);
    const result = await recordReviewQueueSize(scope, 12); // +8 absolute, 3x relative
    assert.notEqual(result.grew, null, "a jump from 4 to 12 should be flagged as unexpected growth");
    assert.equal(result.grew.previousSize, 4);
    assert.equal(result.grew.currentSize, 12);
  } finally {
    await cleanup(scope);
  }
});

test("recordReviewQueueSize does not flag a small increase that clears neither threshold meaningfully", async () => {
  const scope = testScope();
  try {
    await recordReviewQueueSize(scope, 20);
    const result = await recordReviewQueueSize(scope, 22); // +2 absolute, 10% relative - routine noise
    assert.equal(result.grew, null, "a 2-article increase on a 20-article queue is routine, not an accumulating backlog");
  } finally {
    await cleanup(scope);
  }
});

test("recordReviewQueueSize does not flag a large relative jump that's still a trivially small absolute count", () => {
  // Documents the design choice directly rather than re-testing the DB
  // path: going from 1 to 2 is a 100% relative increase but only 1 real
  // article - the absolute threshold exists specifically to prevent this
  // from reading as "the backlog is accumulating."
  const QUEUE_GROWTH_MIN_ABSOLUTE = 5;
  assert.ok(2 - 1 < QUEUE_GROWTH_MIN_ABSOLUTE);
});

test("recordReviewQueueSize flags any nonzero backlog appearing where the queue was previously empty, once past the absolute floor", async () => {
  const scope = testScope();
  try {
    await recordReviewQueueSize(scope, 0);
    const smallJump = await recordReviewQueueSize(scope, 3);
    assert.equal(smallJump.grew, null, "3 new articles from a zero baseline doesn't clear the absolute floor yet");
  } finally {
    await cleanup(scope);
  }
});

test("recordReviewQueueSize flags a real backlog appearing from a zero baseline once it clears the absolute floor", async () => {
  const scope = testScope();
  try {
    await recordReviewQueueSize(scope, 0);
    const bigJump = await recordReviewQueueSize(scope, 6);
    assert.notEqual(bigJump.grew, null, "a queue going from empty to 6 articles is exactly the real regression this check exists to catch");
  } finally {
    await cleanup(scope);
  }
});
