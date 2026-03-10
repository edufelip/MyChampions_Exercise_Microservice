import nock from 'nock';

jest.mock('../../config', () => ({
  config: {
    googleTranslateApiUrl: 'https://translation.googleapis.com/language/translate/v2',
    googleTranslateApiKey: () => 'translate-key',
    translationTimeoutMs: 2000,
    translationMaxRetries: 1,
  },
}));

jest.mock('../../logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import {
  translateQueryToEnglish,
  translateTexts,
  TranslateError,
} from '../../infrastructure/translate-client';

describe('translate-client', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.cleanAll();
  });

  it('retries once on retryable status and succeeds for batch text translation', async () => {
    const scope = nock('https://translation.googleapis.com')
      .post('/language/translate/v2')
      .query({ key: 'translate-key' })
      .reply(503, { error: { message: 'temporary' } })
      .post('/language/translate/v2')
      .query({ key: 'translate-key' })
      .reply(200, {
        data: {
          translations: [{ translatedText: 'Supino' }, { translatedText: 'Descricao' }],
        },
      });

    const result = await translateTexts(['Bench Press', 'Description'], 'pt', 'req-1');
    expect(result).toEqual(['Supino', 'Descricao']);
    expect(scope.isDone()).toBe(true);
  });

  it('does not retry on 400 and throws TranslateError', async () => {
    nock('https://translation.googleapis.com')
      .post('/language/translate/v2')
      .query({ key: 'translate-key' })
      .reply(400, { error: { message: 'bad request' } });

    await expect(translateTexts(['Bench Press'], 'pt', 'req-2')).rejects.toMatchObject<Partial<TranslateError>>({
      name: 'TranslateError',
      statusCode: 400,
    });
  });

  it('translates query to english for non-en source', async () => {
    const scope = nock('https://translation.googleapis.com')
      .post('/language/translate/v2')
      .query({ key: 'translate-key' })
      .reply(200, {
        data: {
          translations: [{ translatedText: 'Bench Press' }],
        },
      });

    const translated = await translateQueryToEnglish('Supino', 'pt', 'req-3');
    expect(translated).toBe('Bench Press');
    expect(scope.isDone()).toBe(true);
  });
});
