"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import { cx } from "./ui";

/**
 * A Link that shows immediate feedback while its navigation is in flight. Admin pages query a
 * remote database, so without this a click can look ignored for a second or two.
 */
export function PendingLink({ children, className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props} className={cx("relative", className)}>
      {children}
      <PendingHint />
    </Link>
  );
}

function PendingHint() {
  const { pending } = useLinkStatus();
  return (
    <>
      <span
        aria-hidden
        className={cx(
          "pointer-events-none absolute inset-0 rounded-[inherit] bg-primary/10 transition-opacity",
          pending ? "animate-pulse opacity-100" : "opacity-0",
        )}
      />
      {pending && <span className="sr-only">Loading…</span>}
    </>
  );
}
