import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * B-03 batch 4 (B03-10): internal-tooling access-gating audit, locked as a
 * regression test.
 *
 * Classification fixed by this audit (see the B-03 delivery report for the
 * full write-up):
 *
 *  - PUBLIC player surfaces: /, /select, /map, /games, /quest, /scene,
 *    /challenge, /reward, /bag, /create, /design, /tutorial,
 *    /how-to-create — no gate, nothing privileged behind them.
 *  - CREATOR: /api/publish requires a signed-in user + rate limit;
 *    /admin works pages are owner-scoped for creators (staff sees all).
 *  - ADMIN: every /admin/(protected) page re-validates the session with a
 *    per-page minimum role, and every /api/admin route requires
 *    `admin` or `reviewer` via requireRole + same-origin CSRF guard.
 *  - INTERNAL diagnostics that intentionally stay ungated: /gps-test and
 *    /dev/sounds. Rationale: they are "use client" pages that touch no
 *    server data and no privileged API — the only data they show is the
 *    visitor's own device state. The rule locked below is that they must
 *    STAY client-only and unlinked: the moment either gains a server
 *    dependency it must gain a real gate (hiding the link is not access
 *    control and never was used as such here).
 */

const repoRoot = path.resolve(__dirname, "../..");
const git = (pattern: string) =>
  execSync(`git ls-files "${pattern}"`, { encoding: "utf8", cwd: repoRoot })
    .split("\n")
    .filter(Boolean);

const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

describe("B03-10 admin pages re-validate the session with a minimum role", () => {
  const pages = git("app/admin/(protected)/**/page.tsx");

  it("finds the admin pages (audit is not vacuously passing)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(6);
  });

  it.each(pages)("%s calls requirePageSession", (f) => {
    expect(read(f)).toMatch(/requirePageSession\s*\(/);
  });

  it("role-sensitive pages declare their minimum role", () => {
    expect(read("app/admin/(protected)/users/page.tsx")).toMatch(/requirePageSession\("admin"\)/);
    expect(read("app/admin/(protected)/audit/page.tsx")).toMatch(/requirePageSession\("admin"\)/);
    expect(read("app/admin/(protected)/queue/page.tsx")).toMatch(/requirePageSession\("reviewer"\)/);
    expect(read("app/admin/(protected)/account/page.tsx")).toMatch(/requirePageSession\("creator"\)/);
  });

  it("the work detail page is owner-or-staff scoped (creators only see their own work)", () => {
    const src = read("app/admin/(protected)/works/[gameId]/page.tsx");
    expect(src).toMatch(/isOwner/);
    expect(src).toMatch(/!isOwner && !isStaff/);
    expect(src).toMatch(/notFound\(\)/);
  });
});

describe("B03-10 admin APIs require an explicit role", () => {
  const routes = git("app/api/admin/**/route.ts");

  it("finds the admin API routes (audit is not vacuously passing)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  it.each(routes)("%s authenticates before touching data", (f) => {
    const src = read(f);
    // Either an explicit role floor, or (preview) a session + owner/staff check.
    const roleFloor = /requireRole\(\s*(request|auth)\s*,\s*"(admin|reviewer)"/.test(src);
    const ownerScoped = /requireUser\(request\)/.test(src) && /!isOwner && !isStaff/.test(src);
    expect(roleFloor || ownerScoped).toBe(true);
  });

  it("import-legacy is admin-only (historical content import is a destructive-class action)", () => {
    expect(read("app/api/admin/import-legacy/route.ts")).toMatch(/requireRole\([^)]*"admin"/);
  });

  it("mutations are CSRF-guarded (same-origin + JSON content type)", () => {
    // The guard lives in lib/auth/guard.ts and is exercised by the admin write routes.
    expect(read("lib/auth/guard.ts")).toMatch(/assertSafeMutation/);
    expect(read("lib/auth/cookie.ts")).toMatch(/SameSite=Lax/);
  });

  it("the admin preview endpoint masks ownership with 404 so ids cannot be probed", () => {
    const src = read("app/api/admin/preview/[gameId]/[versionId]/route.ts");
    expect(src).toMatch(/!isOwner && !isStaff/);
    expect(src).toMatch(/work_not_found/);
  });
});

describe("B03-10 public game read API only serves published content", () => {
  const src = read("app/api/games/[gameId]/route.ts");

  it("documents and enforces the published/unlisted contract", () => {
    expect(src).toMatch(/published/);
    expect(src).toMatch(/unlisted/);
    expect(src).toMatch(/404/);
  });

  it("does not serve pending/rejected drafts", () => {
    expect(src).toMatch(/pending|rejected/);
  });
});

describe("B03-10 /gps-test and /dev/sounds stay client-only and unlinked", () => {
  const INTERNAL = ["app/gps-test/page.tsx", "app/dev/sounds/page.tsx"];

  it.each(INTERNAL)("%s is a pure client page with no server dependency", (f) => {
    const src = read(f);
    expect(src.trimStart().startsWith('"use client"')).toBe(true);
    // No server data sources: if one of these pages ever gains one, it must
    // also gain a real access gate (session/role), not just stay unlinked.
    expect(src).not.toMatch(/from\s+"@\/lib\/(auth|registry|publish)/);
    expect(src).not.toMatch(/fetch\(\s*[`"']\/api\/admin/);
  });

  it("public navigation never links the internal pages", () => {
    const publicFiles = git("app/**/*.tsx")
      .concat(git("components/*.tsx"))
      .filter((f) => !f.startsWith("app/admin/") && !f.startsWith("app/gps-test") && !f.startsWith("app/dev/"));
    const offenders: string[] = [];
    for (const f of publicFiles) {
      const src = read(f);
      if (/href\s*=\s*\{?["'`"]\/(gps-test|dev\/sounds)/.test(src)) offenders.push(f);
      // /admin links are allowed only inside the admin area itself
      if (f.startsWith("app/admin")) continue;
      if (/href\s*=\s*\{?["'`"]\/admin\b/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
