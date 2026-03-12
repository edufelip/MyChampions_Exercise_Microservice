# YMove Translation Proxy Microservice

Production-oriented translation-aware proxy for the YMove Exercise API.

It accepts a target language and an upstream exercise search URL, translates the search term to English, forwards the request to YMove, translates human-readable fields in the response to the requested language, and caches per-exercise translations in Redis.

## Highlights

- Clean-layered architecture (`controller -> service -> infrastructure`)
- Strict upstream URL validation to prevent open-proxy abuse
- Language normalization with supported language allowlist
- Google Translate integration with retry/backoff and graceful fallback
- Redis translation cache with versioned keys and TTL
- Structured logs with request IDs and redaction
- Basic Prometheus-compatible metrics endpoint
- Unit and integration tests

## API Contract

### Endpoint

`POST /proxy`

### Catalog Endpoints

- `POST /catalog/search` – multilingual catalog search with prefix + typo-tolerant matching
- `GET /catalog/health` – catalog readiness and sync freshness
- `POST /catalog/review` – update localization status (`reviewed` / `rejected`) and optional localized text fields
  - Requires header: `x-catalog-review-key: <CATALOG_REVIEW_API_KEY>`
- `POST /catalog/benchmark` – benchmark catalog vs upstream relevance/latency for provided queries
  - Requires header: `x-catalog-review-key: <CATALOG_REVIEW_API_KEY>`

### Request Body

```json
{
  "lang": "pt",
  "request": {
    "url": "https://exercise-api.ymove.app/api/v2/exercises?pageSize=20&search=Supino",
    "method": "GET",
    "headers": {
      "Accept": "application/json"
    }
  }
}
```

### Important Security Rules

- Only `GET` is accepted.
- Only host `exercise-api.ymove.app` is accepted.
- Only paths under `/api/v2/exercises` are accepted.
- Only `https` URLs are accepted.
- Only default HTTPS port is accepted.
- Client-provided upstream API key headers are rejected.
- Upstream YMove API key is always injected from `YMOVE_API_KEY` on the server side.

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

## Translation + Cache Rules

- Query term (`search`) is translated to English before forwarding.
- Human-readable response fields are translated and cached.
- Catalog sync uses a curated top-exercise seed list (grouped by muscle group), can fetch multiple pages per seed, deduplicates by exercise ID, and stores localized entries for `en`, `pt`, `es`, `fr`, and `it`.
- Redis cache key format: `exercise:{exerciseId}:{lang}:v1`
- Default TTL: 30 days (`CACHE_TTL_SECONDS=2592000`)
- If translation API fails, original English text is returned.
- If Redis is unavailable, request still succeeds without cache.

## Observability

- Structured logs include request context and flow metrics.
- `x-request-id` is propagated/generated on every request.
- Metrics endpoint: `GET /metrics`
- Available counters:
  - `requests_total`
  - `translation_requests_total`
  - `cache_hits_total`
  - `cache_misses_total`
  - `upstream_requests_total`
  - `catalog_search_requests_total`
  - `catalog_sync_runs_total`
  - `catalog_shadow_checks_total`
  - `catalog_benchmark_runs_total`

## Environment Variables

Copy `.env.example` to `.env`.

Required:

- `YMOVE_API_KEY`
- `GOOGLE_TRANSLATE_API_KEY`

Common configuration:

- `PORT` (default `3000`)
- `REDIS_URL` (default `redis://localhost:6379`)
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
- `CATALOG_TYPO_DISTANCE` (default `1`)
- `CATALOG_REVIEW_API_KEY` (required to enable `/catalog/review`)
- `CATALOG_VERSION_RETENTION` (default `2`)
- `CATALOG_SYNC_ON_STARTUP` (default `true`)
- `CATALOG_SYNC_BACKGROUND_INTERVAL_MS` (default `900000`)
- `CATALOG_STARTUP_SYNC_COOLDOWN_MS` (default `15552000000` = ~6 months)
- `CATALOG_SHADOW_VALIDATION_ENABLED` (default `false`)
- `CATALOG_SHADOW_SAMPLE_RATE` (default `0.1`)

## Local Run

```bash
npm install
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

## Docker

```bash
docker-compose up --build
```

Services:

- `api`
- `redis`

Redis is configured with AOF persistence, `maxmemory 512mb`, and `noeviction` policy to keep catalog records stable as an internal dataset while avoiding host OOM risk.

## Test and Lint

```bash
npm run lint
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
