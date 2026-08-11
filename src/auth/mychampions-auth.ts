import { config } from '../config';

export type AuthenticatedMyChampionsUser = {
  uid: string;
};

export class MyChampionsAuthError extends Error {
  constructor(
    public readonly code: 'unauthenticated' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'MyChampionsAuthError';
  }
}

type RootAuthPayload = {
  profile?: {
    authUid?: unknown;
  };
};

export function createMyChampionsAuthVerifier(options: {
  baseUrl: string | null;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}): (accessToken: string) => Promise<AuthenticatedMyChampionsUser> {
  const baseUrl = options.baseUrl?.replace(/\/+$/, '') || null;
  const timeoutMs = options.timeoutMs ?? config.upstreamTimeoutMs;

  return async (accessToken: string): Promise<AuthenticatedMyChampionsUser> => {
    if (!baseUrl) {
      throw new MyChampionsAuthError('unavailable', 'MyChampions auth server is not configured.');
    }

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await options.fetch(`${baseUrl}/me`, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      throw new MyChampionsAuthError('unavailable', 'MyChampions auth server is unavailable.');
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401) {
      throw new MyChampionsAuthError('unauthenticated', 'MyChampions session is invalid.');
    }
    if (!response.ok) {
      throw new MyChampionsAuthError('unavailable', 'MyChampions auth server is unavailable.');
    }

    let payload: RootAuthPayload;
    try {
      payload = await response.json() as RootAuthPayload;
    } catch {
      throw new MyChampionsAuthError('unavailable', 'MyChampions auth response is invalid.');
    }

    const authUid = payload.profile?.authUid;
    if (typeof authUid !== 'string' || authUid.trim().length === 0) {
      throw new MyChampionsAuthError('unavailable', 'MyChampions auth response is invalid.');
    }
    return { uid: authUid };
  };
}

export const verifyMyChampionsAccessToken = createMyChampionsAuthVerifier({
  baseUrl: config.mychampionsAuthServerUrl,
  fetch: globalThis.fetch,
});
