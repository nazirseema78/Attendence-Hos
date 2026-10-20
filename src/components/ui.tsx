import { AlertTriangle, CheckCircle2, Circle, Clock, Info, XCircle, type LucideIcon } from "lucide-react";
import { cloneElement, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5", className)} {...props} />;
}

const buttonVariants = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "border border-border bg-surface text-foreground hover:bg-background",
  danger: "border border-danger/30 bg-danger-bg text-danger hover:bg-danger/10",
  ghost: "text-muted hover:bg-background hover:text-foreground",
};

export function buttonClass(variant: keyof typeof buttonVariants = "primary", className?: string) {
  return cx(
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
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

/**
 * Label + control + hint/error. The control is linked to its hint/error via aria-describedby and
 * flagged with aria-invalid, so screen readers announce validation problems.
 */
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
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const control =
    isValidElement(children) && describedBy
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined,
        })
      : children;
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {control}
      {hint && !error && (
        <span id={`${id}-hint`} className="block text-xs text-muted">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="flex items-center gap-1 text-xs text-danger">
          <XCircle aria-hidden className="h-3.5 w-3.5" />
          {error}
        </span>
      )}
    </label>
  );
}

export const inputClass = cx(
  "block h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground placeholder:text-subtle",
  "focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none",
  "aria-invalid:border-danger aria-invalid:ring-danger/20 disabled:bg-background disabled:text-muted",
);

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

const alertStyles: Record<"success" | "warning" | "danger" | "info", [string, LucideIcon]> = {
  success: ["border-success/20 bg-success-bg text-success", CheckCircle2],
  warning: ["border-warning/20 bg-warning-bg text-warning", AlertTriangle],
  danger: ["border-danger/20 bg-danger-bg text-danger", XCircle],
  info: ["border-border bg-info-bg text-info", Info],
};

export function Alert({ tone, children }: { tone: keyof typeof alertStyles; children: ReactNode }) {
  const [style, Icon] = alertStyles[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm", style)}
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const statusStyles = {
  on_time: ["On time", "bg-success-bg text-success ring-success/20", CheckCircle2],
  late: ["Late", "bg-warning-bg text-warning ring-warning/20", Clock],
  absent: ["Absent", "bg-danger-bg text-danger ring-danger/20", XCircle],
  pending: ["Not marked yet", "bg-info-bg text-info ring-border", Circle],
} as const;

/** Status always shown with colour AND text (and an icon), never colour alone. */
export function StatusBadge({ status }: { status: keyof typeof statusStyles }) {
  const [label, style, Icon] = statusStyles[status];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", style)}>
      <Icon aria-hidden className="h-3 w-3" />
      {label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-lg bg-border/70", className)} />;
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {Icon && (
          <span className="hidden h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary sm:flex">
            <Icon aria-hidden className="h-5 w-5" />
          </span>
        )}
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h1>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted">
      {Icon && <Icon aria-hidden className="h-8 w-8 text-subtle" />}
      <div>{children}</div>
    </div>
  );
}
