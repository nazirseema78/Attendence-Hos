import { test } from "node:test";
import assert from "node:assert/strict";
import { contrastRatio, darken, normalizeHex, validatePrimaryColor } from "./color";

test("hex normalisation", () => {
  assert.equal(normalizeHex("#047857"), "#047857");
  assert.equal(normalizeHex("047857"), "#047857");
  assert.equal(normalizeHex(" #0f7 "), "#00FF77");
  assert.equal(normalizeHex("green"), null);
  assert.equal(normalizeHex("#12345"), null);
  assert.equal(normalizeHex("#04785z"), null);
});

test("contrast ratio matches WCAG reference values", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF").toFixed(1), "21.0");
  assert.equal(contrastRatio("#FFFFFF", "#FFFFFF").toFixed(1), "1.0");
  assert.ok(contrastRatio("#047857", "#FFFFFF") >= 4.5, "default emerald is readable");
  assert.ok(contrastRatio("#0F172A", "#FFFFFF") >= 4.5, "navy is readable");
});

test("primary colour validation rejects unreadable or invalid colours", () => {
  assert.deepEqual(validatePrimaryColor("#047857"), { ok: true, hex: "#047857" });
  assert.equal(validatePrimaryColor("#FFFF00").ok, false); // yellow: white text unreadable
  assert.equal(validatePrimaryColor("#A7F3D0").ok, false); // light mint
  assert.equal(validatePrimaryColor("red").ok, false);
  assert.equal(validatePrimaryColor("#1D4ED8").ok, true); // blue
});

test("darken", () => {
  assert.equal(darken("#FFFFFF", 0.5), "#808080");
  assert.equal(darken("#047857", 0), "#047857");
});
