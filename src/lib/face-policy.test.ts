import { test } from "node:test";
import assert from "node:assert/strict";
import { assessFaces, decideMatch, euclideanDistance, parseThreshold } from "./face-policy";

const clear = { score: 0.99, width: 220, height: 260, brightness: 110, sharpness: 40 };
const img = { width: 720, height: 960 };
const t = { maxDistance: 0.5, minScore: 0.8 };
const code = (faces: Parameters<typeof assessFaces>[0]) => {
  const r = assessFaces(faces, img, "attendance", t.minScore);
  return r.ok ? "ok" : r.code;
};

test("exactly one clear face passes", () => {
  assert.equal(code([clear]), "ok");
});

test("rejections: none, several, unclear, too small, dark, bright, blurry", () => {
  assert.equal(code([]), "no_face");
  assert.equal(code([{ ...clear, score: 0.2 }]), "no_face");
  assert.equal(code([clear, { ...clear, score: 0.6 }]), "multiple_faces");
  assert.equal(code([{ ...clear, score: 0.7 }]), "unclear");
  assert.equal(code([{ ...clear, width: 60 }]), "too_small");
  assert.equal(code([{ ...clear, width: 85 }]), "too_small"); // >= 80px but < 12% of 720 (86.4px)
  assert.equal(code([{ ...clear, brightness: 10 }]), "too_dark");
  assert.equal(code([{ ...clear, brightness: 250 }]), "too_bright");
  assert.equal(code([{ ...clear, sharpness: 2 }]), "too_blurry");
});

test("match decision uses the configured distance", () => {
  assert.equal(decideMatch(0.32, t).ok, true);
  assert.equal(decideMatch(0.5, t).ok, true);
  assert.equal(decideMatch(0.51, t).ok, false);
  assert.equal(decideMatch(Number.NaN, t).ok, false);
});

test("euclidean distance", () => {
  assert.equal(euclideanDistance([0, 0], [3, 4]), 5);
  assert.throws(() => euclideanDistance([1], [1, 2]));
  assert.throws(() => euclideanDistance([], []));
});

test("thresholds are validated", () => {
  assert.equal(parseThreshold(undefined, 0.5, 0.3, 0.6), 0.5);
  assert.equal(parseThreshold("0.45", 0.5, 0.3, 0.6), 0.45);
  assert.throws(() => parseThreshold("0.9", 0.5, 0.3, 0.6));
  assert.throws(() => parseThreshold("abc", 0.5, 0.3, 0.6));
});
