// File: IndexManager.ts

export type IndexingOutcome = 'completed' | 'paused' | 'error';

export interface IndexingResult {
  outcome: IndexingOutcome;
  pagesProcessed: number;
  errorMessage?: string;
}

import { getByID, remove } from "@orama/orama";
import { DEFAULT_EMBEDDING_MODEL, EmbeddingProvider, extractOutgoingLinks, fetchBacklinks, getEmbeddingsForPage, PageLinkData } from "embedManager";
import { batchInsertEmbeddings, OramaInstance } from "VectorDBManager";
import { shouldSuppressAutoIndex } from "./cooldownManager";
import type { DocumentRecord, PerDocumentStorageProvider, StorageProvider } from "./storage/StorageProvider";
import type { VectorSearchAccelerator } from "./storage/VectorSearchAccelerator";

const BATCH_SIZE = 5;

let hasHooked = false;
let currentApiKey = '';
let currentEmbeddingKey = '';
let currentModel = '';
let currentEmbeddingEndpoint = '';
let currentEmbeddingProvider: EmbeddingProvider = 'openai';
let currentOramaInstance: OramaInstance | undefined;
let currentStorageProvider: StorageProvider;
let currentAccelerator: VectorSearchAccelerator | undefined;
let indexingInProgress = false;
let _pauseRequested = false;
let _pagesProcessed = 0;

/**
 * Request the current indexing run to pause after the current page finishes.
 * Returns immediately — the loop will stop at the next iteration.
 */
export function requestPauseIndexing(): void {
  _pauseRequested = true;
}

/**
 * Returns true while an indexing run is active.
 */
export function isIndexingActive(): boolean {
  return indexingInProgress;
}

/**
 * Returns the number of pages processed so far in the current (or most recent) indexing run.
 */
export function getIndexingProgress(): number {
  return _pagesProcessed;
}

/**
 * Reset module-level indexing state. Intended for tests only — ensures clean
 * state between fast-check iterations when the 1-second cooldown timer may
 * not have fired due to fake timers or test parallelism.
 * @internal
 */
export function _resetIndexingState(): void {
  indexingInProgress = false;
  _pauseRequested = false;
  _pagesProcessed = 0;
}

let _isUpdatingSettings = false;

export function getIsUpdatingSettings(): boolean {
  return _isUpdatingSettings;
}

export function setIsUpdatingSettings(value: boolean): void {
  _isUpdatingSettings = value;
}

/**
 * Type guard: returns true when the storage provider supports per-document
 * operations (SQLiteVectorStore), false for the legacy Orama-based path.
 */
function isPerDocumentProvider(provider: any): provider is PerDocumentStorageProvider {
  return typeof provider?.getDocumentMeta === 'function';
}

/**
 * Recursively collect all block content strings from a block tree.
 * Used to extract outgoing links before the full embedding pipeline runs.
 */
function collectBlockContent(blocks: any[]): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.content) {
      lines.push(block.content);
    }
    if (block.children && block.children.length > 0) {
      lines.push(...collectBlockContent(block.children));
    }
  }
  return lines;
}

const isInternalPage = (name: string) => {
  return name.startsWith('card') ||
         name.startsWith('contents') ||
         name.startsWith('favorites') ||
         name.startsWith('__') ||
         name === 'journals' ||
         name === 'contents' ||
         name === 'favorites';
};

export async function checkAndIndexUpdatedPages(
  apiKey: string,
  oramaInstance: OramaInstance | undefined,
  embeddingApiKey: string,
  model: string = DEFAULT_EMBEDDING_MODEL,
  storageProvider: StorageProvider,
  embeddingEndpoint?: string,
  embeddingProvider?: EmbeddingProvider,
  accelerator?: VectorSearchAccelerator
): Promise<IndexingResult> {
  if (indexingInProgress) return { outcome: 'completed', pagesProcessed: 0 };

  indexingInProgress = true;
  _pauseRequested = false;
  _pagesProcessed = 0;

  let result: IndexingResult;

  try {
    const pages = (await logseq.Editor.getAllPages()) ?? [];

    const isPerDoc = isPerDocumentProvider(storageProvider);
    const supportsBulk = isPerDoc && typeof storageProvider.beginBulk === 'function';
    if (supportsBulk) {
      storageProvider.beginBulk!();
    }

    let pagesInBatch = 0;
    let pausedByUser = false;

    for (const page of pages) {
      // Check for pause request between pages
      if (_pauseRequested) {
        console.info('[indexManager] Indexing paused by user.');
        if (supportsBulk) {
          storageProvider.endBulk!();
          await storageProvider.persistToIndexedDB!();
        }
        pausedByUser = true;
        break;
      }

      if (isInternalPage(page.name)) continue;

      const pageIdStr = page.id.toString();
      const lastUpdated: number = page.updatedAt ?? 0;

      if (isPerDoc) {
        // --- Per-document path (SQLiteVectorStore) ---
        const storedLastUpdated = await storageProvider.getDocumentMeta(pageIdStr);
        if (storedLastUpdated !== null && storedLastUpdated >= lastUpdated) continue;

        try {
          const blocks = await logseq.Editor.getPageBlocksTree(page.uuid);

          const blockContentLines = collectBlockContent(blocks);
          const outgoingLinks = extractOutgoingLinks(blockContentLines);
          const backlinks = await fetchBacklinks(page.name);
          const linkData: PageLinkData = { outgoingLinks, backlinks };

          // Delete old block metadata for this page before re-indexing
          storageProvider.deleteBlockMetadataForPage?.(page.name);

          const { embeddings: newEmbeddings, blockMetadata } = await getEmbeddingsForPage(
            pageIdStr,
            blocks,
            page.name,
            lastUpdated,
            embeddingApiKey,
            model,
            page.properties,
            linkData,
            embeddingEndpoint,
            embeddingProvider
          );

          // Delete old chunks for this page
          const oldChunkIds = [pageIdStr];
          for (let c = 0; c < 100; c++) {
            oldChunkIds.push(`${page.id}_chunk_${c}`);
          }
          await storageProvider.deleteDocuments(oldChunkIds);
          accelerator?.removeVectors(oldChunkIds);

          // Map embeddings to DocumentRecord[] and upsert
          const docs: DocumentRecord[] = newEmbeddings.map(e => ({
            id: e.id,
            content: e.content,
            lastUpdated: e.lastUpdated,
            embedding: e.embedding,
          }));
          await storageProvider.upsertDocuments(docs);
          accelerator?.addVectors(docs.map(d => ({ id: d.id, content: d.content, embedding: d.embedding })));

          // Upsert block metadata after successful indexing
          if (blockMetadata.length > 0) {
            storageProvider.upsertBlockMetadata?.(blockMetadata);
          }
          _pagesProcessed++;

          pagesInBatch++;
          if (pagesInBatch >= BATCH_SIZE) {
            if (supportsBulk) {
              await storageProvider.persistToIndexedDB!();
            }
            await new Promise(resolve => setTimeout(resolve, 0));
            pagesInBatch = 0;
          }
        } catch (error) {
          console.error(`Error indexing page ${page.name} (ID: ${page.uuid}):`, error);
        }
      } else {
        // --- Legacy Orama-based path ---
        if (!oramaInstance) {
          console.error('[indexManager] Legacy path requires oramaInstance but none was provided.');
          continue;
        }

        const dbRecord = getByID(oramaInstance, pageIdStr);
        if (dbRecord && dbRecord.lastUpdated >= lastUpdated) continue;

        try {
          const blocks = await logseq.Editor.getPageBlocksTree(page.uuid);

          const blockContentLines = collectBlockContent(blocks);
          const outgoingLinks = extractOutgoingLinks(blockContentLines);
          const backlinks = await fetchBacklinks(page.name);
          const linkData: PageLinkData = { outgoingLinks, backlinks };

          const { embeddings: newEmbeddings } = await getEmbeddingsForPage(
            pageIdStr,
            blocks,
            page.name,
            lastUpdated,
            embeddingApiKey,
            model,
            page.properties,
            linkData,
            embeddingEndpoint,
            embeddingProvider
          );

          // Remove old record and any existing chunks for this page
          if (dbRecord?.id) {
            await remove(oramaInstance, dbRecord.id);
          }
          for (let c = 0; c < 100; c++) {
            const chunkId = `${page.id}_chunk_${c}`;
            const chunkRecord = getByID(oramaInstance, chunkId);
            if (!chunkRecord) break;
            await remove(oramaInstance, chunkId);
          }

          await batchInsertEmbeddings(oramaInstance, newEmbeddings, storageProvider);
          _pagesProcessed++;
        } catch (error) {
          console.error(`Error indexing page ${page.name} (ID: ${page.uuid}):`, error);
        }
      }
    }

    // Ensure final batch is persisted after loop completes
    if (!pausedByUser && supportsBulk) {
      storageProvider.endBulk!();
      await storageProvider.persistToIndexedDB!();
    }

    result = pausedByUser
      ? { outcome: 'paused', pagesProcessed: _pagesProcessed }
      : { outcome: 'completed', pagesProcessed: _pagesProcessed };
  } catch (error: any) {
    result = {
      outcome: 'error',
      pagesProcessed: _pagesProcessed,
      errorMessage: error?.message ?? String(error),
    };
  } finally {
    setTimeout(() => {
      indexingInProgress = false;
    }, 1000); // 1 second cooldown
  }

  return result;
}

/** Default debounce delay for auto-indexing on DB changes (ms). */
const DEFAULT_AUTO_INDEX_DEBOUNCE_MS = 300_000; // 5 minutes

/** Current debounce delay, configurable via plugin settings. */
let _autoIndexDebounceMs = DEFAULT_AUTO_INDEX_DEBOUNCE_MS;

/** Update the auto-index debounce delay (in seconds, from settings). */
export function setAutoIndexDebounceSeconds(seconds: number): void {
  _autoIndexDebounceMs = Math.max(10, seconds) * 1000; // minimum 10 seconds
}

/** Module-level debounce timer for the auto-indexer's onChanged callback. */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Tracks whether the auto-embed toggle is enabled. */
let _autoEmbedEnabled = true;

/** Update the auto-embed enabled state used by the onChanged suppression guard. */
export function setAutoEmbedEnabled(enabled: boolean): void {
  _autoEmbedEnabled = enabled;
}

/** Cancel any pending auto-index debounce timer. */
export function cancelAutoIndexDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export function startPageIndexingOnChange(
  apiKey: string,
  oramaInstance: OramaInstance | undefined,
  embeddingApiKey: string,
  model: string = DEFAULT_EMBEDDING_MODEL,
  storageProvider: StorageProvider,
  embeddingEndpoint?: string,
  embeddingProvider?: EmbeddingProvider,
  accelerator?: VectorSearchAccelerator
): void {
  currentApiKey = apiKey;
  currentEmbeddingKey = embeddingApiKey;
  currentModel = model;
  currentOramaInstance = oramaInstance;
  currentStorageProvider = storageProvider;
  currentEmbeddingEndpoint = embeddingEndpoint ?? '';
  currentEmbeddingProvider = embeddingProvider ?? 'openai';
  currentAccelerator = accelerator;

  if (hasHooked) return;
  hasHooked = true;

  logseq.DB.onChanged(() => {
    if (getIsUpdatingSettings()) return;
    if (shouldSuppressAutoIndex(_autoEmbedEnabled)) return;

    // Clear any pending debounce timer and restart the wait
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      try {
        await checkAndIndexUpdatedPages(currentApiKey, currentOramaInstance, currentEmbeddingKey, currentModel, currentStorageProvider, currentEmbeddingEndpoint, currentEmbeddingProvider, currentAccelerator);
      } catch (err) {
        console.error('Error indexing updated pages:', err);
      }
    }, _autoIndexDebounceMs);
  });
}
