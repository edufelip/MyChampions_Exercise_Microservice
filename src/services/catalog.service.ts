import { config } from '../config';
import {
  CatalogExerciseDTO,
  CatalogExerciseDocumentDTO,
  CatalogSearchResponseDTO,
  ExerciseDTO,
  LocalizedExerciseFieldsDTO,
  LocalizationStatus,
} from '../domain/dtos';
import {
  addTokenPrefixToDictionary,
  addTokenToDictionary,
  clearCatalog,
  getCatalogDocument,
  getCatalogDocumentIds,
  getCatalogDocuments,
  getCatalogLanguages,
  getCatalogMetadata,
  getActiveCatalogVersion,
  getIdsByExactToken,
  getIdsByPrefix,
  listCatalogVersions,
  getLocalizationStatus,
  getPopularExerciseIds,
  getPopularityScores,
  getSynonymTargets,
  getTokensByPrefix,
  incrementPopularity,
  createCatalogVersion,
  registerSynonym,
  saveCatalogDocument,
  setActiveCatalogVersion,
  setCatalogMetadata,
  setLocalizationStatus,
  upsertExactIndex,
  upsertIndexPrefix,
} from '../infrastructure/catalog-repository';
import { forwardToYMove } from '../infrastructure/ymove-client';
import { translateTexts } from '../infrastructure/translate-client';
import { logger } from '../logger';
import { incCounter } from '../observability/metrics';
import { normalizeLanguage } from './lang-normalizer';
import {
  buildTokenPrefixes,
  levenshteinDistance,
  normalizeSearchText,
  tokenizeSearchText,
} from './catalog-text';

const SUPPORTED_LANGUAGES = getCatalogLanguages();
const NON_ENGLISH_LANGUAGES = SUPPORTED_LANGUAGES.filter((lang) => lang !== 'en');

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const CANDIDATE_POOL_SIZE = 200;

const BASE_SYNONYMS: Record<string, Record<string, string[]>> = {
  en: {
    glutes: ['glute', 'butt', 'hip'],
    abs: ['ab', 'core', 'abdominal'],
    quads: ['quad', 'quadriceps'],
  },
  pt: {
    gluteo: ['gluteo', 'bumbum', 'quadril'],
    peito: ['peito', 'peitoral'],
    abdominal: ['abdomen', 'abdominal', 'core'],
    agachamento: ['agachamento', 'agachar'],
  },
  es: {
    gluteo: ['gluteo', 'cadera'],
    pecho: ['pecho', 'pectoral'],
    abdominal: ['abdominal', 'core'],
    sentadilla: ['sentadilla', 'sentadillas'],
  },
  fr: {
    fessier: ['fessier', 'hanche'],
    poitrine: ['poitrine', 'pectoral'],
    abdos: ['abdo', 'abdos', 'core'],
    squat: ['squat', 'squats'],
  },
  it: {
    glutei: ['glutei', 'anca'],
    petto: ['petto', 'pettorale'],
    addominali: ['addominali', 'core'],
    squat: ['squat', 'squats'],
  },
};

let activeSyncPromise: Promise<void> | null = null;

function versionRank(version: string): number {
  const match = /^v(\d+)$/.exec(version);
  if (!match) {
    return Number.NaN;
  }
  return Number.parseInt(match[1], 10);
}

function sortVersionsDesc(versions: string[]): string[] {
  return [...versions].sort((a, b) => {
    const aRank = versionRank(a);
    const bRank = versionRank(b);

    if (Number.isNaN(aRank) || Number.isNaN(bRank)) {
      return b.localeCompare(a);
    }

    return bRank - aRank;
  });
}

async function cleanupOldCatalogVersions(activeVersion: string): Promise<void> {
  const versions = sortVersionsDesc(await listCatalogVersions());
  const keep = new Set<string>(versions.slice(0, config.catalogVersionRetention));
  keep.add(activeVersion);

  const stale = versions.filter((version) => !keep.has(version));
  if (stale.length === 0) {
    return;
  }

  await Promise.all(stale.map((version) => clearCatalog(version)));
}

export class CatalogError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly code = 'catalog_error',
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

export interface SearchInput {
  lang?: string;
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface ReviewInput {
  exerciseId: string;
  lang: string;
  status: Extract<LocalizationStatus, 'reviewed' | 'rejected'>;
  title?: string;
  description?: string;
  instructions?: string[];
  importantPoints?: string[];
}

interface CatalogHealthResponse {
  ready: boolean;
  syncedAt: string | null;
  exerciseCount: number;
  stale: boolean;
}

function sanitizePage(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return DEFAULT_PAGE;
  }
  return Math.floor(value);
}

function sanitizePageSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(MAX_PAGE_SIZE, Math.floor(value));
}

function buildYMoveUrl(page: number, pageSize: number): string {
  return `https://${config.allowedUpstreamHost}${config.allowedUpstreamPath}?page=${page}&pageSize=${pageSize}`;
}

function extractLocalizationFromExercise(
  exercise: ExerciseDTO,
  status: LocalizationStatus,
): LocalizedExerciseFieldsDTO {
  return {
    title: exercise.title,
    description: exercise.description,
    instructions: exercise.instructions,
    importantPoints: exercise.importantPoints,
    status,
    updatedAt: new Date().toISOString(),
  };
}

async function localizeExercise(
  exercise: ExerciseDTO,
  lang: string,
  requestId: string,
): Promise<LocalizedExerciseFieldsDTO> {
  const exerciseInstructions = exercise.instructions ?? [];
  const exerciseImportantPoints = exercise.importantPoints ?? [];
  const payload: string[] = [
    exercise.title,
    exercise.description,
    ...exerciseInstructions,
    ...exerciseImportantPoints,
  ];

  if (payload.length === 0) {
    return {
      title: exercise.title,
      description: exercise.description,
      instructions: exerciseInstructions,
      importantPoints: exerciseImportantPoints,
      status: 'machine',
      updatedAt: new Date().toISOString(),
    };
  }

  try {
    const translated = await translateTexts(payload, lang, requestId);
    let cursor = 0;
    const title = translated[cursor++] ?? exercise.title;
    const description = translated[cursor++] ?? exercise.description;
    const instructions = translated.slice(cursor, cursor + exerciseInstructions.length);
    cursor += exerciseInstructions.length;
    const importantPoints = translated.slice(cursor, cursor + exerciseImportantPoints.length);

    return {
      title,
      description,
      instructions,
      importantPoints,
      status: 'machine',
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn({ requestId, lang, exerciseId: exercise.id, err: String(err) }, 'Catalog localization fallback to English');
    return extractLocalizationFromExercise(exercise, 'machine');
  }
}

function collectTokensForLanguage(doc: CatalogExerciseDocumentDTO, lang: string): string[] {
  const localized = doc.localizations[lang] ?? doc.localizations.en;
  const tokenSource = [
    localized.title,
    doc.slug,
    doc.muscleGroup ?? '',
    doc.equipment ?? '',
    doc.category ?? '',
    ...doc.exerciseType,
  ].join(' ');

  return tokenizeSearchText(tokenSource);
}

async function indexExercise(doc: CatalogExerciseDocumentDTO, version: string): Promise<void> {
  for (const lang of SUPPORTED_LANGUAGES) {
    const tokens = collectTokensForLanguage(doc, lang);
    const uniqueTokens = [...new Set(tokens)];

    for (const token of uniqueTokens) {
      await addTokenToDictionary(lang, token, version);
      if (token.length >= 2) {
        await addTokenPrefixToDictionary(lang, token.slice(0, 2), token, version);
      }
      await upsertExactIndex(lang, token, doc.id, 100, version);

      for (const prefix of buildTokenPrefixes(token)) {
        await upsertIndexPrefix(lang, prefix, doc.id, 60, version);
      }
    }
  }
}

async function registerBaseSynonyms(version: string): Promise<void> {
  for (const lang of SUPPORTED_LANGUAGES) {
    const entries = BASE_SYNONYMS[lang] ?? {};
    for (const canonical of Object.keys(entries)) {
      const normalizedCanonical = normalizeSearchText(canonical);
      if (!normalizedCanonical) {
        continue;
      }

      const related = entries[canonical] ?? [];
      for (const synonym of related) {
        const normalizedSynonym = normalizeSearchText(synonym);
        if (!normalizedSynonym) {
          continue;
        }
        await registerSynonym(lang, normalizedSynonym, normalizedCanonical, version);
      }
    }
  }
}

function mapToCatalogExercise(doc: CatalogExerciseDocumentDTO, lang: string): CatalogExerciseDTO {
  const localized = doc.localizations[lang] ?? doc.localizations.en;

  return {
    id: doc.id,
    slug: doc.slug,
    title: localized.title,
    description: localized.description,
    instructions: localized.instructions,
    importantPoints: localized.importantPoints,
    muscleGroup: doc.muscleGroup,
    secondaryMuscles: doc.secondaryMuscles,
    equipment: doc.equipment,
    category: doc.category,
    difficulty: doc.difficulty,
    hasVideo: doc.hasVideo,
    hasVideoWhite: doc.hasVideoWhite,
    hasVideoGym: doc.hasVideoGym,
    videoDurationSecs: doc.videoDurationSecs,
    exerciseType: doc.exerciseType,
    videoUrl: doc.videoUrl,
    videoHlsUrl: doc.videoHlsUrl,
    thumbnailUrl: doc.thumbnailUrl,
    videos: doc.videos,
    localizationStatus: localized.status,
  };
}

function createScoreMapFromIds(ids: string[], base: number, scores: Map<string, number>): void {
  for (const id of ids) {
    scores.set(id, (scores.get(id) ?? 0) + base);
  }
}

async function applyTypoTolerance(
  lang: string,
  token: string,
  scores: Map<string, number>,
  activeVersion: string,
): Promise<void> {
  if (token.length < 3 || config.catalogTypoDistance <= 0) {
    return;
  }

  const dictionary = await getTokensByPrefix(lang, token.slice(0, 2), activeVersion);
  const similarTokens = dictionary
    .filter((candidate) => Math.abs(candidate.length - token.length) <= config.catalogTypoDistance)
    .filter((candidate) => levenshteinDistance(candidate, token) <= config.catalogTypoDistance)
    .sort((a, b) => levenshteinDistance(a, token) - levenshteinDistance(b, token))
    .slice(0, 20);

  for (const similarToken of similarTokens) {
    const ids = await getIdsByExactToken(lang, similarToken, 30, activeVersion);
    createScoreMapFromIds(ids, 20, scores);
  }
}

function paginateIds(ids: string[], page: number, pageSize: number): string[] {
  const start = (page - 1) * pageSize;
  if (start >= ids.length) {
    return [];
  }

  return ids.slice(start, start + pageSize);
}

async function getPopularCatalogPage(lang: string, page: number, pageSize: number): Promise<string[]> {
  const activeVersion = await getActiveCatalogVersion();
  const version = activeVersion ?? 'v1';
  const needed = page * pageSize;
  const ids = await getPopularExerciseIds(lang, Math.max(needed, pageSize), version);
  if (ids.length >= needed) {
    return paginateIds(ids, page, pageSize);
  }

  if (ids.length > 0) {
    return paginateIds(ids, page, pageSize);
  }

  return getCatalogDocumentIds(page, pageSize, version);
}

export async function ensureCatalogSynced(requestId: string): Promise<void> {
  if (!config.catalogEnabled) {
    throw new CatalogError('Catalog feature is disabled', 503, 'catalog_disabled');
  }

  const activeVersionAtStart = await getActiveCatalogVersion();
  const meta = await getCatalogMetadata(activeVersionAtStart ?? undefined);
  const now = Date.now();
  const isFresh = meta && now - Date.parse(meta.lastSyncedAt) < config.catalogSyncIntervalMs;
  const hasUsableActiveData = Boolean(
    activeVersionAtStart
    && meta
    && meta.exerciseCount > 0,
  );

  if (isFresh) {
    return;
  }

  if (activeSyncPromise) {
    await activeSyncPromise;
    return;
  }

  activeSyncPromise = (async () => {
    const syncStartedAt = Date.now();
    logger.info({ requestId }, 'Catalog sync started');
    const newVersion = await createCatalogVersion();

    try {
      await registerBaseSynonyms(newVersion);

      let page = 1;
      let totalFetched = 0;
      let duplicateRows = 0;
      let expectedTotal = Number.POSITIVE_INFINITY;
      const seenExerciseIds = new Set<string>();

      while (
        page <= config.catalogSyncMaxPages
        && totalFetched < expectedTotal
      ) {
        const url = buildYMoveUrl(page, config.catalogSyncPageSize);
        const upstream = await forwardToYMove(url, 'GET', requestId);

        if (page === 1) {
          expectedTotal = upstream.total || 0;
        }

        if (upstream.exercises.length === 0) {
          break;
        }

        for (const exercise of upstream.exercises) {
          if (seenExerciseIds.has(exercise.id)) {
            duplicateRows += 1;
            continue;
          }

          seenExerciseIds.add(exercise.id);

          const localizations: Record<string, LocalizedExerciseFieldsDTO> = {
            en: extractLocalizationFromExercise(exercise, 'reviewed'),
          };

          for (const lang of NON_ENGLISH_LANGUAGES) {
            localizations[lang] = await localizeExercise(exercise, lang, requestId);
            await setLocalizationStatus(exercise.id, lang, localizations[lang].status, newVersion);
          }

          const doc: CatalogExerciseDocumentDTO = {
            id: exercise.id,
            slug: exercise.slug,
            muscleGroup: exercise.muscleGroup,
            secondaryMuscles: exercise.secondaryMuscles,
            equipment: exercise.equipment,
            category: exercise.category,
            difficulty: exercise.difficulty,
            hasVideo: exercise.hasVideo,
            hasVideoWhite: exercise.hasVideoWhite,
            hasVideoGym: exercise.hasVideoGym,
            videoDurationSecs: exercise.videoDurationSecs,
            exerciseType: exercise.exerciseType,
            videoUrl: exercise.videoUrl,
            videoHlsUrl: exercise.videoHlsUrl,
            thumbnailUrl: exercise.thumbnailUrl,
            videos: exercise.videos,
            localizations,
          };

          await saveCatalogDocument(doc, newVersion);
          await indexExercise(doc, newVersion);
        }

        totalFetched = seenExerciseIds.size;
        page += 1;
      }

      const metadata = {
        lastSyncedAt: new Date().toISOString(),
        exerciseCount: totalFetched,
      };

      await setCatalogMetadata(metadata, newVersion);
      await setActiveCatalogVersion(newVersion);
      await cleanupOldCatalogVersions(newVersion);
      incCounter('catalog_sync_runs_total', { status: 'success' });

      logger.info(
        {
          requestId,
          exerciseCount: totalFetched,
          duplicateRows,
          durationMs: Date.now() - syncStartedAt,
        },
        'Catalog sync finished',
      );
    } catch (err) {
      await clearCatalog(newVersion);
      throw err;
    }
  })();

  try {
    await activeSyncPromise;
  } catch (err) {
    if (hasUsableActiveData) {
      incCounter('catalog_sync_runs_total', { status: 'stale_served' });
      logger.warn(
        { requestId, err: String(err), activeVersion: activeVersionAtStart },
        'Catalog sync failed; serving previously active catalog version',
      );
      return;
    }

    incCounter('catalog_sync_runs_total', { status: 'failure' });
    logger.error({ requestId, err: String(err) }, 'Catalog sync failed');
    throw new CatalogError('Catalog synchronization failed', 502, 'catalog_sync_failed');
  } finally {
    activeSyncPromise = null;
  }
}

export async function searchCatalog(input: SearchInput, requestId: string): Promise<CatalogSearchResponseDTO> {
  const start = Date.now();
  const page = sanitizePage(input.page);
  const pageSize = sanitizePageSize(input.pageSize);
  const lang = normalizeLanguage(input.lang);
  const normalizedQuery = normalizeSearchText(input.query ?? '');

  await ensureCatalogSynced(requestId);

  const activeVersion = await getActiveCatalogVersion();
  const version = activeVersion ?? 'v1';
  const meta = await getCatalogMetadata(version);

  let rankedIds: string[] = [];
  let totalOverride: number | null = null;
  const scores = new Map<string, number>();

  if (!normalizedQuery || normalizedQuery.length < config.catalogMinQueryLength) {
    rankedIds = await getPopularCatalogPage(lang, page, pageSize);
    totalOverride = meta?.exerciseCount ?? rankedIds.length;
  } else {
    const tokens = tokenizeSearchText(normalizedQuery);

    if (tokens.length === 0) {
      rankedIds = await getPopularCatalogPage(lang, page, pageSize);
      totalOverride = meta?.exerciseCount ?? rankedIds.length;
    } else {
      for (const token of tokens) {
        const exactIds = await getIdsByExactToken(lang, token, CANDIDATE_POOL_SIZE, version);
        createScoreMapFromIds(exactIds, 100, scores);

        const prefixIds = await getIdsByPrefix(lang, token, CANDIDATE_POOL_SIZE, version);
        createScoreMapFromIds(prefixIds, 70, scores);

        const synonymTargets = await getSynonymTargets(lang, token, version);
        for (const synonymToken of synonymTargets) {
          const synonymIds = await getIdsByExactToken(lang, synonymToken, CANDIDATE_POOL_SIZE, version);
          createScoreMapFromIds(synonymIds, 50, scores);
        }

        await applyTypoTolerance(lang, token, scores, version);
      }

      const candidateIds = [...scores.keys()];
      const popularityScores = await getPopularityScores(lang, candidateIds, version);

      const docs = await getCatalogDocuments(candidateIds, version);
      for (const doc of docs) {
        const localizedStatus = doc.localizations[lang]?.status ?? 'machine';
        const reviewBoost = localizedStatus === 'reviewed' ? 15 : 0;
        scores.set(
          doc.id,
          (scores.get(doc.id) ?? 0) + (popularityScores[doc.id] ?? 0) + reviewBoost,
        );
      }

      rankedIds = [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id);
    }
  }

  const total = totalOverride ?? rankedIds.length;
  const pagedIds = totalOverride === null ? paginateIds(rankedIds, page, pageSize) : rankedIds;
  const docs = await getCatalogDocuments(pagedIds, version);
  const results = docs.map((doc) => mapToCatalogExercise(doc, lang));

  if (results.length > 0) {
    await Promise.allSettled(results.map((result) => incrementPopularity(lang, result.id, 1, version)));
  }

  incCounter('catalog_search_requests_total', { lang, status: 'success' });

  return {
    page,
    pageSize,
    total,
    results,
    meta: {
      lang,
      normalizedQuery,
      tookMs: Date.now() - start,
      catalogSyncedAt: meta?.lastSyncedAt ?? null,
    },
  };
}

export async function getCatalogHealth(requestId: string): Promise<CatalogHealthResponse> {
  if (!config.catalogEnabled) {
    return {
      ready: false,
      syncedAt: null,
      exerciseCount: 0,
      stale: true,
    };
  }

  const activeVersion = await getActiveCatalogVersion();
  const version = activeVersion ?? 'v1';
  const metadata = await getCatalogMetadata(version);

  if (!metadata) {
    return {
      ready: false,
      syncedAt: null,
      exerciseCount: 0,
      stale: true,
    };
  }

  const stale = Date.now() - Date.parse(metadata.lastSyncedAt) > config.catalogSyncIntervalMs;

  logger.info({ requestId, stale, exerciseCount: metadata.exerciseCount }, 'Catalog health checked');

  return {
    ready: true,
    syncedAt: metadata.lastSyncedAt,
    exerciseCount: metadata.exerciseCount,
    stale,
  };
}

export async function reviewCatalogLocalization(input: ReviewInput): Promise<void> {
  const lang = normalizeLanguage(input.lang);
  if (lang === 'en') {
    throw new CatalogError('Manual review is only supported for non-English localizations', 400, 'bad_request');
  }

  const activeVersion = await getActiveCatalogVersion();
  const version = activeVersion ?? 'v1';
  const doc = await getCatalogDocument(input.exerciseId, version);
  if (!doc) {
    throw new CatalogError('Exercise not found in catalog', 404, 'not_found');
  }

  const current = doc.localizations[lang] ?? doc.localizations.en;
  const next: LocalizedExerciseFieldsDTO = {
    title: input.title ?? current.title,
    description: input.description ?? current.description,
    instructions: input.instructions ?? current.instructions,
    importantPoints: input.importantPoints ?? current.importantPoints,
    status: input.status,
    updatedAt: new Date().toISOString(),
  };

  doc.localizations[lang] = next;

  await saveCatalogDocument(doc, version);
  await setLocalizationStatus(input.exerciseId, lang, input.status, version);
  await indexExercise(doc, version);
}

export async function getCatalogLocalizationStatus(
  exerciseId: string,
  lang: string,
): Promise<LocalizationStatus | null> {
  const normalized = normalizeLanguage(lang);
  const activeVersion = await getActiveCatalogVersion();
  const version = activeVersion ?? 'v1';
  return getLocalizationStatus(exerciseId, normalized, version);
}
