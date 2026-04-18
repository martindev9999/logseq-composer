import type { BM25Index } from './bm25Index';
import { classifyQuery } from './queryClassifier';
import type { RankedHit, SearchHit } from './reranker';
import { mergeWithRRF } from './reranker';
import type { PerDocumentStorageProvider } from './storage/StorageProvider';
import type { VectorSearchAccelerator } from './storage/VectorSearchAccelerator';

export interface HybridSearchOptions {
  limit?: number;       // max results, default 5
  threshold?: number;   // vector similarity threshold, default 0.5
  rrfK?: number;        // RRF constant, default 60
  accelerator?: VectorSearchAccelerator;  // optional HNSW accelerator for fast vector search
}

const DEFAULT_LIMIT = 5;
const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_RRF_K = 60;

export async function hybridSearch(
  query: string,
  queryEmbedding: number[],
  storageProvider: PerDocumentStorageProvider,
  bm25Index: BM25Index,
  options?: HybridSearchOptions
): Promise<RankedHit[]> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const rrfK = options?.rrfK ?? DEFAULT_RRF_K;

  // 1. Classify the query — default to mixed on error
  let bm25Weight = 1;
  let vectorWeight = 1;
  try {
    const classification = classifyQuery(query);
    bm25Weight = classification.bm25Weight;
    vectorWeight = classification.vectorWeight;
  } catch {
    // Default to mixed weights on classifier error
  }

  // 2. Execute BM25 and vector search in parallel
  const bm25Promise = Promise.resolve().then(() => bm25Index.search(query, limit));
  const accelerator = options?.accelerator;
  const vectorPromise = accelerator?.isReady
    ? accelerator.searchByVector(queryEmbedding, limit, threshold)
    : storageProvider.searchByVector(queryEmbedding, limit, threshold);

  const [bm25Result, vectorResult] = await Promise.allSettled([bm25Promise, vectorPromise]);

  // 3. Handle failures with fallback
  let bm25Hits: SearchHit[] = [];
  let vectorHits: SearchHit[] = [];

  if (bm25Result.status === 'fulfilled') {
    bm25Hits = bm25Result.value.map((r) => ({ id: r.id, content: r.content, score: r.score }));
  } else {
    console.warn('BM25 search failed, falling back to vector results only:', bm25Result.reason);
  }

  if (vectorResult.status === 'fulfilled') {
    vectorHits = vectorResult.value.map((r) => ({ id: r.id, content: r.content, score: r.score }));
  } else {
    console.warn('Vector search failed, falling back to BM25 results only:', vectorResult.reason);
  }

  // If both failed, return empty
  if (bm25Hits.length === 0 && vectorHits.length === 0) {
    return [];
  }

  // 4. Merge results via RRF with classification weights
  return mergeWithRRF(bm25Hits, vectorHits, {
    k: rrfK,
    limit,
    bm25Weight,
    vectorWeight,
  });
}
