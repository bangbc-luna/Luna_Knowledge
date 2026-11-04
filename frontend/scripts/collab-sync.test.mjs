import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenErrorOutcome } from "../src/lib/collab-sync.ts";

test("401 when fetching a collab token ends the session for good", () => {
  assert.equal(tokenErrorOutcome(401), "ended");
});

test("403 and 404 mean access was removed", () => {
  assert.equal(tokenErrorOutcome(403), "denied");
  assert.equal(tokenErrorOutcome(404), "denied");
});

test("network failures and server errors are retried", () => {
  assert.equal(tokenErrorOutcome(undefined), "retry");
  assert.equal(tokenErrorOutcome(500), "retry");
  assert.equal(tokenErrorOutcome(503), "retry");
  assert.equal(tokenErrorOutcome(429), "retry");
});
