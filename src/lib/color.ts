// Pure colour helpers for institution branding (no I/O).

export const DEFAULT_PRIMARY = "#047857"; // emerald
export const MIN_CONTRAST_ON_WHITE = 4.5; // WCAG AA for normal text: white text on primary buttons

/** "#0f7" / "0F7A55" / "#0f7a55" → "#0F7A55", or null if not a hex colour. */
export function normalizeHex(input: string): string | null {
  const v = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(v)) return `#${v.split("").map((c) => c + c).join("")}`.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(v)) return `#${v}`.toUpperCase();
  return null;
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Darken by mixing towards black (0–1), for hover states. */
export function darken(hex: string, amount: number): string {
  const [r, g, b] = channels(hex).map((c) => Math.round(c * (1 - amount)));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export type ColorCheck = { ok: true; hex: string } | { ok: false; message: string };

/** A primary colour must be valid and keep white button text readable. */
export function validatePrimaryColor(input: string): ColorCheck {
  const hex = normalizeHex(input);
  if (!hex) return { ok: false, message: "Enter a colour like #047857." };
  const ratio = contrastRatio(hex, "#FFFFFF");
  if (ratio < MIN_CONTRAST_ON_WHITE) {
    return {
      ok: false,
      message: `This colour is too light: white text on it would be hard to read (contrast ${ratio.toFixed(1)}:1, needs ${MIN_CONTRAST_ON_WHITE}:1). Choose a darker shade.`,
    };
  }
  return { ok: true, hex };
}
