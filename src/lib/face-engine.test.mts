// Real-engine tests: the actual face-api models on the server's WASM backend (no mocks).
// Test images are derived from sample photos shipped inside the @vladmandic/face-api package.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import sharp from "sharp";

const { getFaceEngine, faceEngineStatus, FaceImageError } = await import("./face-engine");
const { assessFaces, decideMatch, euclideanDistance, DEFAULT_THRESHOLDS } = await import("./face-policy");

const DEMO = path.join(process.cwd(), "node_modules", "@vladmandic", "face-api", "demo");
const t = DEFAULT_THRESHOLDS;
const engine = getFaceEngine();

let A: Buffer; // one person (portrait crop)
let B: Buffer; // a different person
before(async () => {
  const group = readFileSync(path.join(DEMO, "sample1.jpg"));
  A = await sharp(group).extract({ left: 280, top: 180, width: 560, height: 700 }).jpeg().toBuffer();
  B = await sharp(group).extract({ left: 1300, top: 150, width: 560, height: 700 }).jpeg().toBuffer();
});

const code = (a: Awaited<ReturnType<NonNullable<typeof engine>["analyze"]>>) => {
  const r = assessFaces(a.faces, a, "attendance", t.minScore);
  return r.ok ? "ok" : r.code;
};

test("models and wasm binaries are present", () => {
  assert.deepEqual(faceEngineStatus(), { available: true, reason: null });
  assert.ok(engine);
});

test("one clear face passes and yields a 128-d descriptor", async () => {
  const a = await engine!.analyze(A);
  assert.equal(code(a), "ok");
  assert.equal(a.faces[0].descriptor.length, 128);
  assert.ok(a.jpeg.length > 1000, "normalised JPEG produced");
});

test("same person matches; a different person does not", async () => {
  const a = await engine!.analyze(A);
  const variant = await engine!.analyze(await sharp(A).flop().modulate({ brightness: 1.1 }).resize(480).jpeg({ quality: 70 }).toBuffer());
  const b = await engine!.analyze(B);
  const same = euclideanDistance(a.faces[0].descriptor, variant.faces[0].descriptor);
  const other = euclideanDistance(a.faces[0].descriptor, b.faces[0].descriptor);
  assert.equal(decideMatch(same, t).ok, true, `same-person distance ${same}`);
  assert.equal(decideMatch(other, t).ok, false, `different-person distance ${other}`);
});

test("group photo is rejected as multiple faces", async () => {
  const a = await engine!.analyze(readFileSync(path.join(DEMO, "sample1.jpg")));
  assert.equal(code(a), "multiple_faces");
});

test("blank image has no face", async () => {
  const blank = await sharp({ create: { width: 500, height: 500, channels: 3, background: "#888" } }).jpeg().toBuffer();
  assert.equal(code(await engine!.analyze(blank)), "no_face");
});

test("a dark image is rejected", async () => {
  const dark = await sharp(A).modulate({ brightness: 0.25 }).jpeg().toBuffer();
  assert.ok(["too_dark", "unclear", "no_face"].includes(code(await engine!.analyze(dark))));
});

test("a face far from the camera is too small", async () => {
  const small = await sharp({ create: { width: 1400, height: 1400, channels: 3, background: "#777" } })
    .composite([{ input: await sharp(A).resize(160).toBuffer(), left: 600, top: 600 }])
    .jpeg()
    .toBuffer();
  assert.equal(code(await engine!.analyze(small)), "too_small");
});

test("invalid content, tiny images and non-image bytes are refused before analysis", async () => {
  await assert.rejects(engine!.analyze(new Uint8Array([1, 2, 3, 4])), (e) => e instanceof FaceImageError && e.code === "invalid_image");
  const tiny = await sharp(A).resize(100).jpeg().toBuffer();
  await assert.rejects(engine!.analyze(tiny), (e) => e instanceof FaceImageError && e.code === "image_too_small");
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  await assert.rejects(engine!.analyze(gif), (e) => e instanceof FaceImageError);
});

test("stored JPEG carries no EXIF/GPS metadata", async () => {
  const withExif = await sharp(A).withExif({ IFD0: { Copyright: "secret-location" } }).jpeg().toBuffer();
  const a = await engine!.analyze(withExif);
  const meta = await sharp(a.jpeg).metadata();
  assert.equal(meta.exif, undefined);
});
