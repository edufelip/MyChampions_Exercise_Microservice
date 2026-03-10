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

export function validateProxyBody(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const body = req.body as Partial<RequestDTO>;

  // Validate `request` object
  if (!body.request || typeof body.request !== 'object') {
    res.status(400).json({
      error: 'bad_request',
      message: '`request` must be an object',
    });
    return;
  }

  const { url, method, headers } = body.request;

  if (typeof url !== 'string' || url.trim().length === 0) {
    res.status(400).json({
      error: 'bad_request',
      message: '`request.url` must be a non-empty string',
    });
    return;
  }

  if (typeof method !== 'string' || method.trim().length === 0) {
    res.status(400).json({
      error: 'bad_request',
      message: '`request.method` must be a non-empty string',
    });
    return;
  }

  if (!ALLOWED_METHODS.has(method.trim().toUpperCase())) {
    res.status(400).json({
      error: 'bad_request',
      message: `HTTP method "${method}" is not supported. Allowed: ${[...ALLOWED_METHODS].join(', ')}`,
    });
    return;
  }

  if (headers !== undefined && (typeof headers !== 'object' || Array.isArray(headers))) {
    res.status(400).json({
      error: 'bad_request',
      message: '`request.headers` must be an object',
    });
    return;
  }

  // Sanitise
  req.body = {
    lang: typeof body.lang === 'string' ? body.lang : '',
    request: {
      url: url.trim(),
      method: method.trim().toUpperCase(),
      headers: headers ?? {},
    },
  } satisfies RequestDTO;

  next();
}
