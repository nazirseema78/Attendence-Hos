"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, StatusBadge } from "@/components/ui";
import { buildingFormat } from "@/lib/timezone";
import { cancelAttendance, startAttendance, submitAttendance } from "./attendance-actions";

const MAX_EDGE = 960;
const timeFormat = buildingFormat({ hour: "numeric", minute: "2-digit" });

type Token = { attemptId: string; expiresAt: number };
type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "camera" }
  | { kind: "captured" }
  | { kind: "submitting" }
  | { kind: "done"; sessionName: string; status: "on_time" | "late"; markedAt: string }
  | { kind: "error"; message: string; canRetry: boolean };

function cameraErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow camera access for this site in your browser settings, then tap Try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is being used by another app. Close it and tap Try again.";
  return "Could not start the camera. Tap Try again.";
}

/**
 * Live selfie capture. Nothing leaves the phone until Submit; Retake and Cancel are free.
 * The server does all face checks and decides; this screen only shows the result.
 */
export function AttendanceFlow({ sessionName, attemptsLeft: initialLeft }: { sessionName: string; attemptsLeft: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tokenRef = useRef<Token | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [canSwitch, setCanSwitch] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(initialLeft);
  const [secure, setSecure] = useState(true);

  useEffect(() => {
    // Browsers only allow the camera on HTTPS (or localhost).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSecure(window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // Leaving the page: release the camera and the unused token.
  useEffect(
    () => () => {
      stopCamera();
      if (tokenRef.current) void cancelAttendance(tokenRef.current.attemptId);
    },
    [],
  );
  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  /** Get a fresh token if there is none or it is about to expire. Never uses up a try. */
  async function ensureToken(): Promise<boolean> {
    const t = tokenRef.current;
    if (t && t.expiresAt - Date.now() > 30_000) return true;
    const r = await startAttendance();
    if (!r.ok) {
      if (r.attemptsLeft !== undefined) setAttemptsLeft(r.attemptsLeft);
      setPhase({ kind: "error", message: r.message, canRetry: r.retryable });
      return false;
    }
    tokenRef.current = { attemptId: r.attemptId, expiresAt: Date.parse(r.expiresAt) };
    setAttemptsLeft(r.attemptsLeft);
    return true;
  }

  async function openCamera(mode = facing) {
    stopCamera();
    setPhase({ kind: "camera" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCanSwitch(devices.filter((d) => d.kind === "videoinput").length > 1);
    } catch (e) {
      stopCamera();
      setPhase({ kind: "error", message: cameraErrorMessage(e), canRetry: true });
    }
  }

  async function begin() {
    setPhase({ kind: "checking" });
    try {
      if (await ensureToken()) await openCamera();
    } catch {
      setPhase({ kind: "error", message: "Could not reach the server. Check the Wi-Fi and try again.", canRetry: true });
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (facing === "user") {
      // Mirror front-camera shots to match the preview the student saw.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setPhoto({ blob, url: URL.createObjectURL(blob) });
        stopCamera();
        setPhase({ kind: "captured" });
      },
      "image/jpeg",
      0.88,
    );
  }

  function retake() {
    setPhoto(null);
    void openCamera();
  }

  function cancel() {
    stopCamera();
    setPhoto(null);
    if (tokenRef.current) void cancelAttendance(tokenRef.current.attemptId);
    tokenRef.current = null;
    setPhase({ kind: "idle" });
  }

  async function submit() {
    if (!photo) return;
    setPhase({ kind: "submitting" });
    try {
      if (!(await ensureToken())) return;
      const form = new FormData();
      form.append("attemptId", tokenRef.current!.attemptId);
      form.append("selfie", photo.blob, "selfie.jpg");
      const r = await submitAttendance(form);
      tokenRef.current = null; // single use
      if (r.ok) {
        setPhoto(null);
        setPhase({ kind: "done", sessionName: r.sessionName, status: r.status, markedAt: r.markedAt });
        return;
      }
      if (r.attemptsLeft !== undefined) setAttemptsLeft(r.attemptsLeft);
      setPhase({ kind: "error", message: r.message, canRetry: r.retryable && (r.attemptsLeft ?? 1) > 0 });
    } catch {
      // The request may not have reached the server; the token is checked again on resubmit.
      setPhase({ kind: "error", message: "Could not send the photo. Check the Wi-Fi and submit again.", canRetry: true });
    }
  }

  if (!secure) {
    return (
      <Alert tone="danger">
        The camera only works on a secure (https://) address. Open the hostel attendance link that starts with https://,
        not a local network address.
      </Alert>
    );
  }

  const triesLine = (
    <p className="text-center text-xs text-muted" aria-live="polite">
      {attemptsLeft} of 3 face-check tries left for this session. Retakes before Submit are free.
    </p>
  );

  return (
    <div className="space-y-4">
      {phase.kind === "idle" && (
        <Card className="space-y-3">
          <p className="text-sm text-muted">
            Connect to the hostel Wi-Fi, then take a clear selfie: face the camera in good light, only you in the picture.
          </p>
          <Button onClick={begin} className="h-12 w-full text-base">
            Mark attendance for {sessionName}
          </Button>
          {triesLine}
        </Card>
      )}

      {phase.kind === "checking" && <p className="py-6 text-center text-sm text-muted">Checking you can mark attendance…</p>}

      {(phase.kind === "camera" || phase.kind === "captured" || phase.kind === "submitting") && (
        <div className="space-y-3">
          <div className="relative mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-2xl bg-black">
            {phase.kind === "camera" && (
              <video
                ref={(el) => {
                  // Attach the stream whichever arrives first: the element or the camera.
                  videoRef.current = el;
                  if (el && streamRef.current && el.srcObject !== streamRef.current) {
                    el.srcObject = streamRef.current;
                    void el.play().catch(() => {});
                  }
                }}
                playsInline
                muted
                aria-label="Camera preview"
                className={`h-full w-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`}
              />
            )}
            {phase.kind !== "camera" && photo && (
              // eslint-disable-next-line @next/next/no-img-element -- local blob preview
              <img src={photo.url} alt="Your selfie" className="h-full w-full object-cover" />
            )}
          </div>

          {phase.kind === "camera" && (
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={cancel} className="h-12">
                Cancel
              </Button>
              <Button onClick={capture} className="h-12 text-base">
                Capture
              </Button>
              {canSwitch && (
                <Button
                  variant="secondary"
                  className="col-span-2"
                  onClick={() => {
                    const next = facing === "user" ? "environment" : "user";
                    setFacing(next);
                    void openCamera(next);
                  }}
                >
                  Switch camera
                </Button>
              )}
            </div>
          )}

          {phase.kind === "captured" && (
            <div className="grid grid-cols-3 gap-3">
              <Button variant="secondary" onClick={cancel} className="h-12">
                Cancel
              </Button>
              <Button variant="secondary" onClick={retake} className="h-12">
                Retake
              </Button>
              <Button onClick={submit} className="h-12">
                Submit
              </Button>
            </div>
          )}

          {phase.kind === "submitting" && (
            <p className="text-center text-sm text-muted" role="status">
              Checking your face… please wait.
            </p>
          )}
          {phase.kind !== "submitting" && triesLine}
        </div>
      )}

      {phase.kind === "done" && (
        <Card className="space-y-2 text-center" role="status">
          <p className="text-lg font-semibold">Attendance marked ✓</p>
          <p className="text-sm text-muted">
            {phase.sessionName} · {timeFormat.format(new Date(phase.markedAt))}
          </p>
          <StatusBadge status={phase.status} />
        </Card>
      )}

      {phase.kind === "error" && (
        <div className="space-y-3">
          <Alert tone="danger">{phase.message}</Alert>
          {phase.canRetry && (
            <>
              <Button
                onClick={() => {
                  setPhoto(null);
                  void begin();
                }}
                className="w-full"
              >
                Try again
              </Button>
              {triesLine}
            </>
          )}
        </div>
      )}
    </div>
  );
}
