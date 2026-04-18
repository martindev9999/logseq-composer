import { describe, expect, it } from 'vitest';
import { VectorSearchAccelerator } from './VectorSearchAccelerator';

/** Minimal stub satisfying the `store` field of VectorSearchAcceleratorConfig. */
const fakeStore = {} as any;

/**
 * Helper: creates an accelerator whose internal state is set up as if
 * an index of the given dimension is ready, without actually loading WASM.
 */
function createReadyAccelerator(dimension: number): VectorSearchAccelerator {
  const acc = new VectorSearchAccelerator({ store: fakeStore });
  // Poke private fields to simulate a ready index
  (acc as any).indexReady = true;
  (acc as any).dimension = dimension;
  // Provide a minimal index stub so the early guard doesn't bail out
  (acc as any).index = {};
  return acc;
}

describe('VectorSearchAccelerator – constructor & state', () => {
  it('creates an instance with default config values', () => {
    const acc = new VectorSearchAccelerator({ store: fakeStore });
    expect(acc).toBeInstanceOf(VectorSearchAccelerator);
  });

  it('isReady is false before initialization', () => {
    const acc = new VectorSearchAccelerator({ store: fakeStore });
    expect(acc.isReady).toBe(false);
  });

  it('accepts custom HNSW parameters via config', () => {
    // Constructing with custom values should not throw
    const acc = new VectorSearchAccelerator({
      store: fakeStore,
      m: 32,
      efConstruction: 400,
      efSearch: 128,
      tombstoneRebuildThreshold: 0.3,
      capacityGrowthFactor: 2.0,
    });
    expect(acc.isReady).toBe(false);
  });

  it('merges defaults for omitted optional config fields', () => {
    // Partial config — only store provided, rest should use defaults.
    // We can't directly inspect private fields, but construction should succeed
    // and isReady should be false (index not yet built).
    const acc = new VectorSearchAccelerator({ store: fakeStore });
    expect(acc.isReady).toBe(false);
  });
});


describe('VectorSearchAccelerator – dimension mismatch detection', () => {
  it('sets indexReady to false and triggers rebuild when embedding dimension changes', () => {
    const acc = createReadyAccelerator(1536);

    // Spy on rebuild to verify it's called (fire-and-forget)
    const rebuildSpy = vi.spyOn(acc as any, 'rebuild').mockResolvedValue(undefined);

    // Add a vector with a different dimension (768 instead of 1536)
    acc.addVectors([{ id: 'doc-1', content: 'hello', embedding: new Array(768).fill(0.1) }]);

    expect(acc.isReady).toBe(false);
    expect(rebuildSpy).toHaveBeenCalledOnce();
    expect(rebuildSpy).toHaveBeenCalledWith('dimension change: 1536 → 768');
  });

  it('does not trigger rebuild when embedding dimension matches', () => {
    const acc = createReadyAccelerator(4);

    // Stub index methods used during normal addVectors flow
    const stubIndex = {
      markDelete: vi.fn(),
      addPoint: vi.fn(),
    };
    (acc as any).index = stubIndex;

    const rebuildSpy = vi.spyOn(acc as any, 'rebuild').mockResolvedValue(undefined);

    acc.addVectors([{ id: 'doc-1', content: 'hello', embedding: [0.1, 0.2, 0.3, 0.4] }]);

    expect(acc.isReady).toBe(true);
    expect(rebuildSpy).not.toHaveBeenCalled();
  });

  it('returns early without processing documents on dimension mismatch', () => {
    const acc = createReadyAccelerator(4);

    const stubIndex = {
      markDelete: vi.fn(),
      addPoint: vi.fn(),
    };
    (acc as any).index = stubIndex;

    vi.spyOn(acc as any, 'rebuild').mockResolvedValue(undefined);

    // Dimension mismatch: 4 vs 8
    acc.addVectors([{ id: 'doc-1', content: 'hello', embedding: new Array(8).fill(0.1) }]);

    // addPoint should NOT have been called — we returned early
    expect(stubIndex.addPoint).not.toHaveBeenCalled();
  });

  it('skips dimension check when docs array is empty', () => {
    const acc = createReadyAccelerator(4);

    const rebuildSpy = vi.spyOn(acc as any, 'rebuild').mockResolvedValue(undefined);

    // Empty array — should not trigger rebuild or error
    acc.addVectors([]);

    expect(acc.isReady).toBe(true);
    expect(rebuildSpy).not.toHaveBeenCalled();
  });
});


describe('VectorSearchAccelerator – dispose', () => {
  it('sets isReady to false after dispose', () => {
    const acc = createReadyAccelerator(4);
    expect(acc.isReady).toBe(true);

    acc.dispose();

    expect(acc.isReady).toBe(false);
  });

  it('nulls the index reference', () => {
    const acc = createReadyAccelerator(4);
    expect((acc as any).index).not.toBeNull();

    acc.dispose();

    expect((acc as any).index).toBeNull();
  });

  it('clears all internal maps and resets counters', () => {
    const acc = createReadyAccelerator(4);
    // Populate maps to simulate a built index
    (acc as any).idToLabel.set('doc-1', 0);
    (acc as any).labelToId.set(0, 'doc-1');
    (acc as any).contentCache.set('doc-1', 'content');
    (acc as any).nextLabel = 5;
    (acc as any).deletedCount = 2;
    (acc as any).totalCapacity = 10;

    acc.dispose();

    expect((acc as any).idToLabel.size).toBe(0);
    expect((acc as any).labelToId.size).toBe(0);
    expect((acc as any).contentCache.size).toBe(0);
    expect((acc as any).nextLabel).toBe(0);
    expect((acc as any).deletedCount).toBe(0);
    expect((acc as any).totalCapacity).toBe(0);
    expect((acc as any).dimension).toBe(0);
  });

  it('falls back to brute-force search after dispose', async () => {
    const mockResults = [{ id: 'bf-1', content: 'brute force', score: 0.9 }];
    const store = { searchByVector: vi.fn().mockResolvedValue(mockResults) } as any;
    const acc = new VectorSearchAccelerator({ store });

    // Simulate a ready index then dispose
    (acc as any).indexReady = true;
    (acc as any).index = {};
    acc.dispose();

    const results = await acc.searchByVector([0.1, 0.2], 5, 0.5);

    expect(store.searchByVector).toHaveBeenCalledWith([0.1, 0.2], 5, 0.5);
    expect(results).toEqual(mockResults);
  });
});


describe('VectorSearchAccelerator – WASM load failure handling', () => {
  it('keeps indexReady false when WASM loading throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = {
      getAllEmbeddings: vi.fn().mockReturnValue([]),
      searchByVector: vi.fn().mockResolvedValue([]),
    } as any;

    const acc = new VectorSearchAccelerator({ store });
    expect(acc.isReady).toBe(false);

    // Simulate what happens when the dynamic import('hnswlib-wasm') throws
    // by directly calling initialize logic that catches the error.
    // We re-import the module fresh with a mock that throws.
    vi.doMock('hnswlib-wasm', () => ({
      loadHnswlib: () => { throw new Error('WASM binary failed to load'); },
    }));

    // Re-import the class so it picks up the mocked module
    const { VectorSearchAccelerator: FreshAccelerator } = await import('./VectorSearchAccelerator');
    const acc2 = new FreshAccelerator({ store });
    await acc2.initialize();

    expect(acc2.isReady).toBe(false);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    vi.doUnmock('hnswlib-wasm');
  });

  it('falls back to brute-force search when WASM fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.doMock('hnswlib-wasm', () => ({
      loadHnswlib: () => { throw new Error('WASM binary failed to load'); },
    }));

    const bruteForceResults = [
      { id: 'doc-1', content: 'brute force result', score: 0.85 },
    ];
    const store = {
      getAllEmbeddings: vi.fn().mockReturnValue([]),
      searchByVector: vi.fn().mockResolvedValue(bruteForceResults),
    } as any;

    const { VectorSearchAccelerator: FreshAccelerator } = await import('./VectorSearchAccelerator');
    const acc = new FreshAccelerator({ store });
    await acc.initialize();

    // Index should not be ready after WASM failure
    expect(acc.isReady).toBe(false);

    const results = await acc.searchByVector([0.1, 0.2, 0.3], 5, 0.5);

    expect(store.searchByVector).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5, 0.5);
    expect(results).toEqual(bruteForceResults);

    vi.doUnmock('hnswlib-wasm');
    vi.restoreAllMocks();
  });
});


describe('VectorSearchAccelerator – empty store initialization', () => {
  it('sets indexReady to true with an empty store', async () => {
    vi.restoreAllMocks();
    // Clear any previous mocks of hnswlib-wasm
    vi.unmock('hnswlib-wasm');

    vi.spyOn(console, 'info').mockImplementation(() => {});

    const store = {
      getAllEmbeddings: vi.fn().mockReturnValue([]),
      searchByVector: vi.fn().mockResolvedValue([]),
    } as any;

    const acc = new VectorSearchAccelerator({ store });
    expect(acc.isReady).toBe(false);

    await acc.initialize();

    expect(acc.isReady).toBe(true);

    vi.restoreAllMocks();
  });
});


describe('VectorSearchAccelerator – isReady state transitions', () => {
  it('transitions from false to true during construction', async () => {
    vi.restoreAllMocks();
    vi.unmock('hnswlib-wasm');

    vi.spyOn(console, 'info').mockImplementation(() => {});

    const store = {
      getAllEmbeddings: vi.fn().mockReturnValue([]),
      searchByVector: vi.fn().mockResolvedValue([]),
    } as any;

    const acc = new VectorSearchAccelerator({ store });

    // Before initialization: false
    expect(acc.isReady).toBe(false);

    await acc.initialize();

    // After initialization: true
    expect(acc.isReady).toBe(true);

    vi.restoreAllMocks();
  });
});


describe('VectorSearchAccelerator – SearchResult format compatibility with mergeWithRRF', () => {
  it('returns results with id (string), content (string), and score (number) fields', async () => {
    vi.restoreAllMocks();
    vi.unmock('hnswlib-wasm');

    vi.spyOn(console, 'info').mockImplementation(() => {});

    // Create a 4-dimensional embedding as Uint8Array (Float32)
    const makeEmbeddingBlob = (values: number[]): Uint8Array => {
      const f32 = new Float32Array(values);
      return new Uint8Array(f32.buffer);
    };

    const store = {
      getAllEmbeddings: vi.fn().mockReturnValue([
        { id: 'doc-1', content: 'Hello world', embedding: makeEmbeddingBlob([0.5, 0.5, 0.5, 0.5]) },
        { id: 'doc-2', content: 'Goodbye world', embedding: makeEmbeddingBlob([0.1, 0.2, 0.3, 0.4]) },
      ]),
      searchByVector: vi.fn().mockResolvedValue([]),
    } as any;

    const acc = new VectorSearchAccelerator({ store });
    await acc.initialize();

    expect(acc.isReady).toBe(true);

    // Search with a query vector close to doc-1
    const results = await acc.searchByVector([0.5, 0.5, 0.5, 0.5], 5, 0);

    expect(results.length).toBeGreaterThan(0);

    for (const result of results) {
      // Verify each field exists and has the correct type
      expect(typeof result.id).toBe('string');
      expect(typeof result.content).toBe('string');
      expect(typeof result.score).toBe('number');

      // Verify score is in valid range [0, 1]
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }

    // Verify the results are compatible with mergeWithRRF's SearchHit interface
    // mergeWithRRF expects: { id: string, content: string, score: number }
    const firstResult = results[0];
    expect(firstResult).toHaveProperty('id');
    expect(firstResult).toHaveProperty('content');
    expect(firstResult).toHaveProperty('score');

    vi.restoreAllMocks();
  });
});


describe('VectorSearchAccelerator – invalid embedding BLOBs', () => {
  it('skips documents with invalid embedding byte lengths and indexes valid ones', async () => {
    vi.restoreAllMocks();
    vi.unmock('hnswlib-wasm');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const makeEmbeddingBlob = (values: number[]): Uint8Array => {
      const f32 = new Float32Array(values);
      return new Uint8Array(f32.buffer);
    };

    // Create an invalid BLOB: 5 bytes (not divisible by 4)
    const invalidBlob = new Uint8Array(5);

    // Create another invalid BLOB: 7 bytes
    const invalidBlob2 = new Uint8Array(7);

    const store = {
      getAllEmbeddings: vi.fn().mockReturnValue([
        { id: 'valid-1', content: 'Valid document one', embedding: makeEmbeddingBlob([0.5, 0.5, 0.5, 0.5]) },
        { id: 'invalid-1', content: 'Invalid document', embedding: invalidBlob },
        { id: 'valid-2', content: 'Valid document two', embedding: makeEmbeddingBlob([0.1, 0.2, 0.3, 0.4]) },
        { id: 'invalid-2', content: 'Another invalid', embedding: invalidBlob2 },
      ]),
      searchByVector: vi.fn().mockResolvedValue([]),
    } as any;

    const acc = new VectorSearchAccelerator({ store });
    await acc.initialize();

    expect(acc.isReady).toBe(true);

    // Verify warnings were logged for invalid BLOBs
    const warnCalls = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('invalid byte length')
    );
    expect(warnCalls.length).toBe(2);
    expect(warnCalls[0][0]).toContain('invalid-1');
    expect(warnCalls[1][0]).toContain('invalid-2');

    // Verify valid documents are searchable
    const results = await acc.searchByVector([0.5, 0.5, 0.5, 0.5], 5, 0);
    const resultIds = results.map((r) => r.id);

    expect(resultIds).toContain('valid-1');
    expect(resultIds).toContain('valid-2');
    expect(resultIds).not.toContain('invalid-1');
    expect(resultIds).not.toContain('invalid-2');

    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });
});
