/**
 * Unit tests – translation service
 */
import { translateExercises } from '../../services/translation.service';
import { ExerciseDTO } from '../../domain/dtos';

// Mock infrastructure and cache dependencies
jest.mock('../../infrastructure/translate-client', () => ({
  translateTexts: jest.fn(),
  translateQueryToEnglish: jest.fn(),
}));

jest.mock('../../services/cache.service', () => ({
  getCachedTranslation: jest.fn(),
  setCachedTranslation: jest.fn(),
}));

import { translateTexts } from '../../infrastructure/translate-client';
import { getCachedTranslation, setCachedTranslation } from '../../services/cache.service';

const mockTranslateTexts = translateTexts as jest.MockedFunction<typeof translateTexts>;
const mockGetCached = getCachedTranslation as jest.MockedFunction<typeof getCachedTranslation>;
const mockSetCached = setCachedTranslation as jest.MockedFunction<typeof setCachedTranslation>;

const makeExercise = (id: string): ExerciseDTO => ({
  id,
  title: 'Bench Press',
  slug: 'bench-press',
  description: 'A chest exercise',
  instructions: ['Lie down', 'Push up'],
  importantPoints: ['Keep form'],
  muscleGroup: 'chest',
  secondaryMuscles: null,
  equipment: 'barbell',
  category: 'Chest',
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
});

describe('translateExercises', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetCached.mockResolvedValue(undefined);
  });

  it('returns original exercises without API calls when lang is "en"', async () => {
    const exercises = [makeExercise('1')];
    const { exercises: result, stats } = await translateExercises(exercises, 'en');

    expect(result[0].title).toBe('Bench Press');
    expect(mockTranslateTexts).not.toHaveBeenCalled();
    expect(stats.translationCalls).toBe(0);
  });

  it('returns empty array when no exercises provided', async () => {
    const { exercises: result, stats } = await translateExercises([], 'pt');
    expect(result).toHaveLength(0);
    expect(stats.cacheHits).toBe(0);
    expect(stats.cacheMisses).toBe(0);
  });

  it('uses cached translation when available', async () => {
    const cached = {
      title: 'Supino com barra',
      description: 'Um exercício de peito',
      instructions: ['Deite-se', 'Empurre para cima'],
      importantPoints: ['Mantenha a forma'],
    };
    mockGetCached.mockResolvedValue(cached);

    const { exercises: result, stats } = await translateExercises([makeExercise('1')], 'pt');

    expect(result[0].title).toBe('Supino com barra');
    expect(mockTranslateTexts).not.toHaveBeenCalled();
    expect(stats.cacheHits).toBe(1);
    expect(stats.cacheMisses).toBe(0);
    expect(stats.translationCalls).toBe(0);
  });

  it('calls translate API and caches result on cache miss', async () => {
    mockGetCached.mockResolvedValue(null);
    mockTranslateTexts.mockResolvedValue([
      'Supino com barra',
      'Um exercício de peito',
      'Deite-se',
      'Empurre para cima',
      'Mantenha a forma',
    ]);

    const { exercises: result, stats } = await translateExercises([makeExercise('1')], 'pt');

    expect(result[0].title).toBe('Supino com barra');
    expect(result[0].instructions).toEqual(['Deite-se', 'Empurre para cima']);
    expect(mockTranslateTexts).toHaveBeenCalledTimes(1);
    expect(mockSetCached).toHaveBeenCalledTimes(1);
    expect(stats.cacheHits).toBe(0);
    expect(stats.cacheMisses).toBe(1);
    expect(stats.translationCalls).toBe(1);
  });

  it('falls back to English when translation API fails', async () => {
    mockGetCached.mockResolvedValue(null);
    mockTranslateTexts.mockRejectedValue(new Error('Translation API unavailable'));

    const { exercises: result } = await translateExercises([makeExercise('1')], 'pt');

    expect(result[0].title).toBe('Bench Press');
    expect(result[0].description).toBe('A chest exercise');
  });

  it('mixes cached and uncached exercises efficiently', async () => {
    const ex1 = makeExercise('1');
    const ex2 = makeExercise('2');

    mockGetCached
      .mockResolvedValueOnce({
        title: 'Cached Title',
        description: 'Cached Desc',
        instructions: ['Cached step'],
        importantPoints: ['Cached point'],
      })
      .mockResolvedValueOnce(null);

    mockTranslateTexts.mockResolvedValue([
      'Translated Title',
      'Translated Desc',
      'Translated step 1',
      'Translated step 2',
      'Translated point',
    ]);

    const { exercises: result, stats } = await translateExercises([ex1, ex2], 'pt');

    expect(result[0].title).toBe('Cached Title');
    expect(result[1].title).toBe('Translated Title');
    expect(stats.cacheHits).toBe(1);
    expect(stats.cacheMisses).toBe(1);
    expect(stats.translationCalls).toBe(1);
    // Only 1 batch call for uncached exercises
    expect(mockTranslateTexts).toHaveBeenCalledTimes(1);
  });
});
