import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTION_LABEL, actionText } from "../src/lib/format.ts";

test("a batched trash.empty shows the batch position", () => {
  assert.equal(actionText("trash.empty", { deletedRoots: 200, batch: 2, batches: 3 }), "Dọn thùng rác (đợt 2/3)");
});

test("a single trash.empty and other actions keep their plain label", () => {
  assert.equal(actionText("trash.empty", { deletedRoots: 3 }), "Dọn thùng rác");
  assert.equal(actionText("trash.empty", null), "Dọn thùng rác");
  assert.equal(actionText("node.trash", { batch: 1, batches: 2 }), ACTION_LABEL["node.trash"]);
  assert.equal(actionText("unknown.action", null), "unknown.action");
});
