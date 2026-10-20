import "server-only";
import { faceEngineStatus, getFaceEngine, type FaceEngine } from "./face-engine";
import { DEFAULT_THRESHOLDS, parseThreshold, type Thresholds } from "./face-policy";

export type FaceConfigStatus = {
  /** Self-marking is possible only when this is true. */
  configured: boolean;
  thresholds: Thresholds;
  /** Why verification is unavailable (missing models, invalid threshold), or null. */
  error: string | null;
};

/**
 * Face verification needs no external account: it is configured when the model files are deployed
 * and the optional thresholds are valid. Invalid thresholds block self-marking rather than falling back.
 */
export function faceConfigStatus(): FaceConfigStatus {
  let thresholds = DEFAULT_THRESHOLDS;
  let error: string | null = null;
  try {
    thresholds = {
      maxDistance: parseThreshold(process.env.FACE_MATCH_MAX_DISTANCE, DEFAULT_THRESHOLDS.maxDistance, 0.3, 0.6),
      minScore: parseThreshold(process.env.FACE_MIN_DETECTION_SCORE, DEFAULT_THRESHOLDS.minScore, 0.5, 0.99),
    };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const engine = faceEngineStatus();
  if (!engine.available) error = engine.reason;
  return { configured: error === null, thresholds, error };
}

/** The engine to use, or null when verification is unavailable (attendance is then blocked). */
export function getVerifier(): FaceEngine | null {
  return faceConfigStatus().configured ? getFaceEngine() : null;
}
