import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptAiNotes, aiNotesFromMetadata, aiNotesFromPacket } from "../src/lib/ai-notes-state.ts";

const meta = (o) => JSON.stringify({ title: "T", hostId: "h", ...o });
const packet = (o) => new TextEncoder().encode(JSON.stringify({ type: "ai_notes", ...o }));

test("a newer version replaces the state", () => {
  assert.deepEqual(acceptAiNotes({ enabled: true, version: 1 }, { enabled: false, version: 2 }), { enabled: false, version: 2 });
});

test("an older version is ignored", () => {
  const current = { enabled: false, version: 5 };
  assert.equal(acceptAiNotes(current, { enabled: true, version: 4 }), current);
});

test("the same version is accepted and keeps the version", () => {
  assert.deepEqual(acceptAiNotes({ enabled: true, version: 3 }, { enabled: false, version: 3 }), { enabled: false, version: 3 });
});

test("an unversioned message from an old room is accepted without lowering the version", () => {
  assert.deepEqual(acceptAiNotes({ enabled: true, version: 3 }, { enabled: false }), { enabled: false, version: 3 });
});

test("metadata is parsed with and without a version", () => {
  assert.deepEqual(aiNotesFromMetadata(meta({ aiNotesEnabled: true, version: 7 })), { enabled: true, version: 7 });
  assert.deepEqual(aiNotesFromMetadata(meta({ aiNotesEnabled: false })), { enabled: false });
  assert.equal(aiNotesFromMetadata(meta({ aiNotesEnabled: "yes" })), null);
  assert.equal(aiNotesFromMetadata("not json"), null);
  assert.equal(aiNotesFromMetadata(undefined), null);
});

test("packets are parsed with and without a version", () => {
  assert.deepEqual(aiNotesFromPacket(packet({ enabled: true, version: 2 })), { enabled: true, version: 2 });
  assert.deepEqual(aiNotesFromPacket(packet({ enabled: false })), { enabled: false });
  assert.equal(aiNotesFromPacket(new TextEncoder().encode(JSON.stringify({ type: "other", enabled: true }))), null);
});
