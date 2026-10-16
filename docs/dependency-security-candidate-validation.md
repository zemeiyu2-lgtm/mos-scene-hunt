# Dependency Security Candidate Validation

Date: 2026-10-16

## Candidate versions

- Next.js: 16.4.2
- Vitest and `@vitest/coverage-v8`: 4.1.12
- Tailwind CSS and `@tailwindcss/postcss`: 4.3.3
- Puppeteer Core: 25.14.0
- esbuild: 0.28.2

Tailwind v4 is configured to load the existing project theme from `tailwind.config.ts`. The Next.js 16 migration removes the obsolete `eslint` configuration property.

## Verification evidence

- TypeScript typecheck: passed
- Unit tests: passed
- Production build: passed with Next.js 16.4.2 / Turbopack
- Browser acceptance: 40 passed, 0 failed
- npm audit: 0 vulnerabilities (0 critical, 0 high, 0 moderate)

Workflow run: https://github.com/zemeiyu2-lgtm/mos-scene-hunt/actions/runs/38882288205

## Scope and limitations

Browser acceptance uses Chrome with simulated GPS and mobile viewports; it does not replace a physical iPhone outdoor GPS test. This candidate is for review only. It has not been merged into the release branch or deployed to production.
