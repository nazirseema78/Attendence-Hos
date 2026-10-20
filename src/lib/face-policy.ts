// Pure face-verification rules (no I/O), so they can be unit-tested.

export type DetectedFace = {
  /** Detector confidence, 0–1. */
  score: number;
  /** Face box size in pixels (of the analysed image). */
  width: number;
  height: number;
  /** Mean grey level of the face region, 0–255 (null when not measured). */
  brightness: number | null;
  /** Edge strength of the face region (Laplacian std-dev); higher is sharper (null when not measured). */
  sharpness: number | null;
};

export type FaceProblem = "no_face" | "multiple_faces" | "unclear" | "too_small" | "too_dark" | "too_bright" | "too_blurry";
export type FaceCheck = { ok: true } | { ok: false; code: FaceProblem; message: string };

/** Faces at or above this detector score count as "a face in the picture". */
export const PRESENCE_SCORE = 0.5;
export const MIN_FACE_PX = 80;
export const MIN_FACE_FRACTION = 0.12;
export const MIN_BRIGHTNESS = 30;
export const MAX_BRIGHTNESS = 235;
export const MIN_SHARPNESS = 8;

/**
 * Exactly one clear, large-enough, well-lit, sharp face is required, both for registration photos
 * and attendance selfies. `minScore` is the configurable detector confidence for that face.
 */
export function assessFaces(
  faces: DetectedFace[],
  image: { width: number; height: number },
  purpose: "registration" | "attendance",
  minScore: number,
): FaceCheck {
  const subject = purpose === "registration" ? "The photo" : "The selfie";
  const present = faces.filter((f) => f.score >= PRESENCE_SCORE);
  if (present.length === 0) {
    return { ok: false, code: "no_face", message: `${subject} has no detectable face. Face the camera in good light.` };
  }
  if (present.length > 1) {
    return { ok: false, code: "multiple_faces", message: `${subject} has more than one face. Only one person may be in the picture.` };
  }
  const [f] = present;
  if (f.score < minScore) {
    return { ok: false, code: "unclear", message: `${subject} does not show a clear face. Look straight at the camera.` };
  }
  const shorterSide = Math.min(image.width, image.height);
  if (f.width < MIN_FACE_PX || f.width < shorterSide * MIN_FACE_FRACTION) {
    return { ok: false, code: "too_small", message: `The face in ${subject.toLowerCase()} is too small. Move closer to the camera.` };
  }
  if (f.brightness !== null && f.brightness < MIN_BRIGHTNESS) {
    return { ok: false, code: "too_dark", message: `${subject} is too dark. Move to better light.` };
  }
  if (f.brightness !== null && f.brightness > MAX_BRIGHTNESS) {
    return { ok: false, code: "too_bright", message: `${subject} is too bright. Avoid strong light behind or on your face.` };
  }
  if (f.sharpness !== null && f.sharpness < MIN_SHARPNESS) {
    return { ok: false, code: "too_blurry", message: `${subject} is too blurry. Hold still and try again.` };
  }
  return { ok: true };
}

export type Thresholds = {
  /** Maximum descriptor distance accepted as the same person (lower = stricter). */
  maxDistance: number;
  /** Minimum detector confidence for the single face. */
  minScore: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = { maxDistance: 0.5, minScore: 0.8 };

/** Parse a threshold from config, rejecting values that would make verification meaningless. */
export function parseThreshold(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`Threshold "${raw}" is outside the allowed range ${min}–${max}.`);
  }
  return n;
}

export function euclideanDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) throw new Error("Descriptor length mismatch");
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export type MatchDecision = { ok: true } | { ok: false; code: "face_mismatch"; message: string };

/** Final server-side decision on the descriptor distance. Nothing the browser says is considered. */
export function decideMatch(distance: number, t: Thresholds): MatchDecision {
  if (!Number.isFinite(distance) || distance > t.maxDistance) {
    return {
      ok: false,
      code: "face_mismatch",
      message: "Your face did not match your registered photo. Face the camera directly in good light and try again.",
    };
  }
  return { ok: true };
}
