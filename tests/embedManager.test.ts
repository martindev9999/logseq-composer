import { describe, expect, it, vi, afterEach } from 'vitest';
import { generateEmbedding, resolveEmbeddingConfig } from '../src/embedManager';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('resolveEmbeddingConfig', () => {
  it('uses the chat API key by default when embedding key is blank', () => {
    const config = resolveEmbeddingConfig({
      apiKey: 'chat-key',
      EmbeddingApiKey: '',
      LiteLLMLink: 'http://localhost:4000/chat/completions',
    });

    expect(config.apiKey).toBe('chat-key');
    expect(config.endpoint).toBe('http://localhost:4000/embeddings');
  });

  it('prefers the embedding API key when reuse is disabled', () => {
    const config = resolveEmbeddingConfig({
      apiKey: 'chat-key',
      EmbeddingApiKey: 'embed-key',
      useLLMKeyForEmbeddings: false,
      LiteLLMLink: '',
    });

    expect(config.apiKey).toBe('embed-key');
    expect(config.endpoint).toBe('https://api.openai.com/v1/embeddings');
  });

  it('falls back to provided endpoint and model overrides', () => {
    const config = resolveEmbeddingConfig({
      apiKey: 'chat-key',
      EmbeddingApiKey: '',
      useLLMKeyForEmbeddings: true,
      embeddingEndpoint: 'https://custom.dev/embed',
      embeddingModel: 'custom-model',
      embeddingAuthHeader: 'X-Token',
      embeddingAuthScheme: '',
    });

    expect(config.endpoint).toBe('https://custom.dev/embed');
    expect(config.model).toBe('custom-model');
    expect(config.authHeader).toBe('X-Token');
    expect(config.authScheme).toBe('');
  });
});

describe('generateEmbedding', () => {
  const baseConfig = {
    endpoint: 'https://custom.dev/embed',
    model: 'custom-model',
    apiKey: 'embed-key',
    authHeader: 'Authorization',
    authScheme: 'Bearer',
  };

  it('returns embedding and dimension on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            embedding: [0.1, 0.2, 0.3],
            model: 'returned-model',
          },
        ],
      }),
    } as any);
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateEmbedding('hello', baseConfig, { retries: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit?.headers).toMatchObject({ Authorization: 'Bearer embed-key' });

    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result.dimension).toBe(3);
    expect(result.model).toBe('returned-model');
  });

  it('retries on failure and eventually succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [1], model: 'retry-model' }],
        }),
      } as any);
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateEmbedding('hello', baseConfig, { retries: 1, retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.embedding).toEqual([1]);
    expect(result.dimension).toBe(1);
    expect(result.model).toBe('retry-model');
  });

  it('throws when all retry attempts fail', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    } as any);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateEmbedding('hello', baseConfig, { retries: 1, retryDelayMs: 0 }),
    ).rejects.toThrow(/Embedding API error/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces embedding API json error messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({
        error: { message: 'Invalid embedding key' },
      }),
    } as any);
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateEmbedding('hello', baseConfig, { retries: 0 })).rejects.toThrow(
      /Invalid embedding key/,
    );
  });

  it('surfaces raw text errors when json parse fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new Error('not json');
      },
      text: async () => 'Server blew up',
    } as any);
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateEmbedding('hello', baseConfig, { retries: 0 })).rejects.toThrow(
      /Server blew up/,
    );
  });
});
