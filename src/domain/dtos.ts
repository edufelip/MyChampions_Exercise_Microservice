/**
 * Domain DTOs and models for the multilingual exercise catalog.
 *
 * These types define the data contracts between the layers of the application.
 */

/** A single exercise as returned by the YMove API */
export interface ExerciseDTO {
  id: string;
  title: string;
  slug: string;
  description: string;
  instructions: string[];
  importantPoints: string[];
  muscleGroup: string | null;
  secondaryMuscles: string | null;
  equipment: string | null;
  category: string | null;
  difficulty: string | null;
  videoDurationSecs: number | null;
  hasVideo: boolean;
  hasVideoWhite: boolean;
  hasVideoGym: boolean;
  exerciseType: string[];
  videoUrl: string | null;
  videoHlsUrl: string | null;
  thumbnailUrl: string | null;
  videos: VideoDTO[] | null;
}

/** A video entry within an exercise */
export interface VideoDTO {
  videoUrl: string;
  videoHlsUrl: string;
  thumbnailUrl: string;
  tag: string | null;
  orientation: string | null;
  isPrimary: boolean;
}

/** Response from the YMove API exercises list endpoint */
export interface YMoveExerciseListResponse {
  page: number;
  pageSize: number;
  total: number;
  exercises: ExerciseDTO[];
}

/** Catalog search request body */
export interface CatalogSearchRequestDTO {
  lang?: string;
  query?: string;
  page?: number;
  pageSize?: number;
}

/** Catalog exercise detail request params/query */
export interface CatalogExerciseDetailRequestDTO {
  id: string;
  lang?: string;
}

/** Localization quality state for a language */
export type LocalizationStatus = 'source' | 'machine' | 'fallback' | 'reviewed' | 'rejected';

/** Localized text block for one exercise and language */
export interface LocalizedExerciseFieldsDTO {
  title: string;
  description: string;
  instructions: string[];
  importantPoints: string[];
  status: LocalizationStatus;
  updatedAt: string;
}

/** Catalog document persisted in Redis */
export interface CatalogExerciseDocumentDTO {
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
  videos: VideoDTO[] | null;
  localizations: Record<string, LocalizedExerciseFieldsDTO>;
}

/** Single search result returned from catalog endpoint */
export interface CatalogExerciseDTO {
  id: string;
  slug: string;
  title: string;
  description: string;
  instructions: string[];
  importantPoints: string[];
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
  videos: VideoDTO[] | null;
  localizationStatus: LocalizationStatus;
}

/** Catalog search response payload */
export interface CatalogSearchResponseDTO {
  page: number;
  pageSize: number;
  total: number;
  results: CatalogExerciseDTO[];
  meta: {
    lang: string;
    normalizedQuery: string;
    tookMs: number;
    catalogSyncedAt: string | null;
  };
}

export interface CatalogBenchmarkRequestDTO {
  lang?: string;
  queries: string[];
  pageSize?: number;
}

export interface CatalogBenchmarkQueryResultDTO {
  query: string;
  upstreamLatencyMs: number;
  catalogLatencyMs: number;
  upstreamResultCount: number;
  catalogResultCount: number;
  topOverlapCount: number;
  topOverlapRate: number;
}

export interface CatalogBenchmarkResponseDTO {
  lang: string;
  pageSize: number;
  totalQueries: number;
  summary: {
    avgUpstreamLatencyMs: number;
    avgCatalogLatencyMs: number;
    avgTopOverlapRate: number;
  };
  results: CatalogBenchmarkQueryResultDTO[];
}
