import { Request, Response } from 'express';

/**
 * Legacy endpoint hard-stop.
 * Mobile clients must migrate to POST /catalog/search.
 */
export async function proxyDeprecatedController(_req: Request, res: Response): Promise<void> {
  const requestId = (res.locals.requestId as string) ?? 'unknown';

  res.status(410).json({
    error: {
      code: 'legacy_proxy_removed',
      message: 'POST /proxy has been removed. Use POST /catalog/search instead.',
      status: 410,
      requestId,
      details: {
        replacement: '/catalog/search',
      },
    },
  });
}
