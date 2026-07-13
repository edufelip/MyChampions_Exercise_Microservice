# Multilingual Exercise Catalog Microservice

Production-oriented multilingual exercise catalog service backed by YMove ingestion.

It syncs top exercise seeds from YMove, machine-translates localized fields, persists catalog snapshots to Postgres, and serves low-latency multilingual search from Redis as the hot cache. Redis is the runtime serving store; when `POSTGRES_URL` is configured and Redis is empty or unready, the service rebuilds Redis catalog keys from Postgres before falling back to YMove.

## Highlights

- Clean-layered architecture (`controller -> service -> infrastructure`)
- Controlled upstream ingestion from YMove (server-side only)
- Language normalization with supported language allowlist
- Google Translate integration with retry/backoff and graceful fallback
- Redis-backed versioned catalog dataset with Postgres recovery source
- Structured logs with request IDs and redaction
- Basic Prometheus-compatible metrics endpoint
- Unit and integration tests

## API Contract

### Catalog Endpoints

- `POST /catalog/search` – multilingual catalog search with cross-language prefix + typo-tolerant matching
- `GET /catalog/exercises/:id?lang=<locale>` – localized exercise detail by stable exercise ID
- `GET /catalog/health` – catalog readiness and sync freshness with `status` (`ready`, `stale_served`, `redis_unavailable`, `not_ready`, `disabled`)
- `POST /catalog/review` – update localization status (`reviewed` / `rejected`) and optional localized text fields
  - Requires header: `x-catalog-review-key: <CATALOG_REVIEW_API_KEY>`
- `POST /catalog/benchmark` – benchmark catalog vs upstream relevance/latency for provided queries
  - Requires header: `x-catalog-review-key: <CATALOG_REVIEW_API_KEY>`

### `POST /catalog/search` Request Body

```json
{
  "lang": "pt",
  "query": "Agachamento",
  "page": 1,
  "pageSize": 20
}
```

### Search API Notes

- `POST /proxy` is deprecated and now returns HTTP `410 Gone`.
- Search is Redis-first. If a non-empty query misses Redis, the service searches YMove, stores the returned exercises and localizations in Redis, then returns Redis-backed results.
- `lang` is the response locale from the client device/app, not a query-language assertion. A Portuguese query with `lang=en-US` can still match the Portuguese index and return English results.
- Query normalization is accent-insensitive and typo-tolerant based on `CATALOG_TYPO_DISTANCE`; the default `2` supports common cases such as `squatch` matching `squat`.

### Language Behavior

- Missing/invalid `lang` defaults to `en`.
- Supported normalized languages: `en`, `pt`, `es`, `fr`, `it`.
- Examples: `eng -> en`, `pt-BR -> pt`, `EN -> en`.

### Error Response Contract

```json
{
  "error": {
    "code": "bad_request",
    "message": "...",
    "status": 400,
    "requestId": "...",
    "details": {}
  }
}
```

## Translation + Catalog Rules

- Sync ingestion translates upstream English exercise content into supported languages.
- Human-readable response fields are translated and stored in catalog localizations.
- Catalog sync uses a curated top-exercise seed list (grouped by muscle group), can fetch multiple pages per seed, deduplicates by exercise ID, and stores localized entries for `en`, `pt`, `es`, `fr`, and `it`.
- Non-empty search misses are filled on demand from YMove and stored in the active Redis catalog version.
- Localization statuses are honest: `source` for English source text, `machine` for translated text, `fallback` when English is served because translation failed, and `reviewed` / `rejected` for manual review states.
- If translation API fails during sync or on-demand fill, the English source is kept for that localization and marked `fallback`.

## Observability

- Structured logs include request context and flow metrics.
- `x-request-id` is propagated/generated on every request.
- Metrics endpoint: `GET /metrics`
- Available counters:
  - `catalog_search_requests_total`
  - `catalog_sync_runs_total`
  - `catalog_shadow_checks_total`
  - `catalog_benchmark_runs_total`

## Environment Variables

Copy `.env.example` to `.env`.

For local catalog storage backed by Dockerized Postgres and Redis, use the
parent workspace runbook at `../docs/local-catalog-db.md` and start from
`.env.local.example`. The service `dev` script preloads `.env.local`. The local exercise
database connection is:

```bash
POSTGRES_URL=postgres://mychampions_local:mychampions_local_password@localhost:15432/mychampions_exercise_catalog_local
```

Required:

- `YMOVE_API_KEY`
- `GOOGLE_TRANSLATE_API_KEY`

Common configuration:

- `PORT` (default `3000`)
- `REDIS_URL` (default `redis://localhost:6379`)
- `POSTGRES_URL` (unset by default; enables Postgres-backed Redis catalog recovery)
- `CATALOG_POSTGRES_RESTORE_ON_MISS` (default `true`)
- `CACHE_TTL_SECONDS` (default `2592000`)
- `UPSTREAM_TIMEOUT_MS` (default `10000`)
- `TRANSLATION_TIMEOUT_MS` (default `10000`)
- `UPSTREAM_MAX_RETRIES` (default `1`)
- `TRANSLATION_MAX_RETRIES` (default `1`)
- `RATE_LIMIT_WINDOW_MS` (default `60000`)
- `RATE_LIMIT_MAX` (default `100`)
- `MAX_FORWARD_URL_LENGTH` (default `2048`)
- `MAX_SEARCH_LENGTH` (default `200`)
- `CATALOG_ENABLED` (default `true`)
- `CATALOG_SYNC_INTERVAL_MS` (default `15552000000` = ~6 months)
- `CATALOG_SYNC_PAGE_SIZE` (default `100`)
- `CATALOG_SEED_QUERY_LIMIT` (default `80`)
- `CATALOG_SEED_MAX_PAGES` (default `1`)
- `CATALOG_MIN_QUERY_LENGTH` (default `1`)
- `CATALOG_TYPO_DISTANCE` (default `2`)
- `CATALOG_REVIEW_API_KEY` (required to enable `/catalog/review`)
- `CATALOG_VERSION_RETENTION` (default `2`)
- `CATALOG_SYNC_ON_STARTUP` (default `true`)
- `CATALOG_SYNC_BACKGROUND_INTERVAL_MS` (default `900000`)
- `CATALOG_STARTUP_SYNC_COOLDOWN_MS` (default `15552000000` = ~6 months)
- `CATALOG_SHADOW_VALIDATION_ENABLED` (default `false`)
- `CATALOG_SHADOW_SAMPLE_RATE` (default `0.1`)

## Local Run

```bash
# From mychampionsapi-exercises:
bun install
cp .env.local.example .env.local
bun run dev
```

Start local storage from the parent MyChampions workspace before running the service:

```bash
(cd .. && bun run local:db:up)
```

To refresh local catalog data from production Postgres:

```bash
(cd .. && bun run local:db:mirror)
```

The mirror command overwrites only local databases ending in `_local` and reads
production through `ssh digiocean`; it does not write to production.

The existing catalog migration and Redis rebuild scripts are unchanged. Export
the local env before running them, for example:

```bash
set -a
source ./.env.local
set +a
DRY_RUN=false CONFIRM_REDIS_REBUILD=true bun run rebuild:catalog:redis:dev
```

Health check:

```bash
curl http://localhost:3300/health
```

## Docker

```bash
docker-compose up --build
```

Services:

- `api`
- `redis`

Redis is configured with AOF persistence, `maxmemory 512mb`, and `noeviction` policy to keep catalog records stable as the hot serving cache. Postgres is the persistent catalog source used to rebuild Redis when the cache is empty or unready.

## Test and Lint

```bash
bun run lint
npm test
```

## CI/CD Production Deploy

On push to `main`, workflow `.github/workflows/deploy-exercise-prod.yml` will:

- build and push production image to GHCR
- connect to VPS over SSH
- sync deploy files to `/opt/exercise-microservice`
- replace VPS `.env` from GitHub secret
- pull the new image and restart with Docker Compose
- verify `https://exerciseservice.eduwaldo.com/health`

Required GitHub repository secrets:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_KNOWN_HOSTS`
- `GHCR_USERNAME`
- `GHCR_TOKEN`
- `EXERCISESERVICE_ENV_FILE`

`EXERCISESERVICE_ENV_FILE` must include at least:

- `YMOVE_API_KEY=...`
- `GOOGLE_TRANSLATE_API_KEY=...`
- `REDIS_URL=...`
