/**
 * Domain DTOs and models for the YMove Translation Proxy.
 *
 * These types define the data contracts between the layers of the application.
 */

/** Incoming request from client */
export interface RequestDTO {
  /** Target language code (e.g. "pt", "es", "fr") */
  lang: string;
  /** The upstream request to forward */
  request: ProxyRequestDTO;
}

/** The upstream request details to forward */
export interface ProxyRequestDTO {
  /** Full URL to forward (must be on exercise-api.ymove.app) */
  url: string;
  /** HTTP method to use */
  method: string;
  /** HTTP headers to forward (e.g. X-API-Key) */
  headers: Record<string, string>;
}

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

/** The translated human-readable fields of an exercise (stored in Redis) */
export interface TranslatedFieldsDTO {
  title: string;
  description: string;
  instructions: string[];
  importantPoints: string[];
}

/** An exercise with translated text fields */
export type TranslatedExerciseDTO = ExerciseDTO & TranslatedFieldsDTO;

/** Response from the YMove API exercises list endpoint */
export interface YMoveExerciseListResponse {
  page: number;
  pageSize: number;
  total: number;
  exercises: ExerciseDTO[];
}

/** The translated response returned to the client */
export interface TranslatedExerciseListResponse {
  page: number;
  pageSize: number;
  total: number;
  exercises: TranslatedExerciseDTO[];
}

/** Observability metadata for a single proxy request */
export interface RequestMetrics {
  requestId: string;
  userLang: string;
  searchTermOriginal: string;
  searchTermTranslated: string;
  cacheHits: number;
  cacheMisses: number;
  translationCalls: number;
  durationMs: number;
}
