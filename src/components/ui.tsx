import type { ComponentProps, ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-xl border border-border bg-surface p-4 sm:p-5", className)} {...props} />;
}

const buttonVariants = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-border bg-surface text-foreground hover:bg-background",
  danger: "border border-danger/40 bg-danger-bg text-danger hover:opacity-90",
};

export function buttonClass(variant: keyof typeof buttonVariants = "primary", className?: string) {
  return cx(
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
    buttonVariants[variant],
    className,
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof buttonVariants }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted">{hint}</span>}
      {error && <span className="block text-xs text-danger">{error}</span>}
    </label>
  );
}

export const inputClass =
  "block h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Alert({ tone, children }: { tone: "success" | "warning" | "danger"; children: ReactNode }) {
  const styles = {
    success: "bg-success-bg text-success",
    warning: "bg-warning-bg text-warning",
    danger: "bg-danger-bg text-danger",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-lg px-3 py-2 text-sm", styles[tone])}>
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: "on_time" | "late" | "absent" | "pending" }) {
  const map = {
    on_time: ["On time", "bg-success-bg text-success"],
    late: ["Late", "bg-warning-bg text-warning"],
    absent: ["Absent", "bg-danger-bg text-danger"],
    pending: ["Not marked yet", "bg-background text-muted border border-border"],
  } as const;
  const [label, style] = map[status];
  return <span className={cx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", style)}>{label}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-border/60", className)} />;
}
