import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as embedManager from '../src/embedManager';

const mockConfig = {
  endpoint: 'http://localhost:4000/embeddings',
  model: 'mock-model',
  apiKey: 'mock-key',
  authHeader: 'Authorization',
  authScheme: 'Bearer',
};

describe('embedManager chunking and metadata', () => {
  beforeEach(() => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [1, 2, 3], model: 'mock-model' }],
      }),
    } as any);
    (global as any).fetch = fetchMock;
    (global as any).logseq = {
      Editor: {
        getAllPages: async () => [
          {
            id: 1,
            name: 'Test Page',
            updatedAt: 123,
            uuid: { $uuid$: 'page-1' },
          },
        ],
        getPageBlocksTree: async () => [
          {
            content: 'abcdefghij1234567890', // > maxChunkSize (10) to force chunking
            uuid: { $uuid$: 'block-1' },
            children: [],
          },
        ],
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    (global as any).fetch = undefined;
    (global as any).logseq = undefined;
  });

  it('splits blocks into chunks and carries metadata', async () => {
    const fetchMock = (global as any).fetch as vi.Mock;

    const { embeddings, dimension } = await embedManager.getEmbeddingsAllNotes(mockConfig, {
      maxChunkSize: 10,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2); // two chunks
    expect(embeddings.length).toBe(2);
    expect(dimension).toBe(3);

    const first = embeddings[0];
    expect(first.pageId).toBe('1');
    expect(first.pageName).toBe('Test Page');
    expect(first.blockId).toBe('block-1');
    expect(first.id).toContain('1-');
    expect(first.content).toContain('page: Test Page');
  });

  it('skips empty blocks', async () => {
    (global as any).logseq.Editor.getPageBlocksTree = async () => [
      { content: '', uuid: { $uuid$: 'empty' }, children: [] },
    ];

    await expect(
      embedManager.getEmbeddingsAllNotes(mockConfig, { maxChunkSize: 10 }),
    ).rejects.toThrow(/No embeddings were generated/);
  });
});
