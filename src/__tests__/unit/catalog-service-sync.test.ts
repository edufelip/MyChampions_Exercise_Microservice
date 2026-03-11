import { CatalogError, ensureCatalogSynced } from '../../services/catalog.service';
import * as repo from '../../infrastructure/catalog-repository';
import * as ymoveClient from '../../infrastructure/ymove-client';

jest.mock('../../infrastructure/catalog-repository', () => ({
  addTokenPrefixToDictionary: jest.fn(),
  addTokenToDictionary: jest.fn(),
  clearCatalog: jest.fn(),
  createCatalogVersion: jest.fn(),
  getActiveCatalogVersion: jest.fn(),
  getCatalogDocument: jest.fn(),
  getCatalogDocumentIds: jest.fn(),
  getCatalogDocuments: jest.fn(),
  getCatalogLanguages: jest.fn(() => ['en', 'pt', 'es', 'fr', 'it']),
  getCatalogMetadata: jest.fn(),
  getIdsByExactToken: jest.fn(),
  getIdsByPrefix: jest.fn(),
  getLocalizationStatus: jest.fn(),
  getPopularExerciseIds: jest.fn(),
  getPopularityScores: jest.fn(),
  getSynonymTargets: jest.fn(),
  getTokensByPrefix: jest.fn(),
  incrementPopularity: jest.fn(),
  listCatalogVersions: jest.fn(),
  registerSynonym: jest.fn(),
  saveCatalogDocument: jest.fn(),
  setActiveCatalogVersion: jest.fn(),
  setCatalogMetadata: jest.fn(),
  setLocalizationStatus: jest.fn(),
  upsertExactIndex: jest.fn(),
  upsertIndexPrefix: jest.fn(),
}));

jest.mock('../../infrastructure/ymove-client', () => ({
  forwardToYMove: jest.fn(),
}));

describe('ensureCatalogSynced fail-open behavior', () => {
  const mockedRepo = repo as jest.Mocked<typeof repo>;
  const mockedYMove = ymoveClient as jest.Mocked<typeof ymoveClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockedRepo.createCatalogVersion.mockResolvedValue('v2');
    mockedRepo.registerSynonym.mockResolvedValue();
    mockedRepo.clearCatalog.mockResolvedValue();
    mockedRepo.listCatalogVersions.mockResolvedValue(['v2']);
    mockedRepo.setCatalogMetadata.mockResolvedValue();
    mockedRepo.setActiveCatalogVersion.mockResolvedValue();
    mockedRepo.saveCatalogDocument.mockResolvedValue();
    mockedRepo.setLocalizationStatus.mockResolvedValue();
    mockedRepo.addTokenToDictionary.mockResolvedValue();
    mockedRepo.addTokenPrefixToDictionary.mockResolvedValue();
    mockedRepo.upsertExactIndex.mockResolvedValue();
    mockedRepo.upsertIndexPrefix.mockResolvedValue();
  });

  it('does not throw when sync fails but active catalog data already exists', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue('v1');
    mockedRepo.getCatalogMetadata.mockResolvedValue({
      lastSyncedAt: '2020-01-01T00:00:00.000Z',
      exerciseCount: 10,
    });
    mockedYMove.forwardToYMove.mockRejectedValue(new Error('upstream down'));

    await expect(ensureCatalogSynced('req-1')).resolves.toBeUndefined();
  });

  it('throws when sync fails and there is no existing active catalog dataset', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue(null);
    mockedRepo.getCatalogMetadata.mockResolvedValue(null);
    mockedYMove.forwardToYMove.mockRejectedValue(new Error('upstream down'));

    await expect(ensureCatalogSynced('req-2')).rejects.toBeInstanceOf(CatalogError);
  });

  it('deduplicates repeated exercise ids during sync ingestion', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue(null);
    mockedRepo.getCatalogMetadata.mockResolvedValue(null);
    mockedYMove.forwardToYMove.mockResolvedValue({
      page: 1,
      pageSize: 2,
      total: 1,
      exercises: [
        {
          id: 'dup-1',
          title: 'Bench Press',
          slug: 'bench-press',
          description: 'desc',
          instructions: ['step'],
          importantPoints: ['point'],
          muscleGroup: 'chest',
          secondaryMuscles: null,
          equipment: 'barbell',
          category: 'strength',
          difficulty: 'intermediate',
          videoDurationSecs: null,
          hasVideo: true,
          hasVideoWhite: false,
          hasVideoGym: true,
          exerciseType: ['strength'],
          videoUrl: null,
          videoHlsUrl: null,
          thumbnailUrl: null,
          videos: null,
        },
        {
          id: 'dup-1',
          title: 'Bench Press Duplicate',
          slug: 'bench-press-dup',
          description: 'desc',
          instructions: ['step'],
          importantPoints: ['point'],
          muscleGroup: 'chest',
          secondaryMuscles: null,
          equipment: 'barbell',
          category: 'strength',
          difficulty: 'intermediate',
          videoDurationSecs: null,
          hasVideo: true,
          hasVideoWhite: false,
          hasVideoGym: true,
          exerciseType: ['strength'],
          videoUrl: null,
          videoHlsUrl: null,
          thumbnailUrl: null,
          videos: null,
        },
      ],
    });

    await expect(ensureCatalogSynced('req-3')).resolves.toBeUndefined();
    expect(mockedRepo.saveCatalogDocument).toHaveBeenCalledTimes(1);
    expect(mockedRepo.setCatalogMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseCount: 1 }),
      'v2',
    );
  });
});
