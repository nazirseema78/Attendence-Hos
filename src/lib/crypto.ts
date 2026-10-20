import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

// Compared against when the account doesn't exist, so response time doesn't reveal valid phone numbers.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(password: string, passwordHash: string | null | undefined): Promise<boolean> {
  if (!passwordHash) {
    dummyHash ??= hash(randomToken(), 12);
    await compare(password, await dummyHash);
    return false;
  }
  return compare(password, passwordHash);
}

export const MIN_PASSWORD_LENGTH = 8;
