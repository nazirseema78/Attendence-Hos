import { GraduationCap } from "lucide-react";
import type { Branding } from "@/lib/branding";
import { cx } from "./ui";

/** Institution logo + name. Falls back to an icon in the primary colour when no logo is set. */
export function BrandMark({ brand, size = "md", inverted = false }: { brand: Branding; size?: "md" | "lg"; inverted?: boolean }) {
  const box = size === "lg" ? "h-14 w-14" : "h-9 w-9";
  return (
    <span className="flex min-w-0 items-center gap-3">
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- small, already-optimised logo from our own route
        <img src={brand.logoUrl} alt="" className={cx(box, "shrink-0 rounded-lg bg-white object-contain p-0.5")} />
      ) : (
        <span className={cx(box, "flex shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground")}>
          <GraduationCap aria-hidden className={size === "lg" ? "h-7 w-7" : "h-5 w-5"} />
        </span>
      )}
      <span
        className={cx(
          "truncate font-semibold tracking-tight",
          size === "lg" ? "text-xl" : "text-base",
          inverted ? "text-white" : "text-foreground",
        )}
      >
        {brand.orgName}
      </span>
    </span>
  );
}
