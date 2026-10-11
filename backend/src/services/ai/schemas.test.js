import { test } from "node:test";
import assert from "node:assert/strict";
import { REDUNDANCY_CHECK_FIELDS } from "./schemas.js";

test("REDUNDANCY_CHECK_FIELDS requires every property it defines - no optional field either provider's strict mode would silently skip", () => {
  const propertyNames = Object.keys(REDUNDANCY_CHECK_FIELDS.properties);
  assert.deepEqual([...REDUNDANCY_CHECK_FIELDS.required].sort(), [...propertyNames].sort());
});

test("REDUNDANCY_CHECK_FIELDS includes the divergence-acknowledgment question (unacknowledged_divergence/divergence_reason)", () => {
  assert.equal(REDUNDANCY_CHECK_FIELDS.properties.unacknowledged_divergence.type, "boolean");
  assert.equal(REDUNDANCY_CHECK_FIELDS.properties.divergence_reason.type, "string");
});
