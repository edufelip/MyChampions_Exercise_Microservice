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
import { RequestDTO, TranslatedExerciseListResponse, RequestMetrics } from '../domain/dtos';
import { normalizeLanguage } from './lang-normalizer';
import { validateUpstreamUrl, extractSearchParam, replaceSearchParam } from './url-validator';
import { translateQueryToEnglish, translateExercises } from './translation.service';
import { forwardToYMove, YMoveError } from '../infrastructure/ymove-client';
import { logger } from '../logger';

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
  let searchTermTranslated = searchTermOriginal;

  try {
    if (searchTermOriginal) {
      searchTermTranslated = await translateQueryToEnglish(searchTermOriginal, lang);
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
    dto.request.headers,
  );

  // Step 5 – Translate response exercises
  const { exercises: translatedExercises, stats } = await translateExercises(
    ymoveResponse.exercises,
    lang,
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
    durationMs,
  };

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
