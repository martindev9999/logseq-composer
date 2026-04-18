import * as fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentRecord, PerDocumentStorageProvider, SearchResult } from './storage/StorageProvider';

const mockGetEmbeddingsForPage = vi.fn();
const mockFetchBacklinks = vi.fn();
const mockExtractOutgoingLinks = vi.fn();

// Mock using source-relative paths (vite-tsconfig-paths resolves bare specifiers)
vi.mock('./embedManager', () => ({
  DEFAULT_EMBEDDING_MODEL: 'text-embedding-3-small',
  extractOutgoingLinks: (...args: any[]) => mockExtractOutgoingLinks(...args),
  fetchBacklinks: (...args: any[]) => mockFetchBacklinks(...args),
  getEmbeddingsForPage: (...args: any[]) => mockGetEmbeddingsForPage(...args),
  PageLinkData: {},
}));

vi.mock('./VectorDBManager', () => ({
  batchInsertEmbeddings: vi.fn().mockResolvedValue(undefined),
  OramaInstance: {},
}));

vi.mock('@orama/orama', () => ({
  getByID: vi.fn(),
  remove: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import initSqlJs from 'sql.js';
import { _resetIndexingState, checkAndIndexUpdatedPages, getIndexingProgress, requestPauseIndexing } from './indexManager';
import { SQLiteVectorStore } from './storage/SQLiteVectorStore';

// Reset module-level indexing state between every test to prevent
// the indexingInProgress flag from leaking across fast-check iterations.
afterEach(() => {
  _resetIndexingState();
});

const BATCH_SIZE = 5;

/**
 * Feature: reindex-main-thread-blocking, Property 1: Bug Condition
 * Per-Page Double Flush and No Yielding During Bulk Reindex
 *
 * **Validates: Requirements 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4**
 *
 * This test is EXPECTED TO FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT attempt to fix the test or the code when it fails.
 */
describe('Property 1: Bug Condition - Per-Page Double Flush and No Yielding During Bulk Reindex', () => {
  let flushCount: number;
  let yieldCount: number;
  let setTimeoutSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    flushCount = 0;
    yieldCount = 0;

    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockExtractOutgoingLinks.mockReturnValue([]);
    mockFetchBacklinks.mockResolvedValue([]);
    mockGetEmbeddingsForPage.mockImplementation(
      (pageId: string, _blocks: any[], _pageName: string, lastUpdated: number) => {
        return Promise.resolve({
          embeddings: [{ id: pageId, content: 'test', lastUpdated, embedding: [0.1] }],
          blockMetadata: [],
        });
      }
    );

    (globalThis as any).logseq = {
      Editor: {
        getAllPages: vi.fn(),
        getPageBlocksTree: vi.fn().mockResolvedValue([{ content: 'test', children: [] }]),
        getPageLinkedReferences: vi.fn().mockResolvedValue([]),
      },
      DB: { onChanged: vi.fn() },
      baseInfo: { path: '' },
    };

    // Spy on setTimeout to count event loop yields (calls with delay === 0).
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).logseq;
    vi.restoreAllMocks();
    mockGetEmbeddingsForPage.mockReset();
    mockFetchBacklinks.mockReset();
    mockExtractOutgoingLinks.mockReset();
  });

  function createMockStorageProvider(): PerDocumentStorageProvider {
    let bulkMode = false;
    return {
      upsertDocuments: vi.fn().mockImplementation(async (_docs: DocumentRecord[]) => {
        // In bulk mode, upsert does NOT flush — mirrors real SQLiteVectorStore behavior
        if (!bulkMode) {
          flushCount++;
        }
      }),
      deleteDocuments: vi.fn().mockImplementation(async (_ids: string[]) => {
        // In bulk mode, delete does NOT flush — mirrors real SQLiteVectorStore behavior
        if (!bulkMode) {
          flushCount++;
        }
      }),
      searchByVector: vi.fn().mockResolvedValue([] as SearchResult[]),
      getDocumentMeta: vi.fn().mockResolvedValue(null),
      getAllDocumentContent: vi.fn().mockReturnValue([]),
      clear: vi.fn().mockResolvedValue(undefined),
      beginBulk: vi.fn().mockImplementation(() => { bulkMode = true; }),
      endBulk: vi.fn().mockImplementation(() => { bulkMode = false; }),
      persistToIndexedDB: vi.fn().mockImplementation(async () => { flushCount++; }),
    };
  }

  function generatePages(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      name: `page_${i}`,
      uuid: `uuid-${i}`,
      updatedAt: Date.now(),
    }));
  }

  it('flush count is bounded by ceil(N / batchSize) + 1 and yields occur between batches', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 50 }),
        async (pageCount) => {
          flushCount = 0;
          setTimeoutSpy.mockClear();

          const pages = generatePages(pageCount);
          (globalThis as any).logseq.Editor.getAllPages.mockResolvedValue(pages);

          const mockProvider = createMockStorageProvider();

          await checkAndIndexUpdatedPages(
            'test-api-key',
            undefined,
            'test-embedding-key',
            'text-embedding-3-small',
            mockProvider
          );

          // Count setTimeout calls with delay === 0 (event loop yields)
          yieldCount = setTimeoutSpy.mock.calls.filter(
            (call: any[]) => call[1] === 0
          ).length;

          // Advance timers to clear the 1-second indexingInProgress cooldown
          await vi.advanceTimersByTimeAsync(1500);

          const expectedMaxFlushes = Math.ceil(pageCount / BATCH_SIZE) + 1;
          const expectedMinYields = Math.floor(pageCount / BATCH_SIZE);

          // Unfixed: flushCount = 2 * pageCount (double flush per page)
          // Expected: flushCount <= ceil(pageCount / BATCH_SIZE) + 1
          expect(flushCount).toBeLessThanOrEqual(expectedMaxFlushes);

          // Unfixed: yieldCount = 0 (no yielding in tight loop)
          // Expected: yieldCount >= floor(pageCount / BATCH_SIZE)
          expect(yieldCount).toBeGreaterThanOrEqual(expectedMinYields);
        }
      ),
      { numRuns: 20 }
    );
  });
});


/**
 * Helper: create a SQLiteVectorStore backed by an in-memory sql.js database,
 * bypassing IndexedDB and logseq globals entirely.
 * (Same pattern as in src/storage/SQLiteVectorStore.test.ts)
 */
async function createInMemoryStore(): Promise<SQLiteVectorStore> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)');
  db.run(
    `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      lastUpdated INTEGER NOT NULL,
      embedding BLOB NOT NULL
    )`
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS block_metadata (
      uuid TEXT PRIMARY KEY,
      pageName TEXT NOT NULL,
      contentPreview TEXT NOT NULL
    )`
  );

  const store = new SQLiteVectorStore('test-graph');
  (store as any)._db = db;
  // Stub flushWithRetry to no-op (no IndexedDB in tests)
  (store as any).flushWithRetry = async () => {};
  return store;
}

/**
 * Feature: reindex-main-thread-blocking, Property 2: Preservation
 * Incremental Single-Page Indexing Flushes Immediately
 *
 * **Validates: Requirements 3.1, 3.6**
 *
 * Observes that on UNFIXED code, each upsertDocuments and deleteDocuments call
 * triggers exactly one flushWithRetry call (immediate persistence).
 */
describe('Preservation Property 2a: Incremental flush - upsertDocuments and deleteDocuments each trigger exactly one flushWithRetry', () => {
  let store: SQLiteVectorStore;

  beforeEach(async () => {
    store = await createInMemoryStore();
  });

  afterEach(() => {
    const db = store.db;
    if (db) db.close();
  });

  const documentRecordArb: fc.Arbitrary<DocumentRecord> = fc.record({
    id: fc.stringMatching(/^\w{1,50}$/),
    content: fc.string({ minLength: 1, maxLength: 100 }),
    lastUpdated: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    embedding: fc.array(
      fc.double({ min: -1e3, max: 1e3, noNaN: true, noDefaultInfinity: true }),
      { minLength: 4, maxLength: 4 }
    ),
  });

  it('each upsertDocuments call triggers exactly one flushWithRetry, each deleteDocuments call triggers exactly one flushWithRetry', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(documentRecordArb, { minLength: 1, maxLength: 5 }),
        async (docs) => {
          // Clear store between iterations
          await store.clear();

          let flushCount = 0;
          // Replace the no-op stub with a counting version
          (store as any).flushWithRetry = async () => {
            flushCount++;
          };

          // Upsert documents — should trigger exactly one flushWithRetry
          flushCount = 0;
          await store.upsertDocuments(docs);
          expect(flushCount).toBe(1);

          // Delete documents — should trigger exactly one flushWithRetry
          flushCount = 0;
          const ids = docs.map(d => d.id);
          await store.deleteDocuments(ids);
          expect(flushCount).toBe(1);
        }
      ),
      { numRuns: 50 }
    );
  });
});

/**
 * Feature: reindex-main-thread-blocking, Property 2: Preservation
 * Search Correctness After Indexing
 *
 * **Validates: Requirements 3.2**
 *
 * Observes that searchByVector returns results sorted descending by score,
 * all above threshold, and limited to the requested count.
 */
describe('Preservation Property 2b: Search correctness - results sorted descending, above threshold, limited to count', () => {
  let store: SQLiteVectorStore;

  beforeEach(async () => {
    store = await createInMemoryStore();
    // Stub flushWithRetry to no-op for search tests (no IndexedDB)
    (store as any).flushWithRetry = async () => {};
  });

  afterEach(() => {
    const db = store.db;
    if (db) db.close();
  });

  const documentSetArb = fc
    .integer({ min: 3, max: 10 })
    .chain((count) =>
      fc.tuple(
        fc.array(
          fc.record({
            id: fc.stringMatching(/^\w{1,50}$/),
            content: fc.string({ minLength: 1, maxLength: 100 }),
            lastUpdated: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
            embedding: fc.array(
              fc.double({ min: -1e3, max: 1e3, noNaN: true, noDefaultInfinity: true }),
              { minLength: 4, maxLength: 4 }
            ),
          }),
          { minLength: count, maxLength: count }
        ),
        // Random query vector
        fc.array(
          fc.double({ min: -1e3, max: 1e3, noNaN: true, noDefaultInfinity: true }),
          { minLength: 4, maxLength: 4 }
        ),
        // Random limit (1-10)
        fc.integer({ min: 1, max: 10 }),
        // Random threshold (0.0-1.0)
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })
      )
    )
    .map(([docs, queryVector, limit, threshold]) => {
      // Ensure unique ids by appending index
      const uniqueDocs = docs.map((doc, i) => ({
        ...doc,
        id: `${doc.id}_${i}`,
      }));
      return { docs: uniqueDocs, queryVector, limit, threshold };
    });

  it('search results are sorted descending by score, all scores >= threshold, and count <= limit', async () => {
    await fc.assert(
      fc.asyncProperty(documentSetArb, async ({ docs, queryVector, limit, threshold }) => {
        await store.clear();

        await store.upsertDocuments(docs);

        const results = await store.searchByVector(queryVector, limit, threshold);

        // All scores >= threshold
        for (const result of results) {
          expect(result.score).toBeGreaterThanOrEqual(threshold);
        }

        // Results sorted descending by score
        for (let i = 1; i < results.length; i++) {
          expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
        }

        // Count <= limit
        expect(results.length).toBeLessThanOrEqual(limit);
      }),
      { numRuns: 50 }
    );
  });
});

/**
 * Feature: reindex-main-thread-blocking, Property 2: Preservation
 * Pause Behavior - requestPauseIndexing stops indexing at next page boundary
 *
 * **Validates: Requirements 3.3**
 *
 * Observes that when requestPauseIndexing is called during page P's processing,
 * indexing stops after processing at most P+1 pages.
 */
describe('Preservation Property 2c: Pause behavior - indexing stops after at most P+1 pages when paused at page P', () => {
  let upsertCallCount: number;

  beforeEach(() => {
    upsertCallCount = 0;

    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockExtractOutgoingLinks.mockReturnValue([]);
    mockFetchBacklinks.mockResolvedValue([]);
    mockGetEmbeddingsForPage.mockImplementation(
      (pageId: string, _blocks: any[], _pageName: string, lastUpdated: number) => {
        return Promise.resolve({
          embeddings: [{ id: pageId, content: 'test', lastUpdated, embedding: [0.1] }],
          blockMetadata: [],
        });
      }
    );

    (globalThis as any).logseq = {
      Editor: {
        getAllPages: vi.fn(),
        getPageBlocksTree: vi.fn().mockResolvedValue([{ content: 'test', children: [] }]),
        getPageLinkedReferences: vi.fn().mockResolvedValue([]),
      },
      DB: { onChanged: vi.fn() },
      baseInfo: { path: '' },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).logseq;
    vi.restoreAllMocks();
    mockGetEmbeddingsForPage.mockReset();
    mockFetchBacklinks.mockReset();
    mockExtractOutgoingLinks.mockReset();
  });

  function generatePages(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      name: `page_${i}`,
      uuid: `uuid-${i}`,
      updatedAt: Date.now(),
    }));
  }

  it('indexing stops after at most P+1 pages when pause is requested at page P', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 30 }).chain((n) =>
          fc.tuple(
            fc.constant(n),
            fc.integer({ min: 1, max: n - 1 }) // pause at page P (1-indexed, 0 < P < N)
          )
        ),
        async ([pageCount, pauseAtPage]) => {
          upsertCallCount = 0;

          const pages = generatePages(pageCount);
          (globalThis as any).logseq.Editor.getAllPages.mockResolvedValue(pages);

          const mockProvider: PerDocumentStorageProvider = {
            upsertDocuments: vi.fn().mockImplementation(async (_docs: DocumentRecord[]) => {
              upsertCallCount++;
              // When we've processed pauseAtPage pages, request pause
              if (upsertCallCount === pauseAtPage) {
                requestPauseIndexing();
              }
            }),
            deleteDocuments: vi.fn().mockResolvedValue(undefined),
            searchByVector: vi.fn().mockResolvedValue([] as SearchResult[]),
            getDocumentMeta: vi.fn().mockResolvedValue(null),
            getAllDocumentContent: vi.fn().mockReturnValue([]),
            clear: vi.fn().mockResolvedValue(undefined),
          };

          await checkAndIndexUpdatedPages(
            'test-api-key',
            undefined,
            'test-embedding-key',
            'text-embedding-3-small',
            mockProvider
          );

          // Advance timers to clear the 1-second indexingInProgress cooldown
          await vi.advanceTimersByTimeAsync(1500);

          // Pause was requested during page P's upsert.
          // The loop checks _pauseRequested at the START of each iteration,
          // so the current page (P) finishes, and the next page (P+1) may also
          // start before the check fires. At most P+1 pages should be processed.
          expect(upsertCallCount).toBeLessThanOrEqual(pauseAtPage + 1);
          // At least pauseAtPage pages must have been processed (we triggered pause at that count)
          expect(upsertCallCount).toBeGreaterThanOrEqual(pauseAtPage);
        }
      ),
      { numRuns: 20 }
    );
  });
});


/**
 * Feature: indexing-status-feedback, Property 2: Paused indexing returns correct outcome and page count
 *
 * **Validates: Requirements 1.2, 1.5**
 *
 * For any list of non-internal stale Logseq pages and any pause point,
 * when requestPauseIndexing() is called during page N's processing,
 * the returned IndexingResult SHALL have outcome === 'paused' and
 * pagesProcessed SHALL equal the number of pages processed before the loop stopped.
 */
describe('Feature: indexing-status-feedback, Property 2: Paused indexing returns correct outcome and page count', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockExtractOutgoingLinks.mockReturnValue([]);
    mockFetchBacklinks.mockResolvedValue([]);
    mockGetEmbeddingsForPage.mockImplementation(
      (pageId: string, _blocks: any[], _pageName: string, lastUpdated: number) => {
        return Promise.resolve({
          embeddings: [{ id: pageId, content: 'test', lastUpdated, embedding: [0.1] }],
          blockMetadata: [],
        });
      }
    );

    (globalThis as any).logseq = {
      Editor: {
        getAllPages: vi.fn(),
        getPageBlocksTree: vi.fn().mockResolvedValue([{ content: 'test', children: [] }]),
        getPageLinkedReferences: vi.fn().mockResolvedValue([]),
      },
      DB: { onChanged: vi.fn() },
      baseInfo: { path: '' },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).logseq;
    vi.restoreAllMocks();
    mockGetEmbeddingsForPage.mockReset();
    mockFetchBacklinks.mockReset();
    mockExtractOutgoingLinks.mockReset();
  });

  it('outcome is paused and pagesProcessed equals pages processed before pause', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate page count (3–30) then a pause point (1..pageCount-1)
        fc.integer({ min: 3, max: 30 }).chain((n) =>
          fc.tuple(
            fc.constant(n),
            fc.integer({ min: 1, max: n - 1 })
          )
        ),
        async ([pageCount, pauseAtPage]) => {
          // Build non-internal stale pages (all prefixed with 'ext_' to avoid isInternalPage)
          const pages = Array.from({ length: pageCount }, (_, i) => ({
            id: i + 1,
            name: `ext_page_${i}`,
            uuid: `uuid-${i}`,
            updatedAt: Date.now(),
          }));

          (globalThis as any).logseq.Editor.getAllPages.mockResolvedValue(pages);

          let upsertCallCount = 0;

          const mockProvider: PerDocumentStorageProvider = {
            upsertDocuments: vi.fn().mockImplementation(async (_docs: DocumentRecord[]) => {
              upsertCallCount++;
              // Request pause after processing pauseAtPage pages
              if (upsertCallCount === pauseAtPage) {
                requestPauseIndexing();
              }
            }),
            deleteDocuments: vi.fn().mockResolvedValue(undefined),
            searchByVector: vi.fn().mockResolvedValue([] as SearchResult[]),
            getDocumentMeta: vi.fn().mockResolvedValue(null), // all pages are stale
            getAllDocumentContent: vi.fn().mockReturnValue([]),
            clear: vi.fn().mockResolvedValue(undefined),
            beginBulk: vi.fn(),
            endBulk: vi.fn(),
            persistToIndexedDB: vi.fn().mockResolvedValue(undefined),
          };

          const result = await checkAndIndexUpdatedPages(
            'test-api-key',
            undefined,
            'test-embedding-key',
            'text-embedding-3-small',
            mockProvider
          );

          // Advance timers to clear the 1-second indexingInProgress cooldown
          await vi.advanceTimersByTimeAsync(1500);

          // The pause check happens at the START of each loop iteration.
          // We request pause during page N's upsert (after _pagesProcessed is incremented).
          // The next iteration sees _pauseRequested and breaks before processing page N+1.
          // So pagesProcessed should equal exactly pauseAtPage.
          expect(result.outcome).toBe('paused');
          expect(result.pagesProcessed).toBe(pauseAtPage);
        }
      ),
      { numRuns: 100 }
    );
  }, 30_000);
});


/**
 * Feature: indexing-status-feedback, Property 1: Completed indexing returns correct outcome and page count
 *
 * **Validates: Requirements 1.1, 1.5**
 *
 * For any list of Logseq pages (with varying internal/external pages and
 * up-to-date/stale timestamps), when checkAndIndexUpdatedPages runs to
 * completion without pause or unrecoverable error, the returned IndexingResult
 * SHALL have outcome === 'completed' and pagesProcessed SHALL equal the number
 * of non-internal, stale pages that were actually processed.
 */
describe('Feature: indexing-status-feedback, Property 1: Completed indexing returns correct outcome and page count', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockExtractOutgoingLinks.mockReturnValue([]);
    mockFetchBacklinks.mockResolvedValue([]);
    mockGetEmbeddingsForPage.mockImplementation(
      (pageId: string, _blocks: any[], _pageName: string, lastUpdated: number) => {
        return Promise.resolve({
          embeddings: [{ id: pageId, content: 'test', lastUpdated, embedding: [0.1] }],
          blockMetadata: [],
        });
      }
    );

    (globalThis as any).logseq = {
      Editor: {
        getAllPages: vi.fn(),
        getPageBlocksTree: vi.fn().mockResolvedValue([{ content: 'test', children: [] }]),
        getPageLinkedReferences: vi.fn().mockResolvedValue([]),
      },
      DB: { onChanged: vi.fn() },
      baseInfo: { path: '' },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).logseq;
    vi.restoreAllMocks();
    mockGetEmbeddingsForPage.mockReset();
    mockFetchBacklinks.mockReset();
    mockExtractOutgoingLinks.mockReset();
  });

  /** Internal page name prefixes/exact matches from isInternalPage in indexManager.ts */
  const INTERNAL_NAMES = ['card', 'card_review', 'contents', 'contents/sub', 'favorites', 'favorites/sub', '__template', 'journals'];

  /** Arbitrary that produces a page name — either internal or external */
  const pageNameArb = fc.oneof(
    // ~40% internal pages
    { weight: 2, arbitrary: fc.constantFrom(...INTERNAL_NAMES) },
    // ~60% external pages (prefixed with 'ext_' to guarantee non-internal)
    { weight: 3, arbitrary: fc.stringMatching(/^ext_[a-z0-9]{1,20}$/) }
  );

  /** Returns true when a name matches the isInternalPage logic */
  function isInternal(name: string): boolean {
    return name.startsWith('card') ||
           name.startsWith('contents') ||
           name.startsWith('favorites') ||
           name.startsWith('__') ||
           name === 'journals' ||
           name === 'contents' ||
           name === 'favorites';
  }

  /**
   * Arbitrary for a single page entry with:
   * - random name (internal or external)
   * - random updatedAt timestamp
   * - random staleness flag (true = stale, false = up-to-date)
   */
  const pageEntryArb = fc.record({
    name: pageNameArb,
    updatedAt: fc.integer({ min: 1, max: 1_000_000_000 }),
    isStale: fc.boolean(),
  });

  it('outcome is completed and pagesProcessed equals non-internal stale page count', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(pageEntryArb, { minLength: 0, maxLength: 30 }),
        async (pageEntries) => {
          // Build the page list with unique IDs
          const pages = pageEntries.map((entry, i) => ({
            id: i + 1,
            name: entry.name,
            uuid: `uuid-${i}`,
            updatedAt: entry.updatedAt,
          }));

          // Build a map of pageId -> stored lastUpdated for getDocumentMeta
          const storedTimestamps = new Map<string, number | null>();
          for (let i = 0; i < pageEntries.length; i++) {
            const entry = pageEntries[i];
            const pageIdStr = (i + 1).toString();
            if (entry.isStale) {
              // Stale: stored timestamp is less than updatedAt (or null for never-indexed)
              storedTimestamps.set(pageIdStr, entry.updatedAt > 1 ? entry.updatedAt - 1 : null);
            } else {
              // Up-to-date: stored timestamp >= updatedAt
              storedTimestamps.set(pageIdStr, entry.updatedAt);
            }
          }

          // Calculate expected pagesProcessed: non-internal AND stale
          const expectedProcessed = pageEntries.filter(
            (entry) => !isInternal(entry.name) && entry.isStale
          ).length;

          (globalThis as any).logseq.Editor.getAllPages.mockResolvedValue(pages);

          const mockProvider: PerDocumentStorageProvider = {
            upsertDocuments: vi.fn().mockResolvedValue(undefined),
            deleteDocuments: vi.fn().mockResolvedValue(undefined),
            searchByVector: vi.fn().mockResolvedValue([] as SearchResult[]),
            getDocumentMeta: vi.fn().mockImplementation(async (pageId: string) => {
              return storedTimestamps.get(pageId) ?? null;
            }),
            getAllDocumentContent: vi.fn().mockReturnValue([]),
            clear: vi.fn().mockResolvedValue(undefined),
            beginBulk: vi.fn(),
            endBulk: vi.fn(),
            persistToIndexedDB: vi.fn().mockResolvedValue(undefined),
          };

          const result = await checkAndIndexUpdatedPages(
            'test-api-key',
            undefined,
            'test-embedding-key',
            'text-embedding-3-small',
            mockProvider
          );

          // Advance timers to clear the 1-second indexingInProgress cooldown
          await vi.advanceTimersByTimeAsync(1500);

          expect(result.outcome).toBe('completed');
          expect(result.pagesProcessed).toBe(expectedProcessed);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: indexing-status-feedback, Property 3: Error indexing returns error outcome with message
 *
 * **Validates: Requirements 1.3**
 *
 * For any unrecoverable error thrown during the indexing loop, the returned
 * IndexingResult SHALL have outcome === 'error' and errorMessage SHALL contain
 * the thrown error's message string.
 */
describe('Feature: indexing-status-feedback, Property 3: Error indexing returns error outcome with message', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockExtractOutgoingLinks.mockReturnValue([]);
    mockFetchBacklinks.mockResolvedValue([]);
    mockGetEmbeddingsForPage.mockImplementation(
      (pageId: string, _blocks: any[], _pageName: string, lastUpdated: number) => {
        return Promise.resolve({
          embeddings: [{ id: pageId, content: 'test', lastUpdated, embedding: [0.1] }],
          blockMetadata: [],
        });
      }
    );

    (globalThis as any).logseq = {
      Editor: {
        getAllPages: vi.fn(),
        getPageBlocksTree: vi.fn().mockResolvedValue([{ content: 'test', children: [] }]),
        getPageLinkedReferences: vi.fn().mockResolvedValue([]),
      },
      DB: { onChanged: vi.fn() },
      baseInfo: { path: '' },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).logseq;
    vi.restoreAllMocks();
    mockGetEmbeddingsForPage.mockReset();
    mockFetchBacklinks.mockReset();
    mockExtractOutgoingLinks.mockReset();
  });

  it('outcome is error and errorMessage contains the thrown error message', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random non-empty error messages
        fc.string({ minLength: 1, maxLength: 200 }),
        async (errorMsg) => {
          // Make getAllPages throw an unrecoverable error with the random message
          (globalThis as any).logseq.Editor.getAllPages.mockRejectedValue(
            new Error(errorMsg)
          );

          const mockProvider: PerDocumentStorageProvider = {
            upsertDocuments: vi.fn().mockResolvedValue(undefined),
            deleteDocuments: vi.fn().mockResolvedValue(undefined),
            searchByVector: vi.fn().mockResolvedValue([] as SearchResult[]),
            getDocumentMeta: vi.fn().mockResolvedValue(null),
            getAllDocumentContent: vi.fn().mockReturnValue([]),
            clear: vi.fn().mockResolvedValue(undefined),
            beginBulk: vi.fn(),
            endBulk: vi.fn(),
            persistToIndexedDB: vi.fn().mockResolvedValue(undefined),
          };

          const result = await checkAndIndexUpdatedPages(
            'test-api-key',
            undefined,
            'test-embedding-key',
            'text-embedding-3-small',
            mockProvider
          );

          // Advance timers to clear the 1-second indexingInProgress cooldown
          await vi.advanceTimersByTimeAsync(1500);

          expect(result.outcome).toBe('error');
          expect(result.errorMessage).toContain(errorMsg);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: indexing-status-feedback, Property 5: Progress getter reflects pages processed so far
 *
 * **Validates: Requirements 6.1, 6.2**
 *
 * For any sequence of N successfully processed pages during an active indexing run,
 * calling getIndexingProgress() after the Kth page (0 ≤ K ≤ N) SHALL return K.
 */
describe('Feature: indexing-status-feedback, Property 5: Progress getter reflects pages processed so far', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockExtractOutgoingLinks.mockReturnValue([]);
    mockFetchBacklinks.mockResolvedValue([]);
    mockGetEmbeddingsForPage.mockImplementation(
      (pageId: string, _blocks: any[], _pageName: string, lastUpdated: number) => {
        return Promise.resolve({
          embeddings: [{ id: pageId, content: 'test', lastUpdated, embedding: [0.1] }],
          blockMetadata: [],
        });
      }
    );

    (globalThis as any).logseq = {
      Editor: {
        getAllPages: vi.fn(),
        getPageBlocksTree: vi.fn().mockResolvedValue([{ content: 'test', children: [] }]),
        getPageLinkedReferences: vi.fn().mockResolvedValue([]),
      },
      DB: { onChanged: vi.fn() },
      baseInfo: { path: '' },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).logseq;
    vi.restoreAllMocks();
    mockGetEmbeddingsForPage.mockReset();
    mockFetchBacklinks.mockReset();
    mockExtractOutgoingLinks.mockReset();
  });

  it('getIndexingProgress() returns K after K pages have been processed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 30 }),
        async (pageCount) => {
          // Build non-internal stale pages
          const pages = Array.from({ length: pageCount }, (_, i) => ({
            id: i + 1,
            name: `ext_page_${i}`,
            uuid: `uuid-${i}`,
            updatedAt: Date.now(),
          }));

          (globalThis as any).logseq.Editor.getAllPages.mockResolvedValue(pages);

          // Track progress by hooking into the upsertDocuments mock.
          // In the source, _pagesProcessed++ happens right after upsertDocuments resolves.
          // We use deleteDocuments (called right before upsertDocuments for each page)
          // to observe the progress counter BEFORE the current page is counted.
          const progressAtDelete: number[] = [];

          const mockProvider: PerDocumentStorageProvider = {
            upsertDocuments: vi.fn().mockResolvedValue(undefined),
            deleteDocuments: vi.fn().mockImplementation(async (_ids: string[]) => {
              progressAtDelete.push(getIndexingProgress());
            }),
            searchByVector: vi.fn().mockResolvedValue([] as SearchResult[]),
            getDocumentMeta: vi.fn().mockResolvedValue(null), // all pages are stale
            getAllDocumentContent: vi.fn().mockReturnValue([]),
            clear: vi.fn().mockResolvedValue(undefined),
            beginBulk: vi.fn(),
            endBulk: vi.fn(),
            persistToIndexedDB: vi.fn().mockResolvedValue(undefined),
          };

          const result = await checkAndIndexUpdatedPages(
            'test-api-key',
            undefined,
            'test-embedding-key',
            'text-embedding-3-small',
            mockProvider
          );

          // Advance timers to clear the 1-second indexingInProgress cooldown
          await vi.advanceTimersByTimeAsync(1500);

          expect(result.outcome).toBe('completed');
          expect(result.pagesProcessed).toBe(pageCount);

          // After all pages are processed, progress should equal pageCount
          expect(getIndexingProgress()).toBe(pageCount);

          // Verify intermediate progress: deleteDocuments is called once per page
          // BEFORE upsertDocuments (and thus before _pagesProcessed++).
          // When deleteDocuments is called for the Kth page (0-indexed),
          // K pages have already been fully processed.
          // progressAtDelete[0] = 0 (no pages processed yet)
          // progressAtDelete[1] = 1 (first page processed)
          // progressAtDelete[K] = K
          expect(progressAtDelete.length).toBe(pageCount);
          for (let k = 0; k < progressAtDelete.length; k++) {
            expect(progressAtDelete[k]).toBe(k);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60_000);
});
