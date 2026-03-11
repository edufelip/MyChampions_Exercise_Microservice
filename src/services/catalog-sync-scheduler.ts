import { randomUUID } from 'crypto';
import { config } from '../config';
import { logger } from '../logger';
import { ensureCatalogSynced } from './catalog.service';

let timer: NodeJS.Timeout | null = null;

async function runSync(trigger: 'startup' | 'interval'): Promise<void> {
  const requestId = randomUUID();
  try {
    await ensureCatalogSynced(requestId);
    logger.info({ requestId, trigger }, 'Catalog sync check completed');
  } catch (err) {
    logger.warn({ requestId, trigger, err: String(err) }, 'Catalog sync check failed');
  }
}

export function startCatalogSyncScheduler(): void {
  if (!config.catalogEnabled) {
    return;
  }

  if (config.catalogSyncOnStartup) {
    void runSync('startup');
  }

  if (timer) {
    return;
  }

  timer = setInterval(() => {
    void runSync('interval');
  }, config.catalogSyncBackgroundIntervalMs);

  timer.unref();
  logger.info({ everyMs: config.catalogSyncBackgroundIntervalMs }, 'Catalog sync scheduler started');
}

export function stopCatalogSyncScheduler(): void {
  if (!timer) {
    return;
  }

  clearInterval(timer);
  timer = null;
}
