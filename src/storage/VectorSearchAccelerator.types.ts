import type { SQLiteVectorStore } from './SQLiteVectorStore';

// --- Default HNSW parameters ---

/** Bi-directional links per node in the HNSW graph. */
export const DEFAULT_M = 16;

/** Construction-time search depth — higher values yield better recall at the cost of build time. */
export const DEFAULT_EF_CONSTRUCTION = 200;

/** Query-time search depth — higher values yield better recall at the cost of query latency. */
export const DEFAULT_EF_SEARCH = 64;

/** Ratio of tombstoned entries to total capacity that triggers a full rebuild. */
export const DEFAULT_TOMBSTONE_THRESHOLD = 0.2;

/** Multiplier applied to document count when allocating initial HNSW index capacity. */
export const DEFAULT_CAPACITY_GROWTH_FACTOR = 1.5;

// --- Interfaces ---

/** Configuration accepted by the VectorSearchAccelerator constructor. */
export interface VectorSearchAcceleratorConfig {
  /** Reference to the initialized SQLiteVectorStore (source of truth). */
  store: SQLiteVectorStore;
  /** HNSW construction parameter M (bi-directional links per node). */
  m?: number;
  /** HNSW construction parameter efConstruction. */
  efConstruction?: number;
  /** HNSW search parameter efSearch. */
  efSearch?: number;
  /** Tombstone ratio threshold that triggers a full rebuild. */
  tombstoneRebuildThreshold?: number;
  /** Growth factor for initial capacity allocation. */
  capacityGrowthFactor?: number;
}

/** Internal bookkeeping state for the accelerator. */
export interface AcceleratorState {
  indexReady: boolean;
  dimension: number;
  deletedCount: number;
  totalCapacity: number;
  nextLabel: number;
}

/** Raw result returned by hnswlib-wasm's searchKnn. */
export interface HnswSearchResult {
  distances: Float32Array;
  neighbors: Int32Array;
}
