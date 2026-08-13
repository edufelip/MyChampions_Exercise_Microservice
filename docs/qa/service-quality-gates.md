# Exercise service quality gates

The Exercise service preserves the documented catalog search payload and
operator-only catalog review boundary. Credentials for YMove and translation
remain server-only.

Required gates:

- `npm run lint`
- `npm run build`
- `npm run test:integration`
- `npm run test:contract`
- `npm audit --audit-level=high`

The contract suite locks the complete catalog search DTO (including every
exercise field and response metadata), request normalization, review
authentication failure, health metadata, and secret isolation. The hosted
contract job checks out the exact PR head, runs with `NODE_ENV=test` and
`RATE_LIMIT_REDIS_ENABLED=false`, and enables open-handle diagnostics. Tests
use provider and catalog doubles; they do not call YMove, Google Translate,
Redis, Postgres, or production deployment paths. The lockfile keeps the
audited `js-yaml` transitive packages on patched releases so the hosted
security scan remains fail-closed. Catalog popularity updates are best-effort:
an unavailable popularity store is logged and does not turn a successful search
response into a server error.
