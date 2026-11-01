import assert from "node:assert/strict";
import { test } from "node:test";
import { linkify } from "../src/lib/linkify.ts";

const text = (value) => ({ kind: "text", value });
const link = (value) => ({ kind: "link", value });

test("plain text stays one part", () => {
  assert.deepEqual(linkify("hello"), [text("hello")]);
  assert.deepEqual(linkify(""), []);
});

test("strips trailing punctuation", () => {
  assert.deepEqual(linkify("https://example.com/a)."), [link("https://example.com/a"), text(").")]);
  assert.deepEqual(linkify("see https://example.com/a, ok"), [text("see "), link("https://example.com/a"), text(", ok")]);
});

test("keeps the punctuation outside the link", () => {
  assert.deepEqual(linkify("(https://example.com/a)."), [text("("), link("https://example.com/a"), text(").")]);
});

test("only matches http and https", () => {
  assert.deepEqual(linkify("ftp://x.com javascript:alert(1)"), [text("ftp://x.com javascript:alert(1)")]);
});

test("multiple links", () => {
  assert.deepEqual(linkify("a http://a.com b https://b.com/x?y=1 c"), [
    text("a "), link("http://a.com"), text(" b "), link("https://b.com/x?y=1"), text(" c"),
  ]);
});
