import { config } from '../config';
import { ExerciseDTO } from '../domain/dtos';
import { logger } from '../logger';
import { incCounter } from '../observability/metrics';
import { searchCatalog } from './catalog.service';

export async function runCatalogShadowComparison(
  lang: string,
  query: string,
  upstreamExercises: ExerciseDTO[],
  requestId: string,
): Promise<void> {
  if (!config.catalogShadowValidationEnabled) {
    return;
  }

  if (!query || upstreamExercises.length === 0) {
    return;
  }

  if (Math.random() > config.catalogShadowSampleRate) {
    return;
  }

  const upstreamTopIds = upstreamExercises.slice(0, 10).map((item) => item.id);

  try {
    const catalogResponse = await searchCatalog(
      {
        lang,
        query,
        page: 1,
        pageSize: 10,
      },
      requestId,
    );

    const catalogTopIds = catalogResponse.results.slice(0, 10).map((item) => item.id);
    const overlap = upstreamTopIds.filter((id) => catalogTopIds.includes(id)).length;
    const overlapRate = upstreamTopIds.length === 0 ? 0 : overlap / upstreamTopIds.length;

    let bucket = 'low';
    if (overlapRate >= 0.75) {
      bucket = 'high';
    } else if (overlapRate >= 0.4) {
      bucket = 'mid';
    }

    incCounter('catalog_shadow_checks_total', { lang, status: bucket });

    logger.info(
      {
        requestId,
        lang,
        query,
        upstreamTopIds,
        catalogTopIds,
        overlap,
        overlapRate,
      },
      'Catalog shadow comparison completed',
    );
  } catch (err) {
    incCounter('catalog_shadow_checks_total', { lang, status: 'error' });
    logger.warn({ requestId, lang, query, err: String(err) }, 'Catalog shadow comparison failed');
  }
}
