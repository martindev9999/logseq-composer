import type { HnswlibModule } from 'hnswlib-wasm';
import { decodeEmbedding } from './cosineSimilarity';
import type { SQLiteVectorStore } from './SQLiteVectorStore';
import type { SearchResult } from './StorageProvider';
import {
    DEFAULT_CAPACITY_GROWTH_FACTOR,
    DEFAULT_EF_CONSTRUCTION,
    DEFAULT_EF_SEARCH,
    DEFAULT_M,
    DEFAULT_TOMBSTONE_THRESHOLD,
    type VectorSearchAcceleratorConfig,
} from './VectorSearchAccelerator.types';

type HierarchicalNSW = InstanceType<HnswlibModule['HierarchicalNSW']>;

/**
 * In-memory HNSW acceleration layer for vector similarity search.
 * Wraps hnswlib-wasm and delegates to SQLiteVectorStore brute-force
 * when the index is not ready.
 */
export class VectorSearchAccelerator {
  private readonly store: SQLiteVectorStore;
  private readonly m: number;
  private readonly efConstruction: number;
  private readonly efSearch: number;
  private readonly tombstoneRebuildThreshold: number;
  private readonly capacityGrowthFactor: number;

  private index: HierarchicalNSW | null = null;
  private indexReady = false;
  private dimension = 0;
  private readonly idToLabel = new Map<string, number>();
  private readonly labelToId = new Map<number, string>();
  private readonly contentCache = new Map<string, string>();
  private readonly deletedLabels = new Set<number>();
  private nextLabel = 0;
  private deletedCount = 0;
  private totalCapacity = 0;

  constructor(config: VectorSearchAcceleratorConfig) {
    this.store = config.store;
    this.m = config.m ?? DEFAULT_M;
    this.efConstruction = config.efConstruction ?? DEFAULT_EF_CONSTRUCTION;
    this.efSearch = config.efSearch ?? DEFAULT_EF_SEARCH;
    this.tombstoneRebuildThreshold = config.tombstoneRebuildThreshold ?? DEFAULT_TOMBSTONE_THRESHOLD;
    this.capacityGrowthFactor = config.capacityGrowthFactor ?? DEFAULT_CAPACITY_GROWTH_FACTOR;
  }

  /** Whether the HNSW index is built and ready to serve queries. */
  get isReady(): boolean {
    return this.indexReady;
  }

  /** Build the HNSW index from all embeddings in SQLiteVectorStore. */
  async initialize(): Promise<void> {
    const startTime = performance.now();

    try {
      const { loadHnswlib } = await import('hnswlib-wasm');
      const lib = await loadHnswlib();

      const allDocs = this.store.getAllEmbeddings();

      // Handle empty store: create a minimal index and mark ready
      if (allDocs.length === 0) {
        console.info('[VectorSearchAccelerator] No documents found, creating empty index.');
        this.index = new lib.HierarchicalNSW('cosine', 1, '');
        this.index.initIndex(1, this.m, this.efConstruction, 100);
        this.index.setEfSearch(this.efSearch);
        this.dimension = 1;
        this.totalCapacity = 1;
        this.indexReady = true;
        return;
      }

      // Filter out documents with invalid embedding BLOBs
      const validDocs: Array<{ id: string; content: string; embedding: Uint8Array }> = [];
      for (const doc of allDocs) {
        if (doc.embedding.byteLength % 4 !== 0) {
          console.warn(
            `[VectorSearchAccelerator] Skipping document "${doc.id}": embedding BLOB has invalid byte length ${doc.embedding.byteLength}`
          );
          continue;
        }
        validDocs.push(doc);
      }

      if (validDocs.length === 0) {
        console.info('[VectorSearchAccelerator] No valid embeddings found, creating empty index.');
        this.index = new lib.HierarchicalNSW('cosine', 1, '');
        this.index.initIndex(1, this.m, this.efConstruction, 100);
        this.index.setEfSearch(this.efSearch);
        this.dimension = 1;
        this.totalCapacity = 1;
        this.indexReady = true;
        return;
      }

      // Detect dimension from first valid embedding
      const dimension = validDocs[0].embedding.byteLength / 4;
      this.dimension = dimension;

      const capacity = Math.ceil(validDocs.length * this.capacityGrowthFactor);
      this.totalCapacity = capacity;

      console.info(
        `[VectorSearchAccelerator] Building index: ${validDocs.length} documents, dimension=${dimension}`
      );

      // Create and initialize the HNSW index
      this.index = new lib.HierarchicalNSW('cosine', dimension, '');
      this.index.initIndex(capacity, this.m, this.efConstruction, 100);
      this.index.setEfSearch(this.efSearch);

      // Reset maps
      this.idToLabel.clear();
      this.labelToId.clear();
      this.contentCache.clear();
      this.deletedLabels.clear();
      this.nextLabel = 0;

      // Bulk insert all vectors with sequential integer labels
      for (const doc of validDocs) {
        const label = this.nextLabel++;
        const vector = decodeEmbedding(doc.embedding);

        this.index.addPoint(vector, label, false);
        this.idToLabel.set(doc.id, label);
        this.labelToId.set(label, doc.id);
        this.contentCache.set(doc.id, doc.content);
      }

      this.deletedCount = 0;
      this.indexReady = true;

      const elapsed = (performance.now() - startTime).toFixed(1);
      console.info(`[VectorSearchAccelerator] Index built in ${elapsed}ms`);
    } catch (error) {
      console.error('[VectorSearchAccelerator] Failed to initialize HNSW index:', error);
      this.indexReady = false;
    }
  }

  /** Search for top-K nearest neighbors via HNSW or brute-force fallback. */
  async searchByVector(
    queryVector: number[],
    limit: number,
    threshold: number
  ): Promise<SearchResult[]> {
    if (!this.indexReady || !this.index) {
      console.warn(
        '[VectorSearchAccelerator] Index not ready, falling back to brute-force search.'
      );
      return this.store.searchByVector(queryVector, limit, threshold);
    }

    const startTime = performance.now();

    const queryF32 = new Float32Array(queryVector);

    // searchKnn k cannot exceed the current number of items in the index
    const currentCount = this.index.getCurrentCount();
    const k = Math.min(limit * 2, currentCount);

    if (k === 0) {
      return [];
    }

    const { distances, neighbors } = this.index.searchKnn(queryF32, k, undefined);

    const results: SearchResult[] = [];
    for (let i = 0; i < neighbors.length; i++) {
      const label = neighbors[i];

      // hnswlib returns -1 for empty slots
      if (label < 0) continue;

      // Skip labels that have been marked as deleted
      if (this.deletedLabels.has(label)) continue;

      const similarity = 1 - distances[i];

      if (similarity < threshold) continue;

      const docId = this.labelToId.get(label);
      if (!docId) continue;

      const content = this.contentCache.get(docId) ?? '';

      results.push({ id: docId, content, score: similarity });
    }

    // Sort descending by score and trim to limit
    results.sort((a, b) => b.score - a.score);
    const trimmed = results.slice(0, limit);

    const elapsed = (performance.now() - startTime).toFixed(2);
    console.info(
      `[VectorSearchAccelerator] HNSW search: ${trimmed.length} results in ${elapsed}ms`
    );

    return trimmed;
  }

  /** Add or upsert vectors into the HNSW index after SQLite upsert. */
  addVectors(docs: Array<{ id: string; content: string; embedding: number[] }>): void {
    if (!this.indexReady || !this.index) {
      console.warn('[VectorSearchAccelerator] Index not ready, skipping addVectors.');
      return;
    }

    // Dimension mismatch detection: compare first doc's embedding length against current dimension
    if (docs.length > 0 && docs[0].embedding.length !== this.dimension) {
      const oldDim = this.dimension;
      const newDim = docs[0].embedding.length;
      console.info(
        `[VectorSearchAccelerator] Dimension mismatch detected: ${oldDim} → ${newDim}`
      );
      this.indexReady = false;
      this.rebuild(`dimension change: ${oldDim} → ${newDim}`);
      return;
    }

    for (const doc of docs) {
      // Upsert: if ID already exists, mark old label as deleted
      const existingLabel = this.idToLabel.get(doc.id);
      if (existingLabel !== undefined) {
        this.index.markDelete(existingLabel);
        this.labelToId.delete(existingLabel);
        this.deletedLabels.add(existingLabel);
        this.deletedCount++;
      }

      // Allocate new label and insert
      const label = this.nextLabel++;
      this.index.addPoint(doc.embedding, label, true);

      // Update maps
      this.idToLabel.set(doc.id, label);
      this.labelToId.set(label, doc.id);
      this.contentCache.set(doc.id, doc.content);
    }

    // Check tombstone ratio and trigger rebuild if needed
    if (this.totalCapacity > 0 && this.deletedCount / this.totalCapacity > this.tombstoneRebuildThreshold) {
      console.info(
        `[VectorSearchAccelerator] Tombstone ratio ${(this.deletedCount / this.totalCapacity).toFixed(2)} exceeds threshold ${this.tombstoneRebuildThreshold}, scheduling rebuild.`
      );
      this.rebuild('tombstone threshold exceeded');
    }
  }

  /** Mark vectors as deleted in the HNSW index after SQLite delete. */
  removeVectors(ids: string[]): void {
    if (!this.indexReady || !this.index) {
      console.warn('[VectorSearchAccelerator] Index not ready, skipping removeVectors.');
      return;
    }

    for (const id of ids) {
      const label = this.idToLabel.get(id);
      if (label === undefined) {
        // ID not found in index — skip silently
        continue;
      }

      this.index.markDelete(label);
      this.idToLabel.delete(id);
      this.labelToId.delete(label);
      this.contentCache.delete(id);
      this.deletedLabels.add(label);
      this.deletedCount++;
    }

    // Check tombstone ratio and trigger rebuild if needed
    if (this.totalCapacity > 0 && this.deletedCount / this.totalCapacity > this.tombstoneRebuildThreshold) {
      console.info(
        `[VectorSearchAccelerator] Tombstone ratio ${(this.deletedCount / this.totalCapacity).toFixed(2)} exceeds threshold ${this.tombstoneRebuildThreshold}, scheduling rebuild.`
      );
      this.rebuild('tombstone threshold exceeded');
    }
  }

  /** Rebuild the HNSW index from scratch using all embeddings in SQLite. */
  async rebuild(reason = 'manual rebuild'): Promise<void> {
    console.info(`[VectorSearchAccelerator] Rebuilding index: ${reason}`);

    this.indexReady = false;
    const startTime = performance.now();

    try {
      const { loadHnswlib } = await import('hnswlib-wasm');
      const lib = await loadHnswlib();

      const allDocs = this.store.getAllEmbeddings();

      // Handle empty store: create a minimal index and mark ready
      if (allDocs.length === 0) {
        console.info('[VectorSearchAccelerator] No documents found during rebuild, creating empty index.');
        this.index = new lib.HierarchicalNSW('cosine', 1, '');
        this.index.initIndex(1, this.m, this.efConstruction, 100);
        this.index.setEfSearch(this.efSearch);
        this.dimension = 1;
        this.totalCapacity = 1;
        this.idToLabel.clear();
        this.labelToId.clear();
        this.contentCache.clear();
        this.deletedLabels.clear();
        this.nextLabel = 0;
        this.deletedCount = 0;
        this.indexReady = true;
        return;
      }

      // Filter out documents with invalid embedding BLOBs
      const validDocs: Array<{ id: string; content: string; embedding: Uint8Array }> = [];
      for (const doc of allDocs) {
        if (doc.embedding.byteLength % 4 !== 0) {
          console.warn(
            `[VectorSearchAccelerator] Skipping document "${doc.id}": embedding BLOB has invalid byte length ${doc.embedding.byteLength}`
          );
          continue;
        }
        validDocs.push(doc);
      }

      if (validDocs.length === 0) {
        console.info('[VectorSearchAccelerator] No valid embeddings found during rebuild, creating empty index.');
        this.index = new lib.HierarchicalNSW('cosine', 1, '');
        this.index.initIndex(1, this.m, this.efConstruction, 100);
        this.index.setEfSearch(this.efSearch);
        this.dimension = 1;
        this.totalCapacity = 1;
        this.idToLabel.clear();
        this.labelToId.clear();
        this.contentCache.clear();
        this.deletedLabels.clear();
        this.nextLabel = 0;
        this.deletedCount = 0;
        this.indexReady = true;
        return;
      }

      // Detect dimension from first valid embedding
      const newDimension = validDocs[0].embedding.byteLength / 4;

      if (newDimension !== this.dimension) {
        console.info(
          `[VectorSearchAccelerator] Dimension changed from ${this.dimension} to ${newDimension}`
        );
      }

      this.dimension = newDimension;

      const capacity = Math.ceil(validDocs.length * this.capacityGrowthFactor);
      this.totalCapacity = capacity;

      console.info(
        `[VectorSearchAccelerator] Rebuilding index: ${validDocs.length} documents, dimension=${newDimension}`
      );

      // Create fresh HNSW index
      this.index = new lib.HierarchicalNSW('cosine', newDimension, '');
      this.index.initIndex(capacity, this.m, this.efConstruction, 100);
      this.index.setEfSearch(this.efSearch);

      // Reset maps and counters
      this.idToLabel.clear();
      this.labelToId.clear();
      this.contentCache.clear();
      this.deletedLabels.clear();
      this.nextLabel = 0;

      // Bulk insert all vectors with sequential integer labels
      for (const doc of validDocs) {
        const label = this.nextLabel++;
        const vector = decodeEmbedding(doc.embedding);

        this.index.addPoint(vector, label, false);
        this.idToLabel.set(doc.id, label);
        this.labelToId.set(label, doc.id);
        this.contentCache.set(doc.id, doc.content);
      }

      this.deletedCount = 0;
      this.indexReady = true;

      const elapsed = (performance.now() - startTime).toFixed(1);
      console.info(`[VectorSearchAccelerator] Rebuild complete in ${elapsed}ms`);
    } catch (error) {
      console.error('[VectorSearchAccelerator] Failed to rebuild HNSW index:', error);
      this.indexReady = false;
    }
  }

  /** Dispose of the HNSW index and release memory. */
  dispose(): void {
    this.index = null;
    this.indexReady = false;
    this.idToLabel.clear();
    this.labelToId.clear();
    this.contentCache.clear();
    this.deletedLabels.clear();
    this.nextLabel = 0;
    this.deletedCount = 0;
    this.totalCapacity = 0;
    this.dimension = 0;
  }
}
