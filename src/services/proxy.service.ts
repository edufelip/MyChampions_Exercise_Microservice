/**
 * Proxy service – main business logic orchestrator.
 *
 * Flow:
 *  1. Normalize language.
 *  2. Validate URL.
 *  3. Translate search query to English.
 *  4. Forward request to YMove API.
 *  5. Translate response exercises to target language.
 *  6. Return translated response + observability metrics.
 */
import { randomUUID } from 'crypto';
import { config } from '../config';
import { RequestDTO, TranslatedExerciseListResponse, RequestMetrics } from '../domain/dtos';
import { normalizeLanguage } from './lang-normalizer';
import {
  validateUpstreamUrl,
  extractSearchParam,
  replaceSearchParam,
  UrlValidationError,
} from './url-validator';
import { translateQueryToEnglish, translateExercises } from './translation.service';
import { forwardToYMove, YMoveError } from '../infrastructure/ymove-client';
import { logger } from '../logger';
import { incCounter } from '../observability/metrics';

export { YMoveError };
export { UrlValidationError } from './url-validator';

export interface ProxyResult {
  response: TranslatedExerciseListResponse;
  metrics: RequestMetrics;
}

/**
 * Execute the full translation proxy flow.
 *
 * @throws UrlValidationError  if the URL is forbidden.
 * @throws YMoveError          if the upstream API fails.
 */
export async function executeProxy(dto: RequestDTO): Promise<ProxyResult> {
  const startMs = Date.now();
  const requestId = randomUUID();

  // Step 1 – Normalize language
  const lang = normalizeLanguage(dto.lang);

  // Step 2 – Validate URL
  const parsedUrl = validateUpstreamUrl(dto.request.url);

  // Step 3 – Extract and translate search query
  const searchTermOriginal = extractSearchParam(parsedUrl);

  if (searchTermOriginal.length > 0 && searchTermOriginal.length > config.maxSearchLength) {
    throw new UrlValidationError(
      `search parameter exceeds maximum length of ${config.maxSearchLength} characters`,
    );
  }

  let searchTermTranslated = searchTermOriginal;

  try {
    if (searchTermOriginal) {
      searchTermTranslated = await translateQueryToEnglish(searchTermOriginal, lang, requestId);
      incCounter('translation_requests_total', { lang, result: 'query' });
    }
  } catch (err) {
    logger.warn({ requestId, err: String(err) }, 'Query translation failed – using original term');
    searchTermTranslated = searchTermOriginal;
  }

  // Step 4 – Forward request to YMove with translated query
  const forwardUrl = searchTermTranslated !== searchTermOriginal
    ? replaceSearchParam(parsedUrl, searchTermTranslated)
    : dto.request.url;

  const ymoveResponse = await forwardToYMove(
    forwardUrl,
    dto.request.method,
    requestId,
  );
  incCounter('upstream_requests_total', { status: 'success' });

  // Step 5 – Translate response exercises
  const { exercises: translatedExercises, stats } = await translateExercises(
    ymoveResponse.exercises,
    lang,
    requestId,
  );

  const durationMs = Date.now() - startMs;

  const metrics: RequestMetrics = {
    requestId,
    userLang: lang,
    searchTermOriginal,
    searchTermTranslated,
    cacheHits: stats.cacheHits,
    cacheMisses: stats.cacheMisses,
    translationCalls: stats.translationCalls,
    translatedCharacters: stats.translatedCharacters,
    durationMs,
  };

  incCounter('requests_total', { lang, status: 'success' });
  incCounter('cache_hits_total', { lang }, stats.cacheHits);
  incCounter('cache_misses_total', { lang }, stats.cacheMisses);
  if (stats.translationCalls > 0) {
    incCounter('translation_requests_total', { lang, result: 'exercise' }, stats.translationCalls);
  }

  logger.info(metrics, 'Proxy request completed');

  return {
    response: {
      page: ymoveResponse.page,
      pageSize: ymoveResponse.pageSize,
      total: ymoveResponse.total,
      exercises: translatedExercises,
    },
    metrics,
  };
}
