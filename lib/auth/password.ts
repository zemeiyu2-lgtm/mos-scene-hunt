/**
 * Password hashing — scrypt from `node:crypto`, no new dependency.
 *
 * Stored format: salt hex + hash hex, both on the user record. Parameters are
 * pinned in code so a future change is a deliberate, reviewable edit rather
 * than an accidental per-user drift.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** N=2^14, r=8, p=1 → ~16 MiB per hash; `maxmem` is raised to leave headroom. */
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const MIN_PASSWORD_LENGTH = 12;

export interface PasswordHash {
  passwordHash: string;
  passwordSalt: string;
}

export function isPasswordAcceptable(password: string): { ok: boolean; reason?: string } {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `密码至少 ${MIN_PASSWORD_LENGTH} 个字符。` };
  }
  if (password.length > 256) {
    return { ok: false, reason: "密码过长。" };
  }
  // Reject the trivially guessable shapes without pretending this is a
  // strength meter: length is the property scrypt actually rewards.
  if (/^(.)\1+$/.test(password)) {
    return { ok: false, reason: "密码不能是单一重复字符。" };
  }
  return { ok: true };
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return { passwordHash: derived.toString("hex"), passwordSalt: salt.toString("hex") };
}

/** Constant-time comparison; a malformed record verifies as false, never throws. */
export async function verifyPassword(
  password: string,
  passwordHash: string,
  passwordSalt: string,
): Promise<boolean> {
  try {
    const salt = Buffer.from(passwordSalt, "hex");
    const expected = Buffer.from(passwordHash, "hex");
    if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return false;
    const derived = await scrypt(password, salt, KEY_LENGTH, PARAMS);
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
