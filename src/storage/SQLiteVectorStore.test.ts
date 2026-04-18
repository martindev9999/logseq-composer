import * as fc from 'fast-check';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeEmbedding } from './cosineSimilarity';
import { SQLiteVectorStore } from './SQLiteVectorStore';
import type { DocumentRecord } from './StorageProvider';

/**
 * Helper: create a SQLiteVectorStore backed by an in-memory sql.js database,
 * bypassing IndexedDB and logseq globals entirely.
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
  // Inject the in-memory database directly
  (store as any)._db = db;
  // Stub flushWithRetry to no-op (no IndexedDB in tests)
  (store as any).flushWithRetry = async () => {};

  return store;
}

// Feature: per-document-vector-storage, Property 2: Document upsert round-trip
describe('Property 2: Document upsert round-trip', () => {
  // **Validates: Requirements 2.1, 5.1, 11.2**

  let store: SQLiteVectorStore;

  beforeEach(async () => {
    store = await createInMemoryStore();
  });

  afterEach(() => {
    const db = store.db;
    if (db) db.close();
  });

  /**
   * Arbitrary for a valid DocumentRecord with:
   * - non-empty id (alphanumeric to avoid SQL edge cases)
   * - arbitrary content string
   * - integer lastUpdated timestamp
   * - embedding of length 1536 with finite floats
   */
  const documentRecordArb: fc.Arbitrary<DocumentRecord> = fc.record({
    id: fc.stringMatching(/^\w{1,50}$/),
    content: fc.string({ minLength: 0, maxLength: 200 }),
    lastUpdated: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    embedding: fc.array(
      fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      { minLength: 1536, maxLength: 1536 }
    ),
  });

  it('upserted document can be retrieved with matching fields via getDocumentMeta and searchByVector', async () => {
    await fc.assert(
      fc.asyncProperty(documentRecordArb, async (doc) => {
        // Clear the store between iterations
        await store.clear();

        // Upsert the document
        await store.upsertDocuments([doc]);

        // Verify getDocumentMeta returns the correct lastUpdated
        const meta = await store.getDocumentMeta(doc.id);
        expect(meta).toBe(doc.lastUpdated);

        // Verify searchByVector finds the document with correct id and content.
        // Use the document's own embedding as the query vector (cosine similarity = 1.0).
        const results = await store.searchByVector(doc.embedding, 10, -1);
        const match = results.find((r) => r.id === doc.id);
        expect(match).toBeDefined();
        expect(match!.id).toBe(doc.id);
        expect(match!.content).toBe(doc.content);

        // Verify the embedding round-trips correctly through the BLOB
        const db = store.db!;
        const stmt = db.prepare('SELECT embedding FROM documents WHERE id = ?');
        try {
          stmt.bind([doc.id]);
          expect(stmt.step()).toBe(true);
          const row = stmt.get();
          const blob = row[0] as Uint8Array;
          const decoded = decodeEmbedding(blob);

          expect(decoded.length).toBe(doc.embedding.length);
          for (let i = 0; i < doc.embedding.length; i++) {
            expect(decoded[i]).toBe(Math.fround(doc.embedding[i]));
          }
        } finally {
          stmt.free();
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: per-document-vector-storage, Property 3: Upsert replaces existing document
describe('Property 3: Upsert replaces existing document', () => {
  // **Validates: Requirements 2.2**

  let store: SQLiteVectorStore;

  beforeEach(async () => {
    store = await createInMemoryStore();
  });

  afterEach(() => {
    const db = store.db;
    if (db) db.close();
  });

  /**
   * Arbitrary for a pair of DocumentRecords sharing the same id
   * but with different content, lastUpdated, and embedding.
   */
  const upsertPairArb = fc
    .record({
      id: fc.stringMatching(/^\w{1,50}$/),
      content1: fc.string({ minLength: 0, maxLength: 200 }),
      content2: fc.string({ minLength: 0, maxLength: 200 }),
      lastUpdated1: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      lastUpdated2: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      embedding1: fc.array(
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        { minLength: 1536, maxLength: 1536 }
      ),
      embedding2: fc.array(
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        { minLength: 1536, maxLength: 1536 }
      ),
    })
    .filter(
      (r) =>
        r.content1 !== r.content2 &&
        r.lastUpdated1 !== r.lastUpdated2
    );

  it('upserting a second document with the same id replaces the first', async () => {
    await fc.assert(
      fc.asyncProperty(upsertPairArb, async (pair) => {
        await store.clear();

        const doc1: DocumentRecord = {
          id: pair.id,
          content: pair.content1,
          lastUpdated: pair.lastUpdated1,
          embedding: pair.embedding1,
        };

        const doc2: DocumentRecord = {
          id: pair.id,
          content: pair.content2,
          lastUpdated: pair.lastUpdated2,
          embedding: pair.embedding2,
        };

        // Upsert first, then second
        await store.upsertDocuments([doc1]);
        await store.upsertDocuments([doc2]);

        // getDocumentMeta should return the second document's lastUpdated
        const meta = await store.getDocumentMeta(pair.id);
        expect(meta).toBe(doc2.lastUpdated);

        // searchByVector should return the second document's content
        const results = await store.searchByVector(doc2.embedding, 10, -1);
        const match = results.find((r) => r.id === pair.id);
        expect(match).toBeDefined();
        expect(match!.content).toBe(doc2.content);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: per-document-vector-storage, Property 4: Delete removes document
describe('Property 4: Delete removes document', () => {
  // **Validates: Requirements 3.1**

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
    content: fc.string({ minLength: 0, maxLength: 200 }),
    lastUpdated: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    embedding: fc.array(
      fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      { minLength: 1536, maxLength: 1536 }
    ),
  });

  it('deleting an upserted document causes getDocumentMeta to return null and searchByVector to exclude it', async () => {
    await fc.assert(
      fc.asyncProperty(documentRecordArb, async (doc) => {
        await store.clear();

        // Upsert the document
        await store.upsertDocuments([doc]);

        // Confirm it exists
        const metaBefore = await store.getDocumentMeta(doc.id);
        expect(metaBefore).toBe(doc.lastUpdated);

        // Delete the document
        await store.deleteDocuments([doc.id]);

        // getDocumentMeta should return null
        const metaAfter = await store.getDocumentMeta(doc.id);
        expect(metaAfter).toBeNull();

        // searchByVector should not return the deleted document
        const results = await store.searchByVector(doc.embedding, 10, -1);
        const match = results.find((r) => r.id === doc.id);
        expect(match).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: per-document-vector-storage, Property 6: Search results ordering and threshold filtering
describe('Property 6: Search results ordering and threshold filtering', () => {
  // **Validates: Requirements 4.2, 4.3**

  let store: SQLiteVectorStore;

  beforeEach(async () => {
    store = await createInMemoryStore();
  });

  afterEach(() => {
    const db = store.db;
    if (db) db.close();
  });

  /**
   * Arbitrary for a set of DocumentRecords with unique ids and small embeddings (1536-dim).
   * We generate 3-10 documents per iteration to keep tests fast.
   */
  const documentSetArb = fc
    .integer({ min: 3, max: 10 })
    .chain((count) =>
      fc.tuple(
        fc.array(
          fc.record({
            id: fc.stringMatching(/^\w{1,50}$/),
            content: fc.string({ minLength: 0, maxLength: 100 }),
            lastUpdated: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
            embedding: fc.array(
              fc.double({ min: -1e3, max: 1e3, noNaN: true, noDefaultInfinity: true }),
              { minLength: 1536, maxLength: 1536 }
            ),
          }),
          { minLength: count, maxLength: count }
        ),
        // Random query vector
        fc.array(
          fc.double({ min: -1e3, max: 1e3, noNaN: true, noDefaultInfinity: true }),
          { minLength: 1536, maxLength: 1536 }
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

  it('search results are sorted descending by score, all scores ≥ threshold, and count ≤ limit', async () => {
    await fc.assert(
      fc.asyncProperty(documentSetArb, async ({ docs, queryVector, limit, threshold }) => {
        await store.clear();

        // Upsert all documents
        await store.upsertDocuments(docs);

        // Search with random limit and threshold
        const results = await store.searchByVector(queryVector, limit, threshold);

        // (a) All scores ≥ threshold
        for (const result of results) {
          expect(result.score).toBeGreaterThanOrEqual(threshold);
        }

        // (b) Results sorted descending by score
        for (let i = 1; i < results.length; i++) {
          expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
        }

        // (c) Count ≤ limit
        expect(results.length).toBeLessThanOrEqual(limit);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: tiktoken-chunking, Chunking version kv_store methods
describe('Chunking version methods', () => {
  // **Validates: Requirements 7.2**

  let store: SQLiteVectorStore;

  beforeEach(async () => {
    store = await createInMemoryStore();
  });

  afterEach(() => {
    const db = store.db;
    if (db) db.close();
  });

  it('getChunkingVersion returns null when no version is stored', () => {
    expect(store.getChunkingVersion()).toBeNull();
  });

  it('setChunkingVersion followed by getChunkingVersion returns the set value', () => {
    store.setChunkingVersion('2');
    expect(store.getChunkingVersion()).toBe('2');
  });

  it('setChunkingVersion overwrites a previously set value', () => {
    store.setChunkingVersion('1');
    expect(store.getChunkingVersion()).toBe('1');

    store.setChunkingVersion('2');
    expect(store.getChunkingVersion()).toBe('2');
  });
});

// Feature: clickable-block-references, Block metadata methods
describe('Block metadata methods', () => {
  // **Validates: Requirements 2.1, 2.3, 2.4, 2.5**

  let store: SQLiteVectorStore;

  beforeEach(async () => {
    store = await createInMemoryStore();
  });

  afterEach(() => {
    const db = store.db;
    if (db) db.close();
  });

  it('block_metadata table exists after initialization', () => {
    const db = store.db!;
    const result = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='block_metadata'"
    );
    expect(result.length).toBe(1);
    expect(result[0].values[0][0]).toBe('block_metadata');
  });

  it('upsertBlockMetadata inserts records', () => {
    store.upsertBlockMetadata([
      { uuid: 'aaa-111', pageName: 'Page A', contentPreview: 'Hello world' },
      { uuid: 'bbb-222', pageName: 'Page B', contentPreview: 'Another block' },
    ]);

    const a = store.getBlockMetadata('aaa-111');
    expect(a).toEqual({ pageName: 'Page A', contentPreview: 'Hello world' });

    const b = store.getBlockMetadata('bbb-222');
    expect(b).toEqual({ pageName: 'Page B', contentPreview: 'Another block' });
  });

  it('upsertBlockMetadata updates existing records', () => {
    store.upsertBlockMetadata([
      { uuid: 'aaa-111', pageName: 'Page A', contentPreview: 'Original' },
    ]);

    store.upsertBlockMetadata([
      { uuid: 'aaa-111', pageName: 'Page A Updated', contentPreview: 'Updated preview' },
    ]);

    const result = store.getBlockMetadata('aaa-111');
    expect(result).toEqual({ pageName: 'Page A Updated', contentPreview: 'Updated preview' });
  });

  it('deleteBlockMetadataForPage removes records for a specific page', () => {
    store.upsertBlockMetadata([
      { uuid: 'aaa-111', pageName: 'Page A', contentPreview: 'Block 1' },
      { uuid: 'bbb-222', pageName: 'Page A', contentPreview: 'Block 2' },
      { uuid: 'ccc-333', pageName: 'Page B', contentPreview: 'Block 3' },
    ]);

    store.deleteBlockMetadataForPage('Page A');

    expect(store.getBlockMetadata('aaa-111')).toBeNull();
    expect(store.getBlockMetadata('bbb-222')).toBeNull();
    expect(store.getBlockMetadata('ccc-333')).toEqual({
      pageName: 'Page B',
      contentPreview: 'Block 3',
    });
  });

  it('clearBlockMetadata removes all records', () => {
    store.upsertBlockMetadata([
      { uuid: 'aaa-111', pageName: 'Page A', contentPreview: 'Block 1' },
      { uuid: 'bbb-222', pageName: 'Page B', contentPreview: 'Block 2' },
    ]);

    store.clearBlockMetadata();

    expect(store.getBlockMetadata('aaa-111')).toBeNull();
    expect(store.getBlockMetadata('bbb-222')).toBeNull();
  });

  it('getBlockMetadata returns correct record for existing UUID', () => {
    store.upsertBlockMetadata([
      { uuid: '64a1b2c3-d4e5-6789-abcd-ef0123456789', pageName: 'My Page', contentPreview: 'Some content here' },
    ]);

    const result = store.getBlockMetadata('64a1b2c3-d4e5-6789-abcd-ef0123456789');
    expect(result).toEqual({ pageName: 'My Page', contentPreview: 'Some content here' });
  });

  it('getBlockMetadata returns null for missing UUID', () => {
    const result = store.getBlockMetadata('nonexistent-uuid');
    expect(result).toBeNull();
  });

  it('clear() also clears block_metadata', async () => {
    store.upsertBlockMetadata([
      { uuid: 'aaa-111', pageName: 'Page A', contentPreview: 'Block 1' },
      { uuid: 'bbb-222', pageName: 'Page B', contentPreview: 'Block 2' },
    ]);

    await store.clear();

    expect(store.getBlockMetadata('aaa-111')).toBeNull();
    expect(store.getBlockMetadata('bbb-222')).toBeNull();
  });
});

// Feature: hnsw-vector-search, getDocumentContent helper
describe('getDocumentContent', () => {
  // **Validates: Requirements 8.1**

  let store: SQLiteVectorStore;

  beforeEach(async () => {
    store = await createInMemoryStore();
  });

  afterEach(() => {
    const db = store.db;
    if (db) db.close();
  });

  it('returns content for requested document IDs', async () => {
    await store.upsertDocuments([
      { id: 'doc-1', content: 'Hello world', lastUpdated: 1, embedding: new Array(1536).fill(0.1) },
      { id: 'doc-2', content: 'Goodbye world', lastUpdated: 2, embedding: new Array(1536).fill(0.2) },
      { id: 'doc-3', content: 'Third doc', lastUpdated: 3, embedding: new Array(1536).fill(0.3) },
    ]);

    const result = store.getDocumentContent(['doc-1', 'doc-3']);
    expect(result.size).toBe(2);
    expect(result.get('doc-1')).toBe('Hello world');
    expect(result.get('doc-3')).toBe('Third doc');
  });

  it('returns empty Map for empty ids array', () => {
    const result = store.getDocumentContent([]);
    expect(result.size).toBe(0);
  });

  it('returns empty Map when db is null', () => {
    (store as any)._db = null;
    const result = store.getDocumentContent(['doc-1']);
    expect(result.size).toBe(0);
  });

  it('omits IDs that do not exist in the store', async () => {
    await store.upsertDocuments([
      { id: 'doc-1', content: 'Exists', lastUpdated: 1, embedding: new Array(1536).fill(0.1) },
    ]);

    const result = store.getDocumentContent(['doc-1', 'nonexistent']);
    expect(result.size).toBe(1);
    expect(result.get('doc-1')).toBe('Exists');
    expect(result.has('nonexistent')).toBe(false);
  });
});
