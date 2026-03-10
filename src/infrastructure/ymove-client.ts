/**
 * YMove Exercise API client.
 *
 * Forwards requests to the YMove upstream API and returns the parsed response.
 */
import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import { ExerciseDTO, YMoveExerciseListResponse } from '../domain/dtos';

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
  page?: number;
  pageSize?: number;
  total?: number;
  exercises?: ExerciseDTO[];
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
  headers: Record<string, string>,
): Promise<YMoveExerciseListResponse> {
  const upperMethod = method.toUpperCase();

  try {
    const response = await axios.request<RawYMoveResponse>({
      url,
      method: upperMethod,
      headers: {
        ...headers,
        Accept: 'application/json',
      },
      timeout: config.upstreamTimeoutMs,
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 400) {
      logger.warn({ status: response.status, url }, 'YMove API returned client error');
      throw new YMoveError(`YMove API returned ${response.status}`, response.status);
    }

    const data = response.data;

    return {
      page: data.page ?? 1,
      pageSize: data.pageSize ?? 0,
      total: data.total ?? 0,
      exercises: data.exercises ?? [],
    };
  } catch (err) {
    if (err instanceof YMoveError) {
      throw err;
    }

    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      logger.error({ status, message: err.message, url }, 'YMove API request failed');
      throw new YMoveError(`YMove upstream error: ${err.message}`, status ?? 502);
    }

    logger.error({ message: String(err), url }, 'Unknown error calling YMove API');
    throw new YMoveError('YMove upstream error');
  }
}
