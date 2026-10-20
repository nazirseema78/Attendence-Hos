/**
 * Normalise a phone number to E.164. Local numbers are treated as Pakistani (+92):
 * "0300 1234567", "300 1234567", "92 300 1234567" and "+92 300 1234567" all become "+923001234567".
 * Numbers written with another "+<country code>" are kept as international numbers.
 * Returns null when the input is not a plausible number.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  const digits = raw.replace(/\D/g, "");

  if (raw.startsWith("+") || raw.startsWith("00")) {
    const intl = raw.startsWith("00") ? digits.slice(2) : digits;
    if (intl.startsWith("92")) return /^92[1-9]\d{8,9}$/.test(intl) ? `+${intl}` : null;
    return /^[1-9]\d{7,14}$/.test(intl) ? `+${intl}` : null;
  }
  // Pakistani mobile numbers: 03XX XXXXXXX (11 digits with trunk 0) or 3XX XXXXXXX.
  if (/^03\d{9}$/.test(digits)) return `+92${digits.slice(1)}`;
  if (/^3\d{9}$/.test(digits)) return `+92${digits}`;
  if (/^923\d{9}$/.test(digits)) return `+${digits}`;
  // Pakistani landlines with area code, e.g. 042 3576 1234.
  if (/^0[1-9]\d{8,9}$/.test(digits)) return `+92${digits.slice(1)}`;
  return null;
}

/** +923001234567 -> "+92 300 1234567" */
export function formatPhone(e164: string): string {
  const m = /^\+92(3\d{2})(\d{7})$/.exec(e164);
  return m ? `+92 ${m[1]} ${m[2]}` : e164;
}

/** Example shown in phone inputs. */
export const PHONE_PLACEHOLDER = "0300 1234567";
