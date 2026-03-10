/**
 * Translation service – orchestrates Redis cache and Google Translate API.
 *
 * For each exercise:
 *  1. Check Redis cache.
 *  2. On hit → use cached translation.
 *  3. On miss → batch-translate via Google Translate, store in Redis.
 *
 * Fallback: if translation fails, return original English text.
 */
import { ExerciseDTO, TranslatedExerciseDTO, TranslatedFieldsDTO } from '../domain/dtos';
import { translateTexts, translateQueryToEnglish } from '../infrastructure/translate-client';
import { getCachedTranslation, setCachedTranslation } from './cache.service';
import { logger } from '../logger';

export { translateQueryToEnglish };

export interface TranslationStats {
  cacheHits: number;
  cacheMisses: number;
  translationCalls: number;
  translatedCharacters: number;
}

/**
 * Translate a list of exercises into the target language.
 *
 * Exercises already cached in Redis are served from cache.
 * Remaining exercises are translated in a single batched API call.
 *
 * @param exercises - English exercises from YMove API.
 * @param lang      - Normalized BCP-47 language code.
 * @returns Translated exercises + observability stats.
 */
export async function translateExercises(
  exercises: ExerciseDTO[],
  lang: string,
  requestId?: string,
): Promise<{ exercises: TranslatedExerciseDTO[]; stats: TranslationStats }> {
  const stats: TranslationStats = {
    cacheHits: 0,
    cacheMisses: 0,
    translationCalls: 0,
    translatedCharacters: 0,
  };

  if (lang === 'en' || exercises.length === 0) {
    const result = exercises.map((ex) => ({
      ...ex,
      title: ex.title,
      description: ex.description,
      instructions: ex.instructions,
      importantPoints: ex.importantPoints,
    }));
    return { exercises: result, stats };
  }

  // Step 1: Check cache for each exercise
  const cacheResults = await Promise.all(
    exercises.map((ex) => getCachedTranslation(ex.id, lang)),
  );

  // Step 2: Identify which exercises need translation
  const toTranslate: Array<{ index: number; exercise: ExerciseDTO }> = [];

  for (let i = 0; i < exercises.length; i++) {
    if (cacheResults[i]) {
      stats.cacheHits++;
    } else {
      stats.cacheMisses++;
      toTranslate.push({ index: i, exercise: exercises[i] });
    }
  }

  // Step 3: Batch-translate uncached exercises
  if (toTranslate.length > 0) {
    stats.translationCalls++;

    // Flatten all translatable strings into a single batch
    // Format: [title, description, ...instructions, ...importantPoints] per exercise
    const batchTexts: string[] = [];
    const batchOffsets: Array<{ start: number; instructionCount: number; importantPointsCount: number }> = [];

    for (const { exercise } of toTranslate) {
      const start = batchTexts.length;
      batchTexts.push(exercise.title);
      batchTexts.push(exercise.description ?? '');
      for (const instruction of exercise.instructions ?? []) {
        batchTexts.push(instruction);
      }
      for (const point of exercise.importantPoints ?? []) {
        batchTexts.push(point);
      }
      batchOffsets.push({
        start,
        instructionCount: (exercise.instructions ?? []).length,
        importantPointsCount: (exercise.importantPoints ?? []).length,
      });
    }

    let translatedBatch: string[];

    try {
      translatedBatch = await translateTexts(batchTexts, lang, requestId);
      stats.translatedCharacters += batchTexts.reduce((acc, text) => acc + text.length, 0);
    } catch (err) {
      logger.warn({ err: String(err) }, 'Translation API failed – falling back to English');
      translatedBatch = batchTexts; // fallback to original English
    }

    // Step 4: Parse results and store in cache
    const cacheWrites: Promise<void>[] = [];

    for (let j = 0; j < toTranslate.length; j++) {
      const { index, exercise } = toTranslate[j];
      const offset = batchOffsets[j];
      let cursor = offset.start;

      const translatedTitle = translatedBatch[cursor++];
      const translatedDescription = translatedBatch[cursor++];
      const translatedInstructions = translatedBatch.slice(cursor, cursor + offset.instructionCount);
      cursor += offset.instructionCount;
      const translatedImportantPoints = translatedBatch.slice(cursor, cursor + offset.importantPointsCount);

      const fields: TranslatedFieldsDTO = {
        title: translatedTitle,
        description: translatedDescription,
        instructions: translatedInstructions,
        importantPoints: translatedImportantPoints,
      };

      cacheResults[index] = fields;
      cacheWrites.push(setCachedTranslation(exercise.id, lang, fields));
    }

    // Fire-and-forget cache writes
    await Promise.allSettled(cacheWrites);
  }

  // Step 5: Assemble final response
  const result: TranslatedExerciseDTO[] = exercises.map((ex, i) => {
    const fields = cacheResults[i];
    return {
      ...ex,
      title: fields?.title ?? ex.title,
      description: fields?.description ?? ex.description,
      instructions: fields?.instructions ?? ex.instructions,
      importantPoints: fields?.importantPoints ?? ex.importantPoints,
    };
  });

  return { exercises: result, stats };
}
