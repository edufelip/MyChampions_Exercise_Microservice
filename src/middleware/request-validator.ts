/**
 * Request body validation middleware for POST /proxy.
 *
 * Validates:
 * - `lang`:              optional string (defaults to "en")
 * - `request`:           required object
 * - `request.url`:       non-empty string
 * - `request.method`:    non-empty string (currently only GET supported)
 * - `request.headers`:   object (optional)
 */
import { Request, Response, NextFunction } from 'express';
import { RequestDTO } from '../domain/dtos';

const ALLOWED_METHODS = new Set(['GET']);
const ALLOWED_HEADER_NAMES = new Set(['accept']);
const MAX_BODY_BYTES = 10 * 1024;

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

export function validateProxyBody(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = (res.locals?.requestId as string) ?? 'unknown';

  const rawBodyLength = Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8');
  if (rawBodyLength > MAX_BODY_BYTES) {
    badRequest(res, requestId, '`request` body exceeds 10kb limit');
    return;
  }

  const body = req.body as Partial<RequestDTO>;

  // Validate `request` object
  if (!body.request || typeof body.request !== 'object') {
    badRequest(res, requestId, '`request` must be an object');
    return;
  }

  const { url, method, headers } = body.request;

  if (typeof url !== 'string' || url.trim().length === 0) {
    badRequest(res, requestId, '`request.url` must be a non-empty string');
    return;
  }

  if (typeof method !== 'string' || method.trim().length === 0) {
    badRequest(res, requestId, '`request.method` must be a non-empty string');
    return;
  }

  if (!ALLOWED_METHODS.has(method.trim().toUpperCase())) {
    badRequest(
      res,
      requestId,
      `HTTP method "${method}" is not supported. Allowed: ${[...ALLOWED_METHODS].join(', ')}`,
    );
    return;
  }

  if (headers !== undefined && (typeof headers !== 'object' || Array.isArray(headers))) {
    badRequest(res, requestId, '`request.headers` must be an object');
    return;
  }

  if (typeof body.lang !== 'undefined' && typeof body.lang !== 'string') {
    badRequest(res, requestId, '`lang` must be a string');
    return;
  }

  const sanitizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value !== 'string') {
      badRequest(res, requestId, `Header "${key}" must be a string`);
      return;
    }

    const normalizedKey = key.trim().toLowerCase();
    if (!ALLOWED_HEADER_NAMES.has(normalizedKey)) {
      badRequest(res, requestId, `Header "${key}" is not allowed`);
      return;
    }

    sanitizedHeaders[normalizedKey] = value.trim();
  }

  // Sanitise
  req.body = {
    lang: typeof body.lang === 'string' ? body.lang : '',
    request: {
      url: url.trim(),
      method: method.trim().toUpperCase(),
      headers: sanitizedHeaders,
    },
  } satisfies RequestDTO;

  next();
}
