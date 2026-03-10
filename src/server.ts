/**
 * Express application factory.
 *
 * Wires together middleware, routes, and error handlers. Exported as a
 * factory function so integration tests can create a fresh instance.
 */
import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { config } from './config';
import { logger } from './logger';
import { validateProxyBody } from './middleware/request-validator';
import { proxyController } from './controllers/proxy.controller';
import { renderPrometheusMetrics } from './observability/metrics';

export function createApp(): express.Application {
  const app = express();
  app.set('trust proxy', config.trustProxyHops);

  // ─── Middleware ────────────────────────────────────────────────────────────

  app.use(express.json({ limit: '10kb' }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = req.header('x-request-id')?.trim() || randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });

  // Request logger
  app.use((req: Request, res: Response, next: NextFunction) => {
    logger.info(
      { requestId: res.locals.requestId, method: req.method, url: req.url, ip: req.ip },
      'Incoming request',
    );
    next();
  });

  // Rate limiting (per IP)
  app.use(
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: (_req: Request, res: Response) => ({
        error: {
          code: 'too_many_requests',
          message: 'Rate limit exceeded. Please slow down.',
          status: 429,
          requestId: (res.locals.requestId as string) ?? 'unknown',
        },
      }),
    }),
  );

  // ─── Routes ────────────────────────────────────────────────────────────────

  /** Health check */
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'exercise-microservice',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /proxy
   * Accepts a language and a YMove API request, translates the search query,
   * forwards to YMove, translates the response, and returns it to the client.
   */
  app.post('/proxy', validateProxyBody, proxyController);

  app.get('/metrics', (_req: Request, res: Response) => {
    res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(renderPrometheusMetrics());
  });

  // ─── 404 ───────────────────────────────────────────────────────────────────

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'not_found',
        message: 'Endpoint not found',
        status: 404,
        requestId: (res.locals.requestId as string) ?? 'unknown',
      },
    });
  });

  // ─── Global error handler ──────────────────────────────────────────────────

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ requestId: res.locals.requestId, errorName: err.name }, 'Unhandled error');
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred',
        status: 500,
        requestId: (res.locals.requestId as string) ?? 'unknown',
      },
    });
  });

  return app;
}
