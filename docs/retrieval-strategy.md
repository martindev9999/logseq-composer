# Retrieval Strategy

## Overview

Logseq Composer uses Retrieval-Augmented Generation (RAG) to provide the LLM with relevant context from the user's notes. When a user sends a query, the plugin runs a hybrid search pipeline that combines BM25 keyword search with vector similarity search, merges results via Reciprocal Rank Fusion (RRF), and injects the top-ranked chunks into the LLM prompt alongside conversation history and the currently open page.

## Retrieval Pipeline

```
User Query
    │
    ├──────────────────────────────────┐
    ▼                                  ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│ 1a. Classify query       │  │ 1b. Embed the query      │  useGenerateEmbedding(query)
│     classifyQuery(query) │  │     (selected model)     │
│     → keyword/semantic/  │  └────────────┬─────────────┘
│       mixed + weights    │               │
└────────────┬─────────────┘               │
             │                             │
             ├─────────────┬───────────────┤
             ▼             │               ▼
┌──────────────────────┐   │  ┌──────────────────────────┐
│ 2a. BM25 keyword     │   │  │ 2b. Vector similarity    │  accelerator.searchByVector()
│     search            │   │  │     search (HNSW index   │
│     bm25Index.search()│   │  │     or brute-force       │
│     - top 5 results   │   │  │     fallback)            │
└──────────┬────────────┘   │  │     - threshold: 0.5     │
           │                │  │     - top 5 results      │
           │                │  └────────────┬──────────────┘
           │                │               │
           ▼                │               ▼
┌──────────────────────────────────────────────┐
│ 3. Merge with RRF          mergeWithRRF()    │
│    - weighted by query classification        │
│    - deduplicate by chunk ID                 │
│    - top 5 fused results                     │
└────────────────────┬─────────────────────────┘
                     │
                     ▼
┌──────────────────────────┐
│ 4. Build LLM prompt      │
│    - System prompt        │
│    - Conversation history │
│    - Current page context │
│    - Retrieved documents  │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 5. Query LLM via LiteLLM │  queryLiteLLM(prompt, model, apiKey, endpoint)
└──────────────────────────┘
```

## Step 1a: Query Embedding

The user's query text is embedded using the same model, provider, and endpoint used for indexing. The model is configurable (default: `text-embedding-3-small`), producing a vector whose dimensions depend on the selected model (384 to 3072 dimensions).

- Same truncation rules apply (safety truncation to the model's maxTokens limit), though queries are typically short
- Same 30-second timeout applies
- Provider-specific request format is used (OpenAI: `input` field with auth header; Ollama: `prompt` field without auth)
- If embedding fails, vector search is skipped entirely and the query proceeds with only the current page as context

## Step 1b: Query Classification

The query is classified by `classifyQuery()` to determine how to weight BM25 vs. vector results during RRF merging. The classifier uses heuristic detection of keyword indicators:

- URL patterns (`http://`, `https://`, domain-like strings)
- File paths (`/path/to/file`, `C:\path`, `./relative`)
- Code-like tokens (camelCase, snake_case, method calls, brackets/braces)
- Quoted phrases (text in single or double quotes)
- Special characters (regex-like patterns, `*`, `?`, `^`, etc.)

Decision logic: ≥2 indicators → `keyword`, 1 indicator → `mixed`, 0 indicators → `semantic`.

| Category   | `bm25Weight` | `vectorWeight` |
|-----------|-------------|---------------|
| `keyword`  | 1.5         | 0.5           |
| `mixed`    | 1.0         | 1.0           |
| `semantic` | 0.5         | 1.5           |

If the classifier throws, the pipeline defaults to `mixed` (equal weights).

## Step 2: Hybrid Search

For the default backend (SQLiteVectorStore), the pipeline runs BM25 keyword search and vector similarity search in parallel, then merges results via RRF. This is orchestrated by `hybridSearch()` in `src/hybridSearch.ts`.

### BM25 Keyword Search

An in-memory `BM25Index` is built from all document content in the SQLite `documents` table at initialization and kept in sync via upsert/delete/clear lifecycle hooks. At query time, the query is tokenized (split on whitespace/punctuation, lowercased) and scored against the index using the BM25 (Okapi BM25) ranking formula with parameters k1=1.2, b=0.75.

| Parameter | Value | Description                        |
|----------|-------|------------------------------------|
| limit    | 5     | Maximum number of BM25 results     |

### Vector Similarity Search

The `VectorSearchAccelerator` wraps an in-memory HNSW (Hierarchical Navigable Small World) index built from all embeddings in the SQLite `documents` table at startup. When the HNSW index is ready, queries are routed through it for sub-5ms approximate nearest neighbor search. When the index is not ready (during construction, after an error, or if the WASM backend fails to load), queries fall back transparently to the brute-force cosine similarity scan in `SQLiteVectorStore`.

| Parameter       | Value   | Description                                      |
|----------------|---------|--------------------------------------------------|
| similarity     | 0.5     | Minimum cosine similarity threshold               |
| limit          | 5       | Maximum number of results returned                |
| efSearch       | 64      | HNSW query-time search depth (controls recall vs speed) |
| M              | 16      | HNSW graph connectivity (bi-directional links per node) |

The HNSW index is volatile — it lives only in memory and is rebuilt from SQLite on each plugin startup. Incremental updates (add/remove/upsert) keep it synchronized during a session. A full rebuild is triggered automatically when the embedding dimension changes (model switch) or when tombstone accumulation exceeds 20% of capacity.

### RRF Merging

Both result lists are passed to `mergeWithRRF()`, which fuses them using weighted Reciprocal Rank Fusion:

1. All unique chunk IDs from both lists are collected
2. Each chunk gets a rank in each list (1-indexed); chunks missing from a list receive a penalty rank of `listLength + 1`
3. Fused score: `bm25Weight * 1/(K + rank_bm25) + vectorWeight * 1/(K + rank_vector)` (K defaults to 60)
4. Results are deduplicated by chunk ID, sorted by fused score descending, and limited to 5

### Fallback Behavior

- If the HNSW index is not ready → vector search falls back to brute-force cosine similarity in SQLiteVectorStore (warning logged)
- If vector search fails entirely → BM25 results only (warning logged)
- If BM25 search fails → vector results only (warning logged)
- If both fail → empty result array, LLM proceeds without additional context

### Legacy Backend (Orama via SettingsStorageProvider)

When using the `settings` backend, search goes through Orama's in-memory vector index with a 0.65 similarity threshold. The legacy path uses `rerankWithRRF()` (single-list reranking) and is not affected by the hybrid search pipeline.

### What Gets Returned

Each search hit contains:
- `id` — the document/chunk identifier
- `content` — the full chunk text that was embedded
- `score` — original similarity or BM25 score
- `rrfScore` — fused RRF score used for final ranking

### Reranking

For the hybrid search path (SQLiteVectorStore), results are merged and ranked by `mergeWithRRF()`, which performs dual-list RRF fusion with classification-based weights. The legacy Orama path continues to use `rerankWithRRF()` for single-list reranking that combines vector similarity rank with keyword match rank.

### No Results Scenario

If no documents meet the similarity threshold and BM25 returns no matches, the results array is empty and no additional context is added to the prompt. The LLM still receives the system prompt, conversation history, and current page context.

## Step 3: Prompt Construction

The LLM prompt is assembled in this order:

```
{settings.prompt}                          ← System prompt from settings (includes block citation instructions)

Conversation History:                      ← Last 6 messages (if any)
User: {message 1}
Assistant: {response 1}
User: {message 2}
...

Current Page Context:                      ← Currently open page (if available)
current_page_open_id: {page.id}
current_page_open_name: {page.name}
current_page_open_content: {block contents with [block:uuid] annotations}

Additional Context from Knowledge Base:    ← Retrieved documents (if any)
{hit 1 full page content with [block:uuid] annotations}

{hit 2 full page content with [block:uuid] annotations}

{hit 3 full page content with [block:uuid] annotations}
...
```

The system prompt instructs the LLM to cite specific blocks using `((block-uuid))` notation, using only UUIDs from the `[block:uuid]` annotations in the provided context. The LLM should not fabricate UUIDs.

### Prompt Components

| Component              | Source                          | Max Size              | Optional |
|-----------------------|--------------------------------|-----------------------|----------|
| System prompt         | `settings.prompt`              | User-defined          | No       |
| Conversation history  | In-memory array                | Last 6 messages       | Yes      |
| Current page context  | `logseq.Editor.getCurrentPage()` | Full page content   | Yes      |
| Retrieved documents   | Vector search results          | Up to 5 full pages    | Yes      |

### Conversation History

- Stored in an in-memory array (not persisted across plugin reloads)
- Limited to the most recent 6 messages (configurable via `MAX_HISTORY_LENGTH`)
- When the array exceeds 12 entries (2x max), older entries are trimmed
- Each entry has a role (`user` or `assistant`) and content

### Current Page Context

- Fetched via `logseq.Editor.getCurrentPage()` at query time
- If the user has a page open, its block tree is extracted and included
- If no page is open or fetching fails, this section is silently omitted

### Retrieved Documents

- Each hit's `document.content` is appended as-is (the full page text that was embedded)
- Documents are separated by double newlines
- No deduplication — if the current page also appears in search results, its content appears twice in the prompt

## Step 4: LLM Query

The assembled prompt is sent to the LLM via LiteLLM using proper message roles:

- **System message**: The plugin settings prompt (formatting rules, citation instructions)
- **User message**: Conversation history + current page context + retrieved documents

This separation ensures the LLM treats formatting rules (like `[[page name]]` and `((block-uuid))` notation) as authoritative system instructions rather than casual user text.

- **Endpoint**: Configurable via `settings.LiteLLMLink` (default: public LiteLLM instance)
- **Model**: Configurable via `settings.selectedModel` (default: `gpt-3.5-turbo`)
- **Auth**: The `settings.apiKey` is passed both as a Bearer token and in the request body
- **Message format**: Two messages — a `system` message (plugin prompt with formatting rules) and a `user` message (context + conversation history + query)
- **Max output tokens**: Automatically set per model — GPT-4o gets 16,384, GPT-4 gets 8,192, GPT-3.5-turbo gets 4,096, etc. Unknown models fall back to 4,096. See `MODEL_MAX_TOKENS` in `LLMManager.ts`.
- **No streaming**: The response is awaited in full before displaying
- **Cancellable**: The user can click the stop button to abort the LLM request mid-flight via `AbortController`

The assistant's response is added to the conversation history for future context.

## Step 5: Response Rendering

When the LLM response contains `((block-uuid))` patterns, the chat renderer:

1. Applies `pageLinkParser.transformToMarkdownLinks()` to convert `[[page]]` patterns to markdown links
2. Applies `blockRefParser.transformToMarkdownLinks()` to convert `((uuid))` patterns to `[((uuid))](logseq://block/uuid)` markdown links
3. ReactMarkdown renders the response with `transformLinkUri` set to passthrough (disabling default URL sanitization that would strip the `logseq://` protocol), and custom `components.a` overrides that:
   - Detect `logseq://page/` links → render as `PageLink` components (blue, navigates to page)
   - Detect `logseq://block/` links → render as `BlockLink` components (teal, navigates to block)
   - All other links → render as `CtrlLink` (external links)

The `BlockLink` component looks up the block's metadata (page name, content preview) from the `block_metadata` table to display a meaningful label. If no metadata is found, it falls back to showing the first 8 characters of the UUID. Clicking a block reference calls `logseq.Editor.scrollToBlockInPage()` to navigate Logseq to that block.

## Fallback Behavior

The retrieval pipeline is wrapped in a try/catch. If any step fails (embedding, search, or database load), the query still proceeds:

- `vectorContext` is set to an empty string
- The LLM receives only the system prompt, conversation history, and current page context
- The error is logged to console but not shown to the user

This means the plugin always works — even without embeddings configured — by falling back to the currently active note as context.

If the user stops indexing mid-run via the stop button, all embeddings generated up to the stop point are persisted in the vector database. Search proceeds with this partial set of embeddings — pages that were not yet indexed at the time of stopping will not appear in vector search results until the next indexing run completes them. This is a graceful degradation: the retrieval pipeline still works and returns results from whatever has been indexed so far, just with potentially incomplete coverage of the user's graph.

## AI Edit Mode

When the user enables the "AI Edit" toggle in the chat toolbar, the query pipeline changes:

1. The current page's block tree is fetched via `getActivePageContext()` and formatted with block UUIDs
2. An edit-mode system prompt supplement (`buildEditSystemPrompt()`) is appended, instructing the LLM to emit structured edit commands inside ` ```json-edit ` fenced code blocks
3. The LLM response is parsed by `parseEditCommands()` which extracts and validates commands from json-edit blocks
4. Valid commands are executed sequentially by `executeAll()` via the Logseq Editor API (`insertBlock`, `updateBlock`, `removeBlock`)
5. A `ChangeSummary` component displays the results (success/failure counts and per-command details)

### Edit Command Schema

Each command is a JSON object:

| Field | Type | Required For | Description |
|-------|------|-------------|-------------|
| `action` | `"insert"` \| `"update"` \| `"delete"` | All | The operation to perform |
| `blockUUID` | string | update, delete | UUID of the target block |
| `parentBlockUUID` | string | insert | UUID of the parent block to insert under |
| `content` | string | insert, update | Block content in Logseq markdown format |
| `siblingOrder` | number | (optional) | Position among siblings (0 = first child) |

### Safety

- If no page is open, edit mode is silently disabled for that query and a warning is shown
- Invalid commands (malformed JSON, missing required fields) are logged and skipped
- Each command execution is wrapped in try/catch — a failed command doesn't prevent subsequent commands from running

## Limitations

- **Full chunk injection**: Retrieved chunks are injected in full, which can consume significant prompt tokens for long pages.
- **No deduplication**: The current page may appear both as "Current Page Context" and in "Additional Context" if it's a top search result.
- **Fixed parameters**: Similarity threshold (0.5) and result limit (5) are hardcoded, not configurable via settings.
- **Single-turn LLM call**: The full context is sent as a system + user message pair. No multi-turn chat API usage with alternating roles.
- **No timeout on LLM call**: The `queryLiteLLM()` fetch has no built-in timeout, but the user can cancel it via the stop button in the chat UI.
- **No streaming**: Responses are awaited in full before displaying. Long responses may take several seconds to appear.
- **Model-specific output limits**: Each model has a hardcoded max output token limit (e.g., 16,384 for GPT-4o). Responses that exceed this limit are truncated by the API.
- **Brute-force fallback**: When the HNSW index is unavailable (WASM load failure, during rebuild), the SQLite backend falls back to scanning all document embeddings. This is fast for typical graph sizes but scales linearly with document count. The HNSW index provides sub-5ms queries at 20k+ chunks.

## File Reference

| File                     | Responsibility                                          |
|-------------------------|---------------------------------------------------------|
| `src/manager.ts`        | `handleQuery()` — orchestrates the full retrieval pipeline |
| `src/embedManager.ts`   | `useGenerateEmbedding()` — embeds the query text (provider-aware: OpenAI or Ollama) |
| `src/storage/SQLiteVectorStore.ts` | `searchByVector()` — brute-force cosine similarity search (fallback); `getAllEmbeddings()` — bulk read for HNSW index construction |
| `src/storage/VectorSearchAccelerator.ts` | `VectorSearchAccelerator` — in-memory HNSW index for fast approximate nearest neighbor search with automatic brute-force fallback |
| `src/storage/VectorSearchAccelerator.types.ts` | Configuration and type definitions for the HNSW accelerator |
| `src/storage/cosineSimilarity.ts` | `cosineSimilarity()` — cosine similarity computation     |
| `src/bm25Index.ts`      | `BM25Index` — in-memory inverted index for BM25 keyword search |
| `src/queryClassifier.ts`| `classifyQuery()` — heuristic query classification (keyword/semantic/mixed) |
| `src/hybridSearch.ts`   | `hybridSearch()` — hybrid search pipeline orchestration   |
| `src/reranker.ts`       | `rerankWithRRF()` — single-list RRF reranking (legacy Orama path); `mergeWithRRF()` — dual-list RRF fusion (hybrid search) |
| `src/VectorDBManager.ts`| `vectorSearchOramaDB()` — legacy Orama vector search (settings backend only) |
| `src/LLMManager.ts`     | `queryLiteLLM()` — sends system + user messages to LLM via LiteLLM; `ChatMessage` type for message role typing; `MODEL_MAX_TOKENS` — per-model output token limits; `getMaxTokensForModel()` — lookup function |
| `src/editPromptBuilder.ts` | `buildEditSystemPrompt()` — edit-mode system prompt with json-edit schema; `buildPageContextMessage()` — formats page block tree for LLM |
| `src/editCommandParser.ts` | `parseEditCommands()` — extracts and validates edit commands from LLM response json-edit blocks |
| `src/blockExecutor.ts`  | `executeAll()` / `executeOne()` — executes edit commands via Logseq Editor API (insertBlock, updateBlock, removeBlock) |
| `src/blockTreeFormatter.ts` | `getActivePageContext()` — fetches and formats the current page's block tree with UUIDs for edit mode |
| `src/types/editTypes.ts` | TypeScript types for EditCommand, EditAction, ParseResult, ExecutionResult, OperationOutcome |
| `src/blockRefParser.ts` | `parse()`, `serialize()`, `transformToMarkdownLinks()` — detects and transforms `((uuid))` block references in LLM responses |
| `src/components/BlockLink.tsx` | `BlockLink` — clickable inline component for block references (teal, navigates to block via `scrollToBlockInPage`) |
| `src/components/ChatMessageList.tsx` | Chat message rendering with page link and block reference transformation pipeline |
| `src/settings.ts`       | Plugin settings (model, provider, endpoint, API keys, prompt with block citation instructions, storage backend) |
