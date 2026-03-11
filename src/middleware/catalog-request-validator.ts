import { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { CatalogSearchRequestDTO } from '../domain/dtos';
import { config } from '../config';

const MAX_BODY_BYTES = 10 * 1024;
const MAX_QUERY_LENGTH = 256;

function badRequest(res: Response, requestId: string, message: string): void {
  res.status(400).json({
    error: {
      code: 'bad_request',
      message,
      status: 400,
      requestId,
    },
  });
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return Number.NaN;
}

export function validateCatalogSearchBody(req: Request, res: Response, next: NextFunction): void {
  const requestId = (res.locals?.requestId as string) ?? 'unknown';
  const rawBodyLength = Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8');

  if (rawBodyLength > MAX_BODY_BYTES) {
    badRequest(res, requestId, '`request` body exceeds 10kb limit');
    return;
  }

  const body = (req.body ?? {}) as CatalogSearchRequestDTO;

  if (typeof body.lang !== 'undefined' && typeof body.lang !== 'string') {
    badRequest(res, requestId, '`lang` must be a string');
    return;
  }

  if (typeof body.query !== 'undefined' && typeof body.query !== 'string') {
    badRequest(res, requestId, '`query` must be a string');
    return;
  }

  if ((body.query ?? '').length > MAX_QUERY_LENGTH) {
    badRequest(res, requestId, '`query` exceeds 256 characters');
    return;
  }

  const page = parseOptionalNumber(body.page);
  if (Number.isNaN(page)) {
    badRequest(res, requestId, '`page` must be a number');
    return;
  }

  const pageSize = parseOptionalNumber(body.pageSize);
  if (Number.isNaN(pageSize)) {
    badRequest(res, requestId, '`pageSize` must be a number');
    return;
  }

  req.body = {
    lang: typeof body.lang === 'string' ? body.lang.trim() : '',
    query: typeof body.query === 'string' ? body.query.trim() : '',
    page,
    pageSize,
  } satisfies CatalogSearchRequestDTO;

  next();
}

interface ReviewBody {
  exerciseId?: string;
  lang?: string;
  status?: string;
  title?: string;
  description?: string;
  instructions?: string[];
  importantPoints?: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function validateCatalogReviewBody(req: Request, res: Response, next: NextFunction): void {
  const requestId = (res.locals?.requestId as string) ?? 'unknown';
  const body = (req.body ?? {}) as ReviewBody;

  if (typeof body.exerciseId !== 'string' || body.exerciseId.trim().length === 0) {
    badRequest(res, requestId, '`exerciseId` must be a non-empty string');
    return;
  }

  if (typeof body.lang !== 'string' || body.lang.trim().length === 0) {
    badRequest(res, requestId, '`lang` must be a non-empty string');
    return;
  }

  if (body.status !== 'reviewed' && body.status !== 'rejected') {
    badRequest(res, requestId, '`status` must be either "reviewed" or "rejected"');
    return;
  }

  if (typeof body.title !== 'undefined' && typeof body.title !== 'string') {
    badRequest(res, requestId, '`title` must be a string');
    return;
  }

  if (typeof body.description !== 'undefined' && typeof body.description !== 'string') {
    badRequest(res, requestId, '`description` must be a string');
    return;
  }

  if (typeof body.instructions !== 'undefined' && !isStringArray(body.instructions)) {
    badRequest(res, requestId, '`instructions` must be an array of strings');
    return;
  }

  if (typeof body.importantPoints !== 'undefined' && !isStringArray(body.importantPoints)) {
    badRequest(res, requestId, '`importantPoints` must be an array of strings');
    return;
  }

  req.body = {
    exerciseId: body.exerciseId.trim(),
    lang: body.lang.trim(),
    status: body.status,
    title: typeof body.title === 'string' ? body.title.trim() : undefined,
    description: typeof body.description === 'string' ? body.description.trim() : undefined,
    instructions: body.instructions,
    importantPoints: body.importantPoints,
  };

  next();
}

interface BenchmarkBody {
  lang?: string;
  queries?: unknown;
  pageSize?: number | string;
}

export function validateCatalogBenchmarkBody(req: Request, res: Response, next: NextFunction): void {
  const requestId = (res.locals?.requestId as string) ?? 'unknown';
  const body = (req.body ?? {}) as BenchmarkBody;

  if (typeof body.lang !== 'undefined' && typeof body.lang !== 'string') {
    badRequest(res, requestId, '`lang` must be a string');
    return;
  }

  if (!Array.isArray(body.queries) || body.queries.some((entry) => typeof entry !== 'string')) {
    badRequest(res, requestId, '`queries` must be an array of strings');
    return;
  }

  const pageSize = parseOptionalNumber(body.pageSize);
  if (Number.isNaN(pageSize)) {
    badRequest(res, requestId, '`pageSize` must be a number');
    return;
  }

  req.body = {
    lang: typeof body.lang === 'string' ? body.lang.trim() : '',
    queries: body.queries.map((query) => query.trim()),
    pageSize,
  };

  next();
}

function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function validateCatalogReviewAuth(req: Request, res: Response, next: NextFunction): void {
  const requestId = (res.locals?.requestId as string) ?? 'unknown';
  const expected = config.catalogReviewApiKey;

  if (!expected) {
    res.status(503).json({
      error: {
        code: 'catalog_review_disabled',
        message: 'Catalog review endpoint is disabled',
        status: 503,
        requestId,
      },
    });
    return;
  }

  const received = req.header('x-catalog-review-key')?.trim() ?? '';
  if (!received || !safeEquals(received, expected)) {
    res.status(401).json({
      error: {
        code: 'unauthorized',
        message: 'Invalid catalog review credentials',
        status: 401,
        requestId,
      },
    });
    return;
  }

  next();
}
