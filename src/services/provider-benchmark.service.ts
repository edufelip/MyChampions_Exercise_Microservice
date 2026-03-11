import { randomUUID } from 'crypto';
import { config } from '../config';
import {
  CatalogBenchmarkQueryResultDTO,
  CatalogBenchmarkRequestDTO,
  CatalogBenchmarkResponseDTO,
} from '../domain/dtos';
import { forwardToYMove } from '../infrastructure/ymove-client';
import { logger } from '../logger';
import { incCounter } from '../observability/metrics';
import { normalizeLanguage } from './lang-normalizer';
import { searchCatalog } from './catalog.service';
import { translateQueryToEnglish } from './translation.service';

const MAX_BENCHMARK_QUERIES = 50;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 20;

function buildSearchUrl(query: string, pageSize: number): string {
  const url = new URL(`https://${config.allowedUpstreamHost}${config.allowedUpstreamPath}`);
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('search', query);
  return url.toString();
}

function safeAverage(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

export class CatalogBenchmarkError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'bad_request',
  ) {
    super(message);
    this.name = 'CatalogBenchmarkError';
  }
}

export async function runCatalogProviderBenchmark(
  input: CatalogBenchmarkRequestDTO,
): Promise<CatalogBenchmarkResponseDTO> {
  const lang = normalizeLanguage(input.lang);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE)));
  const queries = (input.queries ?? [])
    .map((query) => (typeof query === 'string' ? query.trim() : ''))
    .filter((query) => query.length > 0)
    .slice(0, MAX_BENCHMARK_QUERIES);

  if (queries.length === 0) {
    throw new CatalogBenchmarkError('`queries` must include at least one non-empty search query');
  }

  const requestId = randomUUID();
  const results: CatalogBenchmarkQueryResultDTO[] = [];

  for (const query of queries) {
    let englishQuery = query;
    if (lang !== 'en') {
      try {
        englishQuery = await translateQueryToEnglish(query, lang, requestId);
      } catch (err) {
        logger.warn({ requestId, lang, query, err: String(err) }, 'Benchmark query translation failed, using original query');
      }
    }

    const upstreamStart = Date.now();
    const upstreamResponse = await forwardToYMove(buildSearchUrl(englishQuery, pageSize), 'GET', requestId);
    const upstreamLatencyMs = Date.now() - upstreamStart;

    const catalogStart = Date.now();
    const catalogResponse = await searchCatalog({ lang, query, page: 1, pageSize }, requestId);
    const catalogLatencyMs = Date.now() - catalogStart;

    const upstreamTop = upstreamResponse.exercises.slice(0, pageSize).map((exercise) => exercise.id);
    const catalogTop = catalogResponse.results.slice(0, pageSize).map((exercise) => exercise.id);
    const overlapCount = upstreamTop.filter((id) => catalogTop.includes(id)).length;
    const overlapRate = upstreamTop.length > 0 ? overlapCount / upstreamTop.length : 0;

    results.push({
      query,
      upstreamLatencyMs,
      catalogLatencyMs,
      upstreamResultCount: upstreamResponse.exercises.length,
      catalogResultCount: catalogResponse.results.length,
      topOverlapCount: overlapCount,
      topOverlapRate: overlapRate,
    });
  }

  incCounter('catalog_benchmark_runs_total', { lang, status: 'success' });

  return {
    lang,
    pageSize,
    totalQueries: results.length,
    summary: {
      avgUpstreamLatencyMs: safeAverage(results.map((item) => item.upstreamLatencyMs)),
      avgCatalogLatencyMs: safeAverage(results.map((item) => item.catalogLatencyMs)),
      avgTopOverlapRate: safeAverage(results.map((item) => item.topOverlapRate)),
    },
    results,
  };
}
