import { randomUUID } from 'crypto';
import { config } from '../config';
import {
  acquireStartupSyncFlightLock,
  getStartupSyncCooldownAt,
  releaseStartupSyncFlightLock,
  setStartupSyncCooldownAt,
} from '../infrastructure/catalog-repository';
import { forwardToYMove } from '../infrastructure/ymove-client';
import { logger } from '../logger';
import { incCounter } from '../observability/metrics';
import { ensureCatalogSynced } from './catalog.service';

let timer: NodeJS.Timeout | null = null;
const STARTUP_SYNC_FLIGHT_LOCK_TTL_MS = 10 * 60 * 1000;

function buildHealthProbeUrl(): string {
  const url = new URL(`https://${config.allowedUpstreamHost}${config.allowedUpstreamPath}`);
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', '1');
  return url.toString();
}

async function canRunStartupSync(requestId: string): Promise<string | null> {
  const probeStartMs = Date.now();
  try {
    await forwardToYMove(buildHealthProbeUrl(), 'GET', requestId);
  } catch (err) {
    incCounter('catalog_sync_runs_total', { status: 'startup_skipped_unhealthy' });
    logger.warn(
      { requestId, err: String(err), probeDurationMs: Date.now() - probeStartMs },
      'Skipping startup catalog sync because upstream health probe failed',
    );
    return null;
  }

  const cooldownAt = await getStartupSyncCooldownAt();
  if (cooldownAt !== null) {
    incCounter('catalog_sync_runs_total', { status: 'startup_skipped_cooldown' });
    logger.info(
      { requestId, cooldownMs: config.catalogStartupSyncCooldownMs, cooldownAt },
      'Skipping startup catalog sync due to cooldown lock',
    );
    return null;
  }

  const flightToken = randomUUID();
  const acquiredFlightLock = await acquireStartupSyncFlightLock(flightToken, STARTUP_SYNC_FLIGHT_LOCK_TTL_MS);
  if (!acquiredFlightLock) {
    incCounter('catalog_sync_runs_total', { status: 'startup_skipped_inflight' });
    logger.info({ requestId }, 'Skipping startup catalog sync because another startup sync is in progress');
    return null;
  }

  const cooldownAfterLock = await getStartupSyncCooldownAt();
  if (cooldownAfterLock !== null) {
    await releaseStartupSyncFlightLock(flightToken);
    incCounter('catalog_sync_runs_total', { status: 'startup_skipped_cooldown' });
    logger.info(
      { requestId, cooldownMs: config.catalogStartupSyncCooldownMs, cooldownAt: cooldownAfterLock },
      'Skipping startup catalog sync due to cooldown lock',
    );
    return null;
  }

  return flightToken;
}

async function runSync(trigger: 'startup' | 'interval'): Promise<void> {
  const requestId = randomUUID();
  let startupFlightToken: string | null = null;

  if (trigger === 'startup') {
    startupFlightToken = await canRunStartupSync(requestId);
    if (!startupFlightToken) {
      return;
    }
  }

  try {
    const result = await ensureCatalogSynced(requestId);

    if (trigger === 'startup' && result !== 'stale_served') {
      await setStartupSyncCooldownAt(Date.now(), config.catalogStartupSyncCooldownMs);
    }

    logger.info({ requestId, trigger }, 'Catalog sync check completed');
  } catch (err) {
    logger.warn({ requestId, trigger, err: String(err) }, 'Catalog sync check failed');
  } finally {
    if (startupFlightToken) {
      await releaseStartupSyncFlightLock(startupFlightToken);
    }
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
