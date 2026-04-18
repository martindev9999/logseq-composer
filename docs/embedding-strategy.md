# Embedding Strategy

## Overview

Logseq Composer uses embedding models to generate vector embeddings for all user notes. The plugin supports both cloud-based OpenAI models and local Ollama models, configurable via plugin settings. Users can choose between six embedding models across two providers to balance cost, speed, privacy, and quality. These embeddings power semantic search via RAG (Retrieval-Augmented Generation), allowing the LLM to find and reference relevant notes when answering queries.

## Embedding Providers

The plugin supports two embedding providers, configurable via the `embeddingProvider` setting:

| Provider | Description | Auth Required | Default Endpoint |
|----------|-------------|---------------|------------------|
| `openai` (default) | Cloud-based OpenAI embedding API | Yes (API key) | `https://api.openai.com/v1/embeddings` |
| `ollama` | Local Ollama instance | No | `http://localhost:11434/api/embeddings` |

When using Ollama, no API key is needed — the plugin sends requests directly to the local Ollama instance without an Authorization header.

## Embedding Models

The plugin supports six embedding models across both providers:

### OpenAI Models

| Model | Dimensions | Max Tokens | Cost (per 1M tokens) |
|-------|-----------|------------|---------------------|
| text-embedding-ada-002 | 1536 | 8,191 | ~$0.10 |
| text-embedding-3-small (default) | 1536 | 8,191 | ~$0.02 |
| text-embedding-3-large | 3072 | 8,191 | ~$0.13 |

### Ollama Models

| Model | Dimensions | Max Tokens | Cost |
|-------|-----------|------------|------|
| nomic-embed-text | 768 | 8,192 | Free (local) |
| mxbai-embed-large | 1024 | 512 | Free (local) |
| all-minilm | 384 | 256 | Free (local) |

The model is configurable via the `embeddingModel` plugin setting. The default is `text-embedding-3-small`.

- **Max input chars**: Varies by model. For OpenAI models: ~16,000 characters per chunk (derived from 8,191 tokens × 2 chars/token). For Ollama models, the token limit varies (see table above).

## Provider-Specific Request Handling

The `useGenerateEmbedding()` function branches on the `embeddingProvider` setting:

| Aspect | OpenAI | Ollama |
|--------|--------|--------|
| Endpoint | Configurable (default: `https://api.openai.com/v1/embeddings`) | Configurable (default: `http://localhost:11434/api/embeddings`) |
| Auth header | `Authorization: Bearer <apiKey>` | None |
| Request body | `{ model, input: text }` | `{ model, prompt: text }` |
| Response path | `response.data[0].embedding` | `response.embedding` |
| API key required | Yes | No |

If the `embeddingEndpoint` setting is empty or whitespace-only, it falls back to the OpenAI default endpoint.

## Model Change Behavior

When the user changes the embedding model in plugin settings:

1. On the next database load, the plugin compares the current `embeddingModel` setting against the persisted `lastEmbeddingModel`
2. If they differ (or `lastEmbeddingModel` is missing), a fresh database is created with the new model's vector dimensions
3. All existing embeddings are discarded — the user must re-index
4. This applies even when switching between models with the same dimension (e.g., ada-002 → 3-small), because embeddings from different models are not comparable

The `lastEmbeddingModel` value is persisted in plugin settings alongside the database.

## Vector Database

The plugin uses a per-document SQLite storage model (`SQLiteVectorStore`) backed by [sql.js](https://github.com/sql-js/sql.js) (a WASM build of SQLite). Each document embedding is stored as an individual row in a `documents` table:

| Column       | Type           | Description                          |
|-------------|----------------|--------------------------------------|
| id          | TEXT (PK)      | Page ID or `{pageId}_chunk_{n}` for multi-chunk pages |
| content     | TEXT           | Block content for this chunk         |
| lastUpdated | INTEGER        | Timestamp of last page update        |
| embedding   | BLOB           | Raw Float32Array bytes (4 bytes per float) |

A separate `block_metadata` table stores per-block navigation data:

| Column         | Type       | Description                                      |
|---------------|------------|--------------------------------------------------|
| uuid          | TEXT (PK)  | Block UUID from Logseq                           |
| pageName      | TEXT       | Parent page name                                 |
| contentPreview| TEXT       | First 50 chars of block content (truncated with "…") |

This metadata enables clickable block references in chat responses — the LLM cites blocks using `((uuid))` notation, and the UI renders them as teal-colored inline links that navigate to the source block on click.

### Persistence

The sql.js in-memory database is persisted to IndexedDB as a binary ArrayBuffer. On plugin load, the database is restored from IndexedDB without any JSON parsing. If the stored data is corrupted, a fresh database is created automatically.

### Legacy Backend

A legacy `SettingsStorageProvider` (Orama-based, storing a serialized JSON blob in Logseq plugin settings) is still available as a fallback via the `storageBackend` setting. The plugin uses duck-typing to branch between the two backends at runtime. The SQLite backend is the default.

## Block-Based Content Processing

Each page's content is processed block by block:

1. The block tree is fetched via `logseq.Editor.getPageBlocksTree()`
2. All blocks are recursively flattened, including nested children with breadcrumb context
3. Each block with a UUID and non-empty content is annotated with `[block:<uuid>]` for LLM citation
4. Block references `((uuid))` and embeds `{{embed ((uuid))}}` are resolved to actual content
5. Blocks are grouped into chunks that respect block boundaries (see [Chunking Strategy](./chunking-strategy.md))
6. Block metadata (UUID, page name, content preview) is extracted and stored in the `block_metadata` table
7. Each chunk is prefixed with page metadata:

```
note_id: {page.id}
note_name: {page.name}
note_content:

[block:uuid-1] - {block 1 content}
[block:uuid-2] [{block 1 content…}] {child block content}
[block:uuid-3] - {block 2 content}
...
```

## Indexing Modes

Controlled by the `indexingMode` plugin setting.

### Incremental (default)

- Loads the existing vector database
- Iterates all pages and compares each page's `updatedAt` timestamp against the stored `lastUpdated`
- Skips pages that haven't changed since last indexed
- For updated pages: removes old records and chunks, generates new block-based chunk embeddings, and inserts them
- Skips internal pages (cards, contents, favorites, journals index, pages starting with `__`)
- Journal pages (individual entries like "Apr 15th, 2026") are included

### Full

- Creates a fresh empty database (discards all existing embeddings)
- Generates block-based chunk embeddings for every page in the vault
- Processes pages in batches of 5 concurrent API calls
- Clears the block reference cache before starting

> ⚠️ **Switch back to incremental after a full re-index.** Leaving `indexingMode` set to `"full"` means every future Re-Index click will wipe all existing embeddings and re-embed from scratch, wasting API credits and time. Full mode is intended as a one-time recovery tool, not a permanent setting.

## Indexing Triggers

There are three ways embedding/indexing occurs:

### 1. Manual Re-Index (Re-Index DB button)

The user clicks the "🔄 Re-Index" button in the chat panel toolbar. This calls `indexEntireLogSeq()` which behaves according to the `indexingMode` setting (incremental or full). While indexing is in progress, the button changes to "⏹ Stop" — clicking it stops the indexing loop after the current page finishes processing.

After a user-initiated stop, a 60-second cooldown period begins:

- During cooldown, the Re-Index button is disabled (grayed out) and does not respond to clicks
- During cooldown, the auto-indexer is suppressed — all `logseq.DB.onChanged()` events are ignored and no new indexing runs are scheduled
- When the cooldown expires, the button re-enables and the auto-indexer resumes normal operation

The cooldown only applies to user-initiated stops. Normal indexing completion and error completion do not trigger a cooldown — the button returns to the enabled "🔄 Re-Index" state immediately.

### 2. Auto-Indexing on Page Changes

When the plugin loads, it registers a `logseq.DB.onChanged()` listener via `enableAutoIndexer()`. Any database change in Logseq (page edits, new pages, etc.) triggers `checkAndIndexUpdatedPages()`, which performs incremental indexing for changed pages.

A toggle switch ("Auto-Embed: On/Off") in the toolbar controls whether the `onChanged` listener schedules indexing. When the toggle is disabled, database changes are ignored by the auto-indexer and no new indexing runs are scheduled. When re-enabled, auto-indexing resumes after the standard 30-second debounce. The toggle state is persisted via `logseq.settings` (key: `autoEmbedEnabled`, default: `true`) and restored on plugin load. Manual re-indexing via the Re-Index button works regardless of the toggle state.

A guard flag (`isUpdatingSettings`) prevents cascading re-indexing loops. When the plugin persists the vector database to settings, the resulting `onChanged` event is ignored.

An `indexingInProgress` flag with a 1-second cooldown prevents concurrent indexing runs.

### 3. Query-Time Embedding

When the user sends a chat message, `handleQuery()` generates a single embedding for the query text to perform vector similarity search against the indexed notes. This is not a bulk indexing operation — it's a single API call per query.

## Concurrency and Rate Limiting

- **Batch size**: 5 pages processed concurrently per batch (full indexing mode)
- **Timeout**: Each API call has a 30-second timeout via `AbortController`. If the API doesn't respond within 30 seconds, the request is aborted with a descriptive error.
- **Incremental indexing**: Processes pages sequentially (one at a time) since it typically only needs to handle a few changed pages.

## Block Reference Resolution

Block references and embeds are resolved before embedding:

| Pattern                        | Resolution                                          |
|-------------------------------|-----------------------------------------------------|
| `((uuid))`                    | Replaced with the referenced block's actual text     |
| `{{embed ((uuid))}}`          | Replaced with the embedded block's actual text       |

A per-run cache prevents redundant `logseq.Editor.getBlock()` calls for the same UUID. If a reference can't be resolved, the original syntax is preserved.

## Vector Search

When the user sends a query:

1. The query text is embedded using the selected embedding model
2. The embedding is searched against the in-memory HNSW index via `VectorSearchAccelerator` for fast approximate nearest neighbor search (sub-5ms at 20k+ chunks). If the HNSW index is not ready, the search falls back to brute-force cosine similarity in `SQLiteVectorStore`.
3. Search parameters:
   - **Similarity threshold**: 0.5 (minimum cosine similarity)
   - **Result limit**: 5 most similar chunks
   - **HNSW efSearch**: 64 (query-time search depth, ≥95% recall vs exact search)
4. Results are reranked using Reciprocal Rank Fusion (RRF) before being injected into the LLM prompt
5. The content of matching chunks is appended to the LLM prompt as "Additional Context from Knowledge Base"

The HNSW index is built from all embeddings in the SQLite `documents` table at startup using [hnswlib-wasm](https://github.com/nicktobey/hnswlib-wasm) (a WebAssembly build of hnswlib). It is volatile (in-memory only) — SQLite remains the source of truth. Incremental updates keep the index synchronized during a session, and a full rebuild is triggered when the embedding dimension changes or tombstone accumulation exceeds 20%.

If vector search fails for any reason, the query proceeds without additional context — only the current page context is used as fallback.

### Legacy Backend

When using the `settings` storage backend, vector search still goes through the Orama in-memory database with a 0.65 similarity threshold.

## Error Handling

- **API errors**: The actual error message from the provider is surfaced to the user, including the HTTP status code and response body
- **Timeout**: Requests that exceed 30 seconds are aborted with "Embedding API request timed out after 30 seconds" (both providers)
- **Ollama unreachable**: When the Ollama endpoint is unreachable (connection refused), a descriptive error is thrown: "Ollama embedding endpoint is not reachable at {endpoint}. Please verify Ollama is running."
- **Missing API key**: For OpenAI, an error is thrown if the API key is empty. For Ollama, no API key validation is performed.
- **Malformed response**: If the embedding field is missing from the response, a descriptive error is thrown: "Unexpected embedding response format from {provider}: missing embedding data"
- **Token limit**: Input is safety-truncated to the model's `maxTokens` limit before sending; block-based chunking ensures most content fits naturally
- **Database corruption**: If the persisted database can't be restored, a fresh database is created automatically
- **Per-page resilience** (auto-indexer): If embedding fails for one page during auto-indexing, the error is logged and indexing continues for remaining pages
- **Reference resolution failure**: If a block reference can't be fetched, the original `((uuid))` syntax is kept

## Startup Performance

The plugin uses several techniques to avoid blocking Logseq's main thread during startup:

- **Lazy tokenizer loading**: The cl100k_base encoding table (~1.5 MB of JSON data) is loaded via dynamic `import()` on first use rather than at bundle parse time. This reduces the main bundle from ~1,740 KB to ~512 KB.
- **Lazy storage provider**: A proxy wraps the real `SQLiteVectorStore` and defers WASM compilation and database restoration until the first method call. Initialization is scheduled via `requestIdleCallback` so it runs when the browser is idle.
- **Vite chunk splitting**: Heavy dependencies (sql.js, Orama, tiktoken) are split into separate chunks via `manualChunks` in the Vite config, so they load on demand rather than at startup.
- **Yield points**: `SQLiteVectorStore.initialize()` yields to the event loop between WASM loading and database restoration, allowing the host app to process window messages.
- **Immediate toolbar registration**: The toolbar button and UI model are registered synchronously in `main()` before any heavy work begins.

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│                   User Actions                   │
├──────────┬──────────────────┬───────────────────┤
│ Re-Index │  Send Chat Query │  Edit a Page      │
│ DB Button│                  │  (auto-trigger)   │
└────┬─────┴────────┬─────────┴─────────┬─────────┘
     │              │                   │
     ▼              ▼                   ▼
 indexEntire     handleQuery()    DB.onChanged()
 LogSeq()            │                  │
     │               │                  ▼
     │               │         checkAndIndex
     │               │         UpdatedPages()
     ▼               │                  │
 ┌───────────────────┼──────────────────┘
 │                   │
 ▼                   ▼
 flattenBlocks()     useGenerateEmbedding()
 (recursive, with    (query embedding)
  ref resolution)         │
     │                    │
     ▼                    │
 groupBlocksIntoChunks()  │
     │                    │
     ▼                    ▼
 ┌───────────────────────────────────────┐
 │      useGenerateEmbedding()           │
 │  (provider-aware: OpenAI or Ollama)   │
 │  - OpenAI: Bearer auth, input field   │
 │  - Ollama: no auth, prompt field      │
 │  - 30s timeout                        │
 │  - Safety truncation per model limit  │
 └──────────────┬────────────────────────┘
                │
                ▼
 ┌───────────────────────────────────────┐
 │     SQLiteVectorStore (default)       │
 │  - upsertDocuments / deleteDocuments  │
 │  - searchByVector (cosine similarity) │
 │  - block_metadata table               │
 │  - Persisted to IndexedDB as binary   │
 │                                       │
 │  VectorSearchAccelerator (HNSW)       │
 │  - In-memory HNSW index (hnswlib-wasm)│
 │  - Sub-5ms queries at 20k+ chunks     │
 │  - Auto-fallback to brute-force       │
 │  - Rebuilt from SQLite on startup     │
 │                                       │
 │  Legacy fallback: Orama + Settings    │
 └───────────────────────────────────────┘
```

## File Reference

| File                    | Responsibility                                              |
|------------------------|-------------------------------------------------------------|
| `src/embedManager.ts`  | Block flattening with UUID annotation, reference resolution, chunk grouping, block metadata extraction, provider-aware embedding generation (OpenAI + Ollama), endpoint resolution |
| `src/storage/SQLiteVectorStore.ts` | Per-document storage, cosine similarity search (brute-force fallback), `getAllEmbeddings()` for HNSW index construction, block metadata storage (`block_metadata` table), IndexedDB persistence, `getPageCount()` for distinct page statistics |
| `src/storage/VectorSearchAccelerator.ts` | In-memory HNSW index for fast approximate nearest neighbor search; wraps SQLiteVectorStore with automatic fallback |
| `src/storage/VectorSearchAccelerator.types.ts` | Configuration interfaces and default HNSW parameters |
| `src/storage/cosineSimilarity.ts` | Embedding BLOB encode/decode, cosine similarity computation |
| `src/storage/migrateLegacy.ts` | Migration from legacy Orama JSON blob to per-document rows |
| `src/storage/StorageProvider.ts` | StorageProvider interface (per-document + legacy methods) |
| `src/storage/createStorageProvider.ts` | Factory: creates SQLiteVectorStore or SettingsStorageProvider based on backend setting |
| `src/indexManager.ts`  | Incremental indexing, auto-index on change, re-index guard, threads embeddingEndpoint/embeddingProvider to embedding calls |
| `src/manager.ts`       | Orchestration: manual re-index, auto-indexer, query handling, passes provider settings to all embedding calls |
| `src/VectorDBManager.ts` | Legacy Orama database CRUD, persistence, vector search (settings backend only) |
| `src/cooldownManager.ts` | Cooldown timer management, auto-indexer suppression logic |
| `src/buttonState.ts`   | Pure function for deriving re-index button visual state |
| `src/components/AutoEmbedToggle.tsx` | Toggle switch component for enabling/disabling auto-embed |
| `src/settings.ts`      | Plugin settings schema including indexing mode, embedding model, embedding provider, embedding endpoint, storage backend, and `autoEmbedEnabled` |
| `src/tokenizer.ts`     | Lazy-loaded cl100k_base tokenizer wrapper; uses dynamic `import()` for the ~1.5 MB encoding table to keep the main bundle small (~512 KB) |
| `src/main.tsx`         | Plugin entry point with lazy storage provider proxy that defers SQLite/WASM initialization until first use, preventing startup blocking |
