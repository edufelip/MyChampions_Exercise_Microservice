# Selective test execution in CI

`.github/workflows/ci.yml` narrows the `test` job to only the tests related
to what a PR actually changed, instead of always running the full Jest
suite. This is a strict narrowing — it never widens coverage beyond what the
full suite already runs, and it always falls back to the full suite when it
can't be sure a narrower run is safe.

## How it works

1. The `impact` job computes `git merge-base <base> <head>` explicitly, then
   diffs merge-base to head with `git diff --name-status -z -M`. Using the
   merge-base (not the base branch tip) means commits that land on `main`
   after a PR branched off are never misattributed to that PR's diff.
2. `scripts/ci/classify-change-scope.ts` classifies every changed path into
   one of: a full-scope trigger, a known-inert path (docs, markdown), a
   normal source path (`src/**`), or unrecognized. Any full-scope trigger or
   any unrecognized path sets `full_scope=true`.
3. If `full_scope` is true, `test` runs the full `npm test -- --coverage`
   (everything). Otherwise it runs
   `jest --changedSince=<merge-base> --passWithNoTests --coverage`, which
   lets Jest's own dependency graph pick the related test files.
   `--passWithNoTests` means a docs-only change that touches zero tests
   doesn't fail the job.
4. `lint` is unaffected by this — it's cheap enough to always run in full
   regardless of scope.
5. Any push to `main` (a merge or a direct push) always runs the full suite;
   only pull requests get narrowed. That's the authoritative build, not a
   candidate to trust a partial run for.

## What forces full scope

- Dependency/lockfile changes: `package.json`, `package-lock.json`
- Build/tooling config: `jest.config.js`, `tsconfig.json`, `eslint.config.mjs`,
  `Dockerfile`
- The CI workflow files themselves (`.github/workflows/**`)
- The classifier script itself (`scripts/ci/**`)
- Any path that isn't recognized as one of the above, `src/**`, or a
  known-inert path (`README.md`, `CONTEXT.md`, `docs/**`, `*.md`,
  `.gitignore`, `.env*.example`, `.dockerignore`) — fail conservative, not
  silent.

## Verifying locally

```bash
# Simulate a PR whose only change is under src/ — narrow, related tests only.
npx ts-node scripts/ci/classify-change-scope.ts <base-sha> <head-sha>
npx jest --changedSince=<merge-base-sha> --passWithNoTests

# Simulate a docs-only PR — narrow, zero tests, exits 0.
# Simulate a package.json/package-lock.json/jest.config.js change — full scope.
```

`src/__tests__/unit/ci-classify-change-scope.test.ts` covers the
classifier's decision logic directly (dependency/tooling/workflow/classifier
changes → full scope; src/docs-only changes → narrow; unrecognized paths →
full scope).
