import { Request, Response } from 'express';
import { CatalogBenchmarkRequestDTO } from '../domain/dtos';
import {
  CatalogError,
  getCatalogHealth,
  reviewCatalogLocalization,
  ReviewInput,
  SearchInput,
  searchCatalog,
} from '../services/catalog.service';
import { CatalogBenchmarkError, runCatalogProviderBenchmark } from '../services/provider-benchmark.service';
import { logger } from '../logger';
import { incCounter } from '../observability/metrics';

function getRequestId(res: Response): string {
  return (res.locals.requestId as string) ?? 'unknown';
}

function errorBody(
  requestId: string,
  status: number,
  code: string,
  message: string,
): Record<string, unknown> {
  return {
    error: {
      code,
      message,
      status,
      requestId,
    },
  };
}

export async function searchCatalogController(req: Request, res: Response): Promise<void> {
  const requestId = getRequestId(res);

  try {
    const response = await searchCatalog(req.body as SearchInput, requestId);
    res.status(200).json(response);
  } catch (err) {
    if (err instanceof CatalogError) {
      logger.warn({ requestId, err: err.message, code: err.code }, 'Catalog search failed');
      incCounter('catalog_search_requests_total', { status: 'error' });
      res.status(err.statusCode).json(errorBody(requestId, err.statusCode, err.code, err.message));
      return;
    }

    logger.error({ requestId, err: String(err) }, 'Unexpected error on catalog search');
    incCounter('catalog_search_requests_total', { status: 'internal_error' });
    res.status(500).json(errorBody(requestId, 500, 'internal_error', 'An unexpected error occurred'));
  }
}

export async function catalogHealthController(_req: Request, res: Response): Promise<void> {
  const requestId = getRequestId(res);

  try {
    const health = await getCatalogHealth(requestId);
    res.status(200).json(health);
  } catch (err) {
    logger.error({ requestId, err: String(err) }, 'Unexpected error on catalog health');
    res.status(500).json(errorBody(requestId, 500, 'internal_error', 'An unexpected error occurred'));
  }
}

export async function reviewCatalogController(req: Request, res: Response): Promise<void> {
  const requestId = getRequestId(res);

  try {
    await reviewCatalogLocalization(req.body as ReviewInput);
    res.status(204).send();
  } catch (err) {
    if (err instanceof CatalogError) {
      logger.warn({ requestId, err: err.message, code: err.code }, 'Catalog review update failed');
      res.status(err.statusCode).json(errorBody(requestId, err.statusCode, err.code, err.message));
      return;
    }

    logger.error({ requestId, err: String(err) }, 'Unexpected error on catalog review update');
    res.status(500).json(errorBody(requestId, 500, 'internal_error', 'An unexpected error occurred'));
  }
}

export async function catalogBenchmarkController(req: Request, res: Response): Promise<void> {
  const requestId = getRequestId(res);

  try {
    const response = await runCatalogProviderBenchmark(req.body as CatalogBenchmarkRequestDTO);
    res.status(200).json(response);
  } catch (err) {
    if (err instanceof CatalogBenchmarkError) {
      logger.warn({ requestId, err: err.message }, 'Catalog benchmark failed');
      res.status(err.statusCode).json(errorBody(requestId, err.statusCode, err.code, err.message));
      return;
    }

    logger.error({ requestId, err: String(err) }, 'Unexpected error on catalog benchmark');
    res.status(500).json(errorBody(requestId, 500, 'internal_error', 'An unexpected error occurred'));
  }
}
