# Logseq Composer ✍️

**Logseq Composer** is a plugin that connects your Logseq notes with any LLM using Retrieval-Augmented Generation (RAG).  
Hope you find it useful! 😀👍🍀🍷

### For the LLM to have access to your files you NEED TO RE-INDEX DB (bottom left green button). By default, only new or updated pages are indexed — this is fast even for large vaults.

> **Note**: After updating to a version with clickable block references, a **full re-index** is required to populate block metadata and add block UUID annotations to your chunks.

🎥 [Watch demo](https://www.youtube.com/watch?v=J0QDrz-Ccis)

**Support me to help the project ❤️**

<a href="https://buymeacoffee.com/martinminarik" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 50px !important;width: 178px !important;" ></a>

---

### ⚙️ How It Works

- Uses [OpenAI embeddings](https://platform.openai.com/docs/guides/embeddings) or local [Ollama](https://ollama.com/) models for semantic vector search
- Stores each document embedding as an individual row in a SQLite database (via [sql.js](https://github.com/sql-js/sql.js)), persisted to IndexedDB
- Retrieves related notes using RAG (HNSW-accelerated vector search + BM25 keyword search + RRF reranking)
- Passes context into **any LLM** using [LiteLLM](https://github.com/BerriAI/litellm)
- **AI Edit mode**: Toggle "AI Edit" in the toolbar to let the LLM insert, update, and delete blocks on your current page directly from the chat. The LLM sees your page's block tree (with UUIDs) and emits structured edit commands that the plugin executes via the Logseq Editor API
- **Clickable block references**: The LLM cites specific blocks using `((uuid))` notation, rendered as teal-colored inline links that navigate directly to the source block on click
- **Clickable page links**: Page names in `[[double brackets]]` are rendered as blue inline links that open the page in Logseq on click
- Supports **all LiteLLM-compatible models**, including ChatGPT 4o, Claude, DeepSeek, Gemini, and local models via OLLAMA (with extra configuration)
- Automatically migrates existing Orama-based embeddings to the new per-document format — no re-indexing needed
- **Stop & cooldown**: While indexing is in progress, the Re-Index button becomes a stop button. Clicking stop halts indexing after the current page and starts a 1-minute cooldown during which the button is disabled and auto-indexing is suppressed
- Plugin still runs without embeddings — the currently active note will be passed as fallback context

---

### ✏️ AI Edit Mode

Toggle the "AI Edit" switch in the chat toolbar to enable block editing from the chat interface. When enabled:

1. The plugin sends the current page's block tree (with block UUIDs) to the LLM alongside your message
2. The LLM can respond with structured edit commands to insert, update, or delete blocks
3. Commands are executed automatically via the Logseq Editor API
4. A change summary shows what was modified after each edit

Supported operations:
- **Insert**: Add a new child block under any existing block
- **Update**: Change the content of an existing block (including properties like `priority:: high`)
- **Delete**: Remove a block

If no page is open when AI Edit is enabled, the plugin falls back to normal chat mode with a warning.

---

### ⚠️ Early Stage Notice

This is my **first Logseq plugin**, and it's still in **heavy development** with updates coming soon.  
If something breaks or you'd like to suggest a feature or improvement:

- Please be patient 🙏
- [Create an issue](https://github.com/martindev9999/logseq-composer/issues)

---

### 🛠 Plugin Settings (Detailed)

You can configure these in the Logseq plugin UI:

- **`selectedModel`**  
  - Example: `"gpt-4o"`  
  - The name of the LLM model to use. This is passed directly into LiteLLM, so it should match a valid model from the provider you're using.

- **`prompt`**  
  - This is the custom prompt shown to the LLM with every query.  
  - The word `"context"` inside your prompt is replaced by the text content pulled from your notes (via vector search or current page).  
  - Default is tuned for productivity, but you can customize it for different LLM personalities or task types.

- **`EmbeddingApiKey`**  
  - Used for generating vector embeddings of your notes (for semantic search).  
  - Required for OpenAI embedding models. Not needed when using Ollama (local models).  
  - If not set and provider is OpenAI, vector search is skipped and only the current Logseq note is passed as context.  
  - You do **not** need this if you're using Ollama or if you're okay with simpler functionality.

- **`embeddingModel`**  
  - Choose the embedding model for vector search.  
  - OpenAI models: `text-embedding-3-small` (default), `text-embedding-ada-002`, `text-embedding-3-large`.  
  - Ollama models: `nomic-embed-text` (768d, 8192 tokens), `mxbai-embed-large` (1024d, 512 tokens), `all-minilm` (384d, 256 tokens).  
  - Changing this will re-create the vector database.

- **`embeddingProvider`**  
  - Choose between `"openai"` (default) and `"ollama"`.  
  - **openai**: Cloud-based embeddings via the OpenAI API. Requires an API key.  
  - **ollama**: Local embeddings via a running Ollama instance. No API key needed.

- **`embeddingEndpoint`**  
  - The URL for embedding API requests.  
  - Default: `https://api.openai.com/v1/embeddings`  
  - For Ollama, set to `http://localhost:11434/api/embeddings`.  
  - Leave empty to use the default OpenAI endpoint.

- **`LiteLLMLink`**   
  - The full endpoint to your LiteLLM instance.  
  - Default value:  
    ```
    http://127.0.0.1:4000/chat/completions
    ```
  - This defaults to a local LiteLLM instance. Install and run [LiteLLM](https://github.com/BerriAI/litellm) locally, or point this to your own hosted instance.

- **`apiKey`**  
  - The API key used to authenticate your request with the actual LLM provider (OpenAI, Anthropic, Google, etc.).  
  - This key is passed to LiteLLM which handles routing and forwarding it properly.  
  - **Keep this secure**, especially if using shared or public LiteLLM endpoints.

- **`indexingMode`**  
  - Choose between `"incremental"` (default) and `"full"`.  
  - **Incremental**: Only embeds pages that are new or have been updated since the last index. Fast and cost-efficient.  
  - **Full**: Wipes the vector database and re-embeds every page from scratch. Use this if you suspect the index is corrupted or want a clean rebuild.  
  - ⚠️ **Important**: After running a full re-index, switch this setting back to `"incremental"`. Leaving it on `"full"` means every future Re-Index click will delete all your existing embeddings and start over, wasting API credits and time.

- **`storageBackend`**  
  - Choose between `"sqlite"` (default) and `"settings"`.  
  - **sqlite**: Per-document storage in a sql.js SQLite database persisted to IndexedDB. Scales to large graphs without memory issues.  
  - **settings**: Legacy Orama-based storage in Logseq plugin settings. Suitable for small graphs only.

- **`autoEmbedEnabled`**  
  - Default: `true`  
  - Controls whether the plugin automatically generates embeddings when pages are edited.  
  - When enabled, page edits trigger background indexing after the configured debounce delay.  
  - When disabled, only manual re-indexing (via the Re-Index button) generates embeddings.  
  - The toggle can also be controlled from the "Auto-Embed: On/Off" switch in the chat panel toolbar.

- **`autoIndexDebounceSeconds`**  
  - Default: `300` (5 minutes)  
  - How long to wait (in seconds) after the last page change before auto-indexing starts.  
  - Higher values reduce API calls but delay index updates. Minimum 10 seconds.  
  - Set to a lower value (e.g., `60`) if you want faster index updates, or higher (e.g., `600`) to save API credits.

---

### 📚 Documentation

For deeper technical details, see the docs in the [`docs/`](./docs/) folder:

- [Embedding Strategy](./docs/embedding-strategy.md) — how pages are chunked, embedded, and stored; startup performance; auto-indexing and stop/cooldown behavior
- [Chunking Strategy](./docs/chunking-strategy.md) — block-based chunking, semantic grouping, and overlap
- [Retrieval Strategy](./docs/retrieval-strategy.md) — hybrid search pipeline (BM25 + HNSW vector search + RRF reranking), AI Edit mode, prompt construction

---

### 📦 Installation

#### Prerequisites

This plugin requires a running [LiteLLM](https://github.com/BerriAI/litellm) proxy server. LiteLLM is a lightweight proxy that provides a unified OpenAI-compatible API for 100+ LLM providers (OpenAI, Anthropic, Google, local models, etc.).

**Quick setup:**

```bash
pip install litellm
litellm --model gpt-4o --port 4000
```

This starts a local proxy at `http://127.0.0.1:4000` that the plugin connects to by default. You can use any [LiteLLM-supported model](https://docs.litellm.ai/docs/providers) — just change the `--model` flag.

For persistent configuration, see the [LiteLLM docs](https://docs.litellm.ai/docs/).

#### Plugin setup

1. Install the plugin from the Logseq Marketplace (once approved), or build from source
2. Ensure LiteLLM is running (see above)
3. Open plugin settings and configure:
   - **`apiKey`** — your LLM provider API key (OpenAI, Anthropic, etc.)
   - **`selectedModel`** — the model name (must match what LiteLLM supports)
   - **`EmbeddingApiKey`** — (optional) API key for OpenAI embeddings, enables semantic search
   - **`LiteLLMLink`** — defaults to `http://127.0.0.1:4000/chat/completions`; change if your LiteLLM instance is elsewhere
4. Click the ✍️ icon in the Logseq toolbar to open the Composer panel
5. (Optional) Click "🔄 Re-Index" to build the vector database for semantic search

---

### 📄 License

This project is open-source and licensed under the **MIT License**.  
You're free to:
- Use
- Copy
- Modify
- Distribute

Please see the [`LICENSE`](./LICENSE) file for full details.
