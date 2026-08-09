# Exercise service quality gates

The Exercise service preserves the documented catalog search payload and
operator-only catalog review boundary. Credentials for YMove and translation
remain server-only.

Required gates:

- `npm run lint`
- `npm run build`
- `npm run test:integration`
- `npm run test:contract`

The contract suite locks catalog search metadata, review authentication failure,
health metadata, and secret isolation. Tests use provider and catalog doubles;
they do not call YMove, Google Translate, Redis, Postgres, or production
deployment paths.
