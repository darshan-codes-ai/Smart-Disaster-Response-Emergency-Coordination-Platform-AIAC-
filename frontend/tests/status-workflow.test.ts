import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_STATUSES,
  STATUS_WORKFLOW_SEQUENCE,
  getStatusConfig,
  getNextRecommendedStatus,
  type IncidentStatus,
} from "../lib/status-workflow.ts";

test("IncidentStatus: ALLOWED_STATUSES contains all supported states", () => {
  const expected: IncidentStatus[] = [
    "reported",
    "verified",
    "assigned",
    "in_progress",
    "resolved",
    "cancelled",
  ];
  assert.deepStrictEqual(ALLOWED_STATUSES, expected);
});

test("IncidentStatus: STATUS_WORKFLOW_SEQUENCE follows operational lifecycle order", () => {
  const expectedSeq: IncidentStatus[] = [
    "reported",
    "verified",
    "assigned",
    "in_progress",
    "resolved",
  ];
  assert.deepStrictEqual(STATUS_WORKFLOW_SEQUENCE, expectedSeq);
});

test("getStatusConfig: returns valid config for every allowed status", () => {
  for (const status of ALLOWED_STATUSES) {
    const config = getStatusConfig(status);
    assert.ok(config.label, `Status ${status} should have a label`);
    assert.ok(config.badgeClass, `Status ${status} should have badge styling classes`);
    assert.ok(config.icon, `Status ${status} should have an emoji icon`);
    assert.ok(config.description, `Status ${status} should have a human-readable description`);
  }
});

test("getStatusConfig: gracefully handles null, undefined, and case variations", () => {
  const defaultConfig = getStatusConfig(null);
  assert.strictEqual(defaultConfig.label, "Reported");

  const undefinedConfig = getStatusConfig(undefined);
  assert.strictEqual(undefinedConfig.label, "Reported");

  const upperConfig = getStatusConfig("IN_PROGRESS");
  assert.strictEqual(upperConfig.label, "In Progress");

  const mixedConfig = getStatusConfig("VeRiFiEd");
  assert.strictEqual(mixedConfig.label, "Verified");
});

test("getNextRecommendedStatus: accurately predicts forward operational steps", () => {
  assert.strictEqual(getNextRecommendedStatus("reported"), "verified");
  assert.strictEqual(getNextRecommendedStatus("verified"), "assigned");
  assert.strictEqual(getNextRecommendedStatus("assigned"), "in_progress");
  assert.strictEqual(getNextRecommendedStatus("in_progress"), "resolved");
  assert.strictEqual(getNextRecommendedStatus("resolved"), null);
  assert.strictEqual(getNextRecommendedStatus("cancelled"), null);
  assert.strictEqual(getNextRecommendedStatus(undefined), "verified");
});
