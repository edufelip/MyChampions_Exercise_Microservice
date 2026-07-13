import { RedisSnapshotEntry, RedisZSetMember } from './redis-snapshot-types';

interface StoredExerciseDocument {
  id: string;
  slug: string;
  muscleGroup: string | null;
  secondaryMuscles: string | null;
  equipment: string | null;
  category: string | null;
  difficulty: string | null;
  hasVideo: boolean;
  hasVideoWhite: boolean;
  hasVideoGym: boolean;
  videoDurationSecs: number | null;
  exerciseType: string[];
  videoUrl: string | null;
  videoHlsUrl: string | null;
  thumbnailUrl: string | null;
  videos: unknown;
  localizations: Record<string, StoredExerciseLocalization>;
}

interface StoredExerciseLocalization {
  title: string;
  description: string | null;
  instructions: string[];
  importantPoints: string[];
  status: string;
  updatedAt: string;
}

interface StoredExerciseMetadata {
  lastSyncedAt: string;
  exerciseCount: number;
  seedQueryCount?: number;
  successfulSeedQueries?: number;
  failedSeedQueries?: number;
  fetchedRows?: number;
  duplicateRows?: number;
}

export interface ExerciseCatalogExerciseRow {
  id: string;
  version: string;
  slug: string;
  muscleGroup: string | null;
  secondaryMuscles: string | null;
  equipment: string | null;
  category: string | null;
  difficulty: string | null;
  hasVideo: boolean;
  hasVideoWhite: boolean;
  hasVideoGym: boolean;
  videoDurationSecs: number | null;
  exerciseType: string[];
  videoUrl: string | null;
  videoHlsUrl: string | null;
  thumbnailUrl: string | null;
  videos: unknown;
  rawDocument: StoredExerciseDocument;
}

export interface ExerciseCatalogLocalizationRow {
  exerciseId: string;
  version: string;
  lang: string;
  title: string;
  description: string | null;
  instructions: string[];
  importantPoints: string[];
  status: string;
  updatedAt: string | null;
  rawLocalization: StoredExerciseLocalization;
}

export interface ExerciseCatalogLocalizationStatusRow {
  exerciseId: string;
  version: string;
  lang: string;
  status: string;
}

export interface ExerciseCatalogPopularityRow {
  lang: string;
  version: string;
  exerciseId: string;
  score: number;
}

export interface ExerciseCatalogMetadataRow extends StoredExerciseMetadata {
  version: string;
  rawMetadata: StoredExerciseMetadata;
}

export interface ExerciseCatalogSnapshotRows {
  activeVersion: string | null;
  exercises: ExerciseCatalogExerciseRow[];
  localizations: ExerciseCatalogLocalizationRow[];
  localizationStatuses: ExerciseCatalogLocalizationStatusRow[];
  popularity: ExerciseCatalogPopularityRow[];
  metadata: ExerciseCatalogMetadataRow[];
}

function parseJsonObject<T>(value: unknown): T | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function isZSetValue(value: unknown): value is RedisZSetMember[] {
  return Array.isArray(value)
    && value.every((item) => (
      !!item
      && typeof item === 'object'
      && 'member' in item
      && 'score' in item
      && typeof item.member === 'string'
      && typeof item.score === 'number'
    ));
}

function buildExerciseRows(entry: RedisSnapshotEntry, version: string): {
  exercise: ExerciseCatalogExerciseRow;
  localizations: ExerciseCatalogLocalizationRow[];
} | null {
  const doc = parseJsonObject<StoredExerciseDocument>(entry.value);
  if (!doc?.id) {
    return null;
  }

  return {
    exercise: {
      id: doc.id,
      version,
      slug: doc.slug,
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
      rawDocument: doc,
    },
    localizations: Object.entries(doc.localizations ?? {}).map(([lang, localization]) => ({
      exerciseId: doc.id,
      version,
      lang,
      title: localization.title,
      description: localization.description,
      instructions: localization.instructions,
      importantPoints: localization.importantPoints,
      status: localization.status,
      updatedAt: localization.updatedAt ?? null,
      rawLocalization: localization,
    })),
  };
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function buildExerciseCatalogSnapshotRows(entries: RedisSnapshotEntry[]): ExerciseCatalogSnapshotRows {
  const rows: ExerciseCatalogSnapshotRows = {
    activeVersion: null,
    exercises: [],
    localizations: [],
    localizationStatuses: [],
    popularity: [],
    metadata: [],
  };

  entries.forEach((entry) => {
    const parts = entry.key.split(':');
    if (parts[0] !== 'catalog') {
      return;
    }

    if (entry.key === 'catalog:active_version' && typeof entry.value === 'string') {
      rows.activeVersion = entry.value;
      return;
    }

    if (parts[1] === 'exercise' && parts.length >= 4) {
      const version = parts[parts.length - 1] as string;
      const exerciseRows = buildExerciseRows(entry, version);
      if (exerciseRows) {
        rows.exercises.push(exerciseRows.exercise);
        rows.localizations.push(...exerciseRows.localizations);
      }
      return;
    }

    if (parts[1] === 'l10n' && parts[2] === 'status' && parts.length >= 6 && typeof entry.value === 'string') {
      rows.localizationStatuses.push({
        exerciseId: parts[3] as string,
        lang: parts[4] as string,
        version: parts[5] as string,
        status: entry.value,
      });
      return;
    }

    if (parts[1] === 'popularity' && parts.length >= 4 && isZSetValue(entry.value)) {
      const lang = parts[2] as string;
      const version = parts[3] as string;
      rows.popularity.push(...entry.value.map((item) => ({
        lang,
        version,
        exerciseId: item.member,
        score: item.score,
      })));
      return;
    }

    if (parts[1] === 'meta' && parts.length >= 3) {
      const metadata = parseJsonObject<StoredExerciseMetadata>(entry.value);
      if (metadata) {
        rows.metadata.push({
          version: parts[2] as string,
          lastSyncedAt: metadata.lastSyncedAt,
          exerciseCount: metadata.exerciseCount,
          seedQueryCount: toOptionalNumber(metadata.seedQueryCount),
          successfulSeedQueries: toOptionalNumber(metadata.successfulSeedQueries),
          failedSeedQueries: toOptionalNumber(metadata.failedSeedQueries),
          fetchedRows: toOptionalNumber(metadata.fetchedRows),
          duplicateRows: toOptionalNumber(metadata.duplicateRows),
          rawMetadata: metadata,
        });
      }
    }
  });

  return rows;
}
