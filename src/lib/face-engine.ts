import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import type { DetectedFace } from "./face-policy";

/*
 * Self-hosted face analysis with face-api (@vladmandic/face-api, the maintained fork of face-api.js)
 * on TensorFlow.js' WebAssembly backend: no paid API, no native TensorFlow binary.
 * Models: SSD MobileNet v1 (detection), 68-point landmarks, ResNet-34 face recognition (128-d descriptor).
 * Runs on the server only; descriptors never leave it.
 */

export const FACE_MODEL_ID = "face-api@1.7.15/ssd_mobilenetv1+landmark68+recognition(128d)";

export type AnalyzedFace = DetectedFace & { descriptor: number[] };

export type Analysis = {
  width: number;
  height: number;
  faces: AnalyzedFace[];
  /** The image re-encoded as JPEG (orientation applied, metadata removed): what gets stored as evidence. */
  jpeg: Buffer;
};

export interface FaceEngine {
  readonly model: string;
  analyze(image: Uint8Array): Promise<Analysis>;
}

/** The uploaded bytes are not a usable image (bad type, corrupt, wrong size). Not a biometric failure. */
export class FaceImageError extends Error {
  constructor(
    readonly code: "invalid_image" | "image_too_small" | "image_too_large",
    message: string,
  ) {
    super(message);
  }
}

const MIN_SIDE = 240;
const MAX_SIDE = 6000;
const MAX_PIXELS = 30_000_000;
/** Images are scaled down to this before analysis: faster, and plenty for a face filling the frame. */
const ANALYSIS_MAX_SIDE = 960;

function modelDir() {
  return path.join(process.cwd(), "node_modules", "@vladmandic", "face-api", "model");
}
function wasmDir() {
  return path.join(process.cwd(), "node_modules", "@tensorflow", "tfjs-backend-wasm", "dist");
}

/** Whether the model files are deployed. Checked before blocking or enabling self-marking. */
export function faceEngineStatus(): { available: boolean; reason: string | null } {
  const needed = [
    path.join(modelDir(), "ssd_mobilenetv1_model.bin"),
    path.join(modelDir(), "face_landmark_68_model.bin"),
    path.join(modelDir(), "face_recognition_model.bin"),
    path.join(wasmDir(), "tfjs-backend-wasm.wasm"),
  ];
  const missing = needed.filter((f) => !existsSync(f));
  return missing.length === 0
    ? { available: true, reason: null }
    : { available: false, reason: `Face model files are missing on the server (${missing.map((m) => path.basename(m)).join(", ")}).` };
}

type FaceApi = typeof import("@vladmandic/face-api/dist/face-api.node-wasm.js");
let ready: Promise<FaceApi> | null = null;

function load(): Promise<FaceApi> {
  ready ??= (async () => {
    const faceapi = (await import("@vladmandic/face-api/dist/face-api.node-wasm.js")) as FaceApi;
    // face-api requires the same @tensorflow/tfjs module instance, so configuring it here applies there.
    const tf = await import("@tensorflow/tfjs");
    const wasm = await import("@tensorflow/tfjs-backend-wasm");
    wasm.setWasmPaths(wasmDir() + path.sep);
    await tf.setBackend("wasm");
    await tf.ready();
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir());
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir());
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir());
    return faceapi;
  })().catch((e) => {
    ready = null; // allow a later retry
    throw e;
  });
  return ready;
}

/** Decode and validate the real image content; returns RGB pixels for analysis and a clean JPEG. */
async function decode(input: Uint8Array) {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw new FaceImageError("invalid_image", "The file is not a readable image.");
  }
  if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) {
    throw new FaceImageError("invalid_image", "Only JPG, PNG or WebP images are accepted.");
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (Math.min(w, h) < MIN_SIDE) throw new FaceImageError("image_too_small", `The image is too small (minimum ${MIN_SIDE}px).`);
  if (Math.max(w, h) > MAX_SIDE) throw new FaceImageError("image_too_large", `The image is too large (maximum ${MAX_SIDE}px).`);

  try {
    // rotate(): apply EXIF orientation. Output carries no EXIF/GPS metadata.
    const base = sharp(input, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: ANALYSIS_MAX_SIDE, height: ANALYSIS_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .removeAlpha();
    const [{ data, info }, jpeg] = await Promise.all([
      base.clone().raw().toBuffer({ resolveWithObject: true }),
      base.clone().jpeg({ quality: 85 }).toBuffer(),
    ]);
    return { rgb: data, width: info.width, height: info.height, jpeg };
  } catch {
    throw new FaceImageError("invalid_image", "The image could not be processed.");
  }
}

/** Brightness (mean grey) and sharpness (Laplacian std-dev) of a face region, on a fixed-size crop. */
async function faceQuality(jpeg: Buffer, box: { x: number; y: number; width: number; height: number }, imgW: number, imgH: number) {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const width = Math.max(1, Math.min(imgW - left, Math.floor(box.width)));
  const height = Math.max(1, Math.min(imgH - top, Math.floor(box.height)));
  const crop = sharp(jpeg).extract({ left, top, width, height }).resize(160, 160, { fit: "fill" }).greyscale();
  const [plain, edges] = await Promise.all([
    crop.clone().stats(),
    crop
      .clone()
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
      .stats(),
  ]);
  return { brightness: plain.channels[0].mean, sharpness: edges.channels[0].stdev };
}

class FaceApiEngine implements FaceEngine {
  readonly model = FACE_MODEL_ID;

  async analyze(image: Uint8Array): Promise<Analysis> {
    const img = await decode(image);
    const faceapi = await load();
    const tensor = faceapi.tf.tensor3d(new Uint8Array(img.rgb), [img.height, img.width, 3], "int32");
    try {
      const results = await faceapi
        .detectAllFaces(tensor as never, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
      const faces: AnalyzedFace[] = [];
      for (const r of results) {
        const box = r.detection.box;
        const q = await faceQuality(img.jpeg, box, img.width, img.height);
        faces.push({
          score: r.detection.score,
          width: box.width,
          height: box.height,
          brightness: q.brightness,
          sharpness: q.sharpness,
          descriptor: Array.from(r.descriptor),
        });
      }
      return { width: img.width, height: img.height, faces, jpeg: img.jpeg };
    } finally {
      tensor.dispose();
    }
  }
}

let engine: FaceEngine | null = null;

/** The face engine, or null if its model files are not deployed (self-marking is then blocked). */
export function getFaceEngine(): FaceEngine | null {
  if (!faceEngineStatus().available) return null;
  engine ??= new FaceApiEngine();
  return engine;
}
