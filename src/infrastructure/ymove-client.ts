/**
 * YMove Exercise API client.
 *
 * Forwards requests to the YMove upstream API and returns the parsed response.
 */
import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import { ExerciseDTO, YMoveExerciseListResponse } from '../domain/dtos';
import { backoffDelayMs, isRetryableCode, isRetryableStatus, waitMs } from './retry';

export class YMoveError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'YMoveError';
  }
}

interface RawYMoveResponse {
  data?: ExerciseDTO[];
  pagination?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
}

/**
 * Forward a request to the YMove API and return the parsed exercise list.
 *
 * @param url     - Full YMove URL (pre-validated and search term already translated).
 * @param method  - HTTP method (only GET is expected for exercise search).
 * @param headers - HTTP headers to include (e.g. X-API-Key).
 */
export async function forwardToYMove(
  url: string,
  method: string,
  requestId: string,
): Promise<YMoveExerciseListResponse> {
  const upperMethod = method.toUpperCase();
  const headers = {
    'X-API-Key': config.ymoveApiKey(),
    Accept: 'application/json',
  };

  const maxAttempts = config.upstreamMaxRetries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.request<RawYMoveResponse>({
        url,
        method: upperMethod,
        headers,
        timeout: config.upstreamTimeoutMs,
        validateStatus: () => true,
        maxRedirects: 0,
      });

      if (response.status >= 500) {
        if (attempt < maxAttempts && isRetryableStatus(response.status)) {
          await waitMs(backoffDelayMs(attempt));
          continue;
        }
        throw new YMoveError(`YMove API returned ${response.status}`, response.status);
      }

      if (response.status >= 400) {
        logger.warn({ requestId, status: response.status, url }, 'YMove API returned client error');
        throw new YMoveError(`YMove API returned ${response.status}`, response.status);
      }

      const data = response.data;
      const exercises = data?.data;
      const pagination = data?.pagination;

      if (!Array.isArray(exercises) || !pagination || typeof pagination !== 'object') {
        logger.error({ requestId, url, responseSample: data }, 'Unexpected YMove response schema');
        throw new YMoveError('Unexpected response schema from YMove API', 502);
      }

      return {
        page: pagination.page ?? 1,
        pageSize: pagination.pageSize ?? exercises.length,
        total: pagination.total ?? exercises.length,
        exercises,
      };
    } catch (err) {
      if (err instanceof YMoveError) {
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

        logger.error({ requestId, status, code, message: err.message, url }, 'YMove API request failed');
        throw new YMoveError(`YMove upstream error: ${err.message}`, status ?? 502);
      }

      logger.error({ requestId, message: String(err), url }, 'Unknown error calling YMove API');
      throw new YMoveError('YMove upstream error');
    }
  }

  throw new YMoveError('YMove upstream error');
}
