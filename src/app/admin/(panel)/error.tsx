"use client";

import { useEffect } from "react";
import { Button, Card } from "@/components/ui";

/** Shown when an admin page fails to load (e.g. the database is unreachable). */
export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = typeof error === "object" && error && "digest" in error ? String(error.digest) : null;

  return (
    <Card className="space-y-3">
      <h1 className="text-lg font-semibold">Attendance data could not load</h1>
      <p className="text-sm text-muted">
        The server could not reach the database or storage. Check your internet connection and try again.
      </p>
      {digest && <p className="font-mono text-xs text-muted">Reference: {digest}</p>}
      <Button onClick={() => retry()}>Try again</Button>
    </Card>
  );
}
