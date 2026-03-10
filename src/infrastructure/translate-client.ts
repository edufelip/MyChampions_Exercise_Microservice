/**
 * Google Cloud Translation API v2 client.
 *
 * Translates one or more text strings into the target language using the
 * REST API (simple API key auth – no OAuth required for public quota).
 */
import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import { backoffDelayMs, isRetryableCode, isRetryableStatus, waitMs } from './retry';

export class TranslateError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'TranslateError';
  }
}

interface GoogleTranslateResponse {
  data: {
    translations: Array<{
      translatedText: string;
      detectedSourceLanguage?: string;
    }>;
  };
}

/**
 * Translate an array of text strings to the target language.
 *
 * @param texts  - Strings to translate.
 * @param target - BCP-47 language code for the target language (e.g. "pt").
 * @returns      - Translated strings in the same order as the input.
 */
export async function translateTexts(
  texts: string[],
  target: string,
  requestId?: string,
): Promise<string[]> {
  if (texts.length === 0) {
    return [];
  }

  if (target === 'en') {
    return texts;
  }

  const url = config.googleTranslateApiUrl;
  const maxAttempts = config.translationMaxRetries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.post<GoogleTranslateResponse>(
        url,
        {
          q: texts,
          target,
          source: 'en',
          format: 'text',
        },
        {
          params: { key: config.googleTranslateApiKey() },
          timeout: config.translationTimeoutMs,
          headers: { 'Content-Type': 'application/json' },
          validateStatus: () => true,
          maxRedirects: 0,
        },
      );

      if (response.status >= 400) {
        if (attempt < maxAttempts && isRetryableStatus(response.status)) {
          await waitMs(backoffDelayMs(attempt));
          continue;
        }
        throw new TranslateError(`Google Translate API returned ${response.status}`, response.status);
      }

      const translations = response.data?.data?.translations;
      if (!Array.isArray(translations) || translations.length !== texts.length) {
        throw new TranslateError('Unexpected response structure from Google Translate API');
      }

      return translations.map((t) => t.translatedText);
    } catch (err) {
      if (err instanceof TranslateError) {
        throw err;
      }

      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const code = err.code;
        const retryable = isRetryableStatus(status) || isRetryableCode(code);

        if (attempt < maxAttempts && retryable) {
          await waitMs(backoffDelayMs(attempt));
          continue;
        }

        logger.error(
          { requestId, status, code, message: err.message },
          'Google Translate API request failed',
        );
        throw new TranslateError(`Google Translate API error: ${err.message}`, status);
      }

      logger.error({ requestId, message: String(err) }, 'Unknown error calling Google Translate API');
      throw new TranslateError('Unknown translation error');
    }
  }

  throw new TranslateError('Unknown translation error');
}

/**
 * Translate a single query string from English into the target language.
 * Returns the original text if target is English.
 */
export async function translateQueryToEnglish(
  query: string,
  sourceLang: string,
  requestId?: string,
): Promise<string> {
  if (sourceLang === 'en') {
    return query;
  }

  const url = config.googleTranslateApiUrl;
  const maxAttempts = config.translationMaxRetries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.post<GoogleTranslateResponse>(
        url,
        {
          q: [query],
          target: 'en',
          source: sourceLang,
          format: 'text',
        },
        {
          params: { key: config.googleTranslateApiKey() },
          timeout: config.translationTimeoutMs,
          headers: { 'Content-Type': 'application/json' },
          validateStatus: () => true,
          maxRedirects: 0,
        },
      );

      if (response.status >= 400) {
        if (attempt < maxAttempts && isRetryableStatus(response.status)) {
          await waitMs(backoffDelayMs(attempt));
          continue;
        }
        throw new TranslateError(`Google Translate API returned ${response.status}`, response.status);
      }

      const translations = response.data?.data?.translations;
      if (!Array.isArray(translations) || translations.length === 0) {
        throw new TranslateError('Unexpected response structure from Google Translate API');
      }

      return translations[0].translatedText;
    } catch (err) {
      if (err instanceof TranslateError) {
        throw err;
      }

      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const code = err.code;
        const retryable = isRetryableStatus(status) || isRetryableCode(code);

        if (attempt < maxAttempts && retryable) {
          await waitMs(backoffDelayMs(attempt));
          continue;
        }

        logger.error(
          { requestId, status, code, message: err.message },
          'Google Translate API query translation failed',
        );
        throw new TranslateError(`Google Translate API error: ${err.message}`, status);
      }

      logger.error({ requestId, message: String(err) }, 'Unknown error translating query');
      throw new TranslateError('Unknown translation error');
    }
  }

  throw new TranslateError('Unknown translation error');
}
