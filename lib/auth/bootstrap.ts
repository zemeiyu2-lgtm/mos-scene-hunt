/**
 * First-run administrator bootstrap.
 *
 * Why not a seed script: the seed would have to duplicate the scrypt
 * parameters and the record shape in plain JavaScript, and any drift there
 * produces an account that silently cannot log in. Running inside the app
 * reuses the exact same code path as normal user creation.
 *
 * Contract:
 *  - runs only when `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` are
 *    both set, and NO admin exists yet;
 *  - idempotent under concurrency (module-level single-flight);
 *  - never overwrites an existing account, never logs the password.
 *
 * After the first successful login the two variables should be removed from
 * the environment: they are a one-time door, not a permanent credential.
 */

import { randomUUID } from "node:crypto";
import { hashPassword, isPasswordAcceptable } from "./password";
import { getRegistry } from "../registry/store";
import type { UserRecord } from "../registry/types";

export interface BootstrapResult {
  created: boolean;
  reason: "no_env" | "admin_exists" | "weak_password" | "invalid_email" | "created" | "error";
  email?: string;
}

let inFlight: Promise<BootstrapResult> | null = null;
let settled: BootstrapResult | null = null;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Single-flight: concurrent callers share one attempt, but a later sequential
 * call must not keep claiming "created" — after the first success the honest
 * answer is "an admin already exists".
 */
export async function ensureBootstrapAdmin(): Promise<BootstrapResult> {
  if (settled) {
    return {
      created: false,
      reason: settled.created ? "admin_exists" : settled.reason,
      email: settled.email,
    };
  }
  if (!inFlight) {
    inFlight = run()
      .then((result) => {
        settled = result;
        return result;
      })
      .catch((error) => {
        console.error("[bootstrap] 引导管理员失败", error);
        const failed: BootstrapResult = { created: false, reason: "error" };
        settled = failed;
        return failed;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Test seam so different env combinations can be exercised in one process. */
export function resetBootstrapForTests(): void {
  inFlight = null;
  settled = null;
}

async function run(): Promise<BootstrapResult> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  if (!email || !password) return { created: false, reason: "no_env" };

  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    return { created: false, reason: "invalid_email" };
  }
  const acceptable = isPasswordAcceptable(password);
  if (!acceptable.ok) return { created: false, reason: "weak_password" };

  const store = getRegistry();
  const users = await store.listUsers();
  if (users.some((u) => u.role === "admin")) {
    return { created: false, reason: "admin_exists" };
  }
  // An existing account with this email but a lower role is NOT promoted
  // silently: that would turn a leaked env var into a privilege escalation.
  if (users.some((u) => u.email === email)) {
    return { created: false, reason: "admin_exists" };
  }

  const fields = await hashPassword(password);
  const now = new Date().toISOString();
  const admin: UserRecord = {
    id: randomUUID(),
    email,
    passwordHash: fields.passwordHash,
    passwordSalt: fields.passwordSalt,
    displayName: "平台管理员",
    role: "admin",
    status: "active",
    createdAt: now,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
  };
  await store.putUser(admin);
  console.info(`[bootstrap] 已创建初始管理员 ${email}（请尽快移除 BOOTSTRAP_ADMIN_* 环境变量）`);
  return { created: true, reason: "created", email };
}
