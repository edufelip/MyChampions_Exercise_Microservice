import { config } from '../../config';
import * as repo from '../../infrastructure/catalog-repository';
import * as ymoveClient from '../../infrastructure/ymove-client';
import { logger } from '../../logger';
import * as metrics from '../../observability/metrics';
import * as catalogService from '../../services/catalog.service';
import { startCatalogSyncScheduler, stopCatalogSyncScheduler } from '../../services/catalog-sync-scheduler';

jest.mock('../../config', () => ({
  config: {
    catalogEnabled: true,
    catalogSyncOnStartup: true,
    catalogSyncBackgroundIntervalMs: 900000,
    catalogStartupSyncCooldownMs: 15552000000,
    allowedUpstreamHost: 'exercise-api.ymove.app',
    allowedUpstreamPath: '/api/v2/exercises',
  },
}));

jest.mock('../../infrastructure/catalog-repository', () => ({
  acquireStartupSyncFlightLock: jest.fn(),
  getStartupSyncCooldownAt: jest.fn(),
  releaseStartupSyncFlightLock: jest.fn(),
  setStartupSyncCooldownAt: jest.fn(),
}));

jest.mock('../../infrastructure/ymove-client', () => ({
  forwardToYMove: jest.fn(),
}));

jest.mock('../../observability/metrics', () => ({
  incCounter: jest.fn(),
}));

jest.mock('../../services/catalog.service', () => ({
  ensureCatalogSynced: jest.fn(),
}));

jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe('catalog-sync-scheduler startup guardrails', () => {
  const mockedRepo = repo as jest.Mocked<typeof repo>;
  const mockedYMove = ymoveClient as jest.Mocked<typeof ymoveClient>;
  const mockedMetrics = metrics as jest.Mocked<typeof metrics>;
  const mockedCatalogService = catalogService as jest.Mocked<typeof catalogService>;
  const mockedLogger = logger as jest.Mocked<typeof logger>;

  let setIntervalSpy: jest.SpyInstance;
  const intervalHandle = { unref: jest.fn() } as unknown as NodeJS.Timeout;

  beforeEach(() => {
    jest.clearAllMocks();
    (config as { catalogSyncOnStartup: boolean }).catalogSyncOnStartup = true;

    setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue(intervalHandle);
  });

  afterEach(() => {
    stopCatalogSyncScheduler();
    setIntervalSpy.mockRestore();
  });

  it('probes health first and then skips due startup cooldown marker', async () => {
    mockedRepo.getStartupSyncCooldownAt.mockResolvedValue(Date.now());
    mockedYMove.forwardToYMove.mockResolvedValue({
      page: 1,
      pageSize: 1,
      total: 0,
      exercises: [],
    });

    startCatalogSyncScheduler();
    await flushAsyncWork();

    expect(mockedYMove.forwardToYMove).toHaveBeenCalledTimes(1);
    expect(mockedRepo.acquireStartupSyncFlightLock).not.toHaveBeenCalled();
    expect(mockedCatalogService.ensureCatalogSynced).not.toHaveBeenCalled();
    expect(mockedMetrics.incCounter).toHaveBeenCalledWith('catalog_sync_runs_total', {
      status: 'startup_skipped_cooldown',
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ cooldownMs: config.catalogStartupSyncCooldownMs }),
      'Skipping startup catalog sync due to cooldown lock',
    );
  });

  it('skips startup sync when health probe fails', async () => {
    mockedYMove.forwardToYMove.mockRejectedValue(new Error('upstream unavailable'));

    startCatalogSyncScheduler();
    await flushAsyncWork();

    expect(mockedYMove.forwardToYMove).toHaveBeenCalledTimes(1);
    expect(mockedRepo.getStartupSyncCooldownAt).not.toHaveBeenCalled();
    expect(mockedRepo.acquireStartupSyncFlightLock).not.toHaveBeenCalled();
    expect(mockedCatalogService.ensureCatalogSynced).not.toHaveBeenCalled();
    expect(mockedMetrics.incCounter).toHaveBeenCalledWith('catalog_sync_runs_total', {
      status: 'startup_skipped_unhealthy',
    });
  });

  it('skips startup sync when an in-flight startup sync lock is already held', async () => {
    mockedYMove.forwardToYMove.mockResolvedValue({
      page: 1,
      pageSize: 1,
      total: 0,
      exercises: [],
    });
    mockedRepo.getStartupSyncCooldownAt.mockResolvedValue(null);
    mockedRepo.acquireStartupSyncFlightLock.mockResolvedValue(false);

    startCatalogSyncScheduler();
    await flushAsyncWork();

    expect(mockedYMove.forwardToYMove).toHaveBeenCalledTimes(1);
    expect(mockedRepo.acquireStartupSyncFlightLock).toHaveBeenCalledTimes(1);
    expect(mockedCatalogService.ensureCatalogSynced).not.toHaveBeenCalled();
    expect(mockedMetrics.incCounter).toHaveBeenCalledWith('catalog_sync_runs_total', {
      status: 'startup_skipped_inflight',
    });
  });

  it('runs startup sync and sets cooldown marker when sync completes', async () => {
    mockedYMove.forwardToYMove.mockResolvedValue({
      page: 1,
      pageSize: 1,
      total: 0,
      exercises: [],
    });
    mockedRepo.getStartupSyncCooldownAt.mockResolvedValue(null);
    mockedRepo.acquireStartupSyncFlightLock.mockResolvedValue(true);
    mockedCatalogService.ensureCatalogSynced.mockResolvedValue('synced');

    startCatalogSyncScheduler();
    await flushAsyncWork();

    expect(mockedCatalogService.ensureCatalogSynced).toHaveBeenCalledTimes(1);
    expect(mockedRepo.setStartupSyncCooldownAt).toHaveBeenCalledTimes(1);
    expect(mockedRepo.releaseStartupSyncFlightLock).toHaveBeenCalledTimes(1);
  });

  it('does not set cooldown marker when stale data is served after sync failure', async () => {
    mockedYMove.forwardToYMove.mockResolvedValue({
      page: 1,
      pageSize: 1,
      total: 0,
      exercises: [],
    });
    mockedRepo.getStartupSyncCooldownAt.mockResolvedValue(null);
    mockedRepo.acquireStartupSyncFlightLock.mockResolvedValue(true);
    mockedCatalogService.ensureCatalogSynced.mockResolvedValue('stale_served');

    startCatalogSyncScheduler();
    await flushAsyncWork();

    expect(mockedRepo.setStartupSyncCooldownAt).not.toHaveBeenCalled();
    expect(mockedRepo.releaseStartupSyncFlightLock).toHaveBeenCalledTimes(1);
  });

  it('does not trigger startup run when startup sync flag is disabled', async () => {
    (config as { catalogSyncOnStartup: boolean }).catalogSyncOnStartup = false;

    startCatalogSyncScheduler();
    await flushAsyncWork();

    expect(mockedYMove.forwardToYMove).not.toHaveBeenCalled();
    expect(mockedCatalogService.ensureCatalogSynced).not.toHaveBeenCalled();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
