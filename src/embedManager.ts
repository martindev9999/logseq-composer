import { VectorChunk } from 'types';

export type EmbeddingConfig = {
  endpoint: string;
  model: string;
  apiKey: string;
  authHeader: string;
  authScheme?: string;
};

type EmbeddingResult = {
  embedding: number[];
  dimension: number;
  model: string;
};

export type EmbeddingCapableSettings = {
  apiKey: string;
  LiteLLMLink?: string;
  EmbeddingApiKey?: string;
  useLLMKeyForEmbeddings?: boolean;
  embeddingModel?: string;
  embeddingEndpoint?: string;
  embeddingAuthHeader?: string;
  embeddingAuthScheme?: string;
};

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_EMBEDDING_ENDPOINT = 'https://api.openai.com/v1/embeddings';
const DEFAULT_AUTH_HEADER = 'Authorization';
const DEFAULT_AUTH_SCHEME = 'Bearer';

function deriveDefaultEmbeddingEndpoint(liteLLMEndpoint?: string): string {
  if (!liteLLMEndpoint) return DEFAULT_EMBEDDING_ENDPOINT;
  if (liteLLMEndpoint.endsWith('/chat/completions')) {
    return `${liteLLMEndpoint.replace('/chat/completions', '')}/embeddings`;
  }
  return `${liteLLMEndpoint.replace(/\/$/, '')}/embeddings`;
}

function buildAuthHeader(
  headerName: string,
  scheme: string | undefined,
  apiKey: string,
): Record<string, string> {
  if (!apiKey) return {};
  if (!headerName) return {};
  const trimmedScheme = scheme?.trim();
  if (!trimmedScheme) {
    return { [headerName]: apiKey };
  }
  return { [headerName]: `${trimmedScheme} ${apiKey}`.trim() };
}

export function resolveEmbeddingConfig(settings: EmbeddingCapableSettings): EmbeddingConfig {
  const apiKey =
    settings.useLLMKeyForEmbeddings === false
      ? settings.EmbeddingApiKey?.trim() ?? ''
      : settings.EmbeddingApiKey?.trim() || settings.apiKey;

  const rawEndpoint =
    settings.embeddingEndpoint?.trim() ||
    deriveDefaultEmbeddingEndpoint(settings.LiteLLMLink) ||
    DEFAULT_EMBEDDING_ENDPOINT;

  const endpoint =
    rawEndpoint?.endsWith('/chat/completions')
      ? rawEndpoint.replace(/\/chat\/completions$/, '/embeddings')
      : rawEndpoint;

  return {
    endpoint,
    model: settings.embeddingModel?.trim() || DEFAULT_MODEL,
    apiKey,
    authHeader: settings.embeddingAuthHeader?.trim() || DEFAULT_AUTH_HEADER,
    authScheme: settings.embeddingAuthScheme,
  };
}

async function requestEmbedding(
  inputText: string,
  config: EmbeddingConfig,
): Promise<EmbeddingResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeader(config.authHeader, config.authScheme, config.apiKey),
  };

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      input: inputText,
      api_key: config.apiKey, // Some proxies (LiteLLM) accept API key in-body for passthrough.
      stream: false,
    }),
  });

  let json: any;
  let raw: string | null = null;
  try {
    json = await response.json();
  } catch {
    try {
      raw = await (response as any).text?.();
    } catch {
      raw = null;
    }
  }

  if (!response.ok || json?.error) {
    const message = json?.error?.message || raw || `${response.status} ${response.statusText}`;
    throw new Error(
      `Embedding API error (endpoint: ${config.endpoint}, model: ${config.model}): ${message}`,
    );
  }

  const embedding: number[] | undefined = json?.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error(
      raw ||
        `Embedding API did not return an embedding vector (endpoint: ${config.endpoint}, model: ${config.model}).`,
    );
  }

  return {
    embedding,
    dimension: embedding.length,
    model: json?.data?.[0]?.model ?? config.model,
  };
}

export async function generateEmbedding(
  inputText: string,
  config: EmbeddingConfig,
  options: { retries?: number; retryDelayMs?: number } = {},
): Promise<EmbeddingResult> {
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 400;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await requestEmbedding(inputText, config);
    } catch (err) {
      lastError = err;
      if (attempt >= retries) break;
      await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unknown error while generating embedding.');
}

type ChunkOptions = {
  maxChunkSize?: number;
};

function flattenBlock(block: any): string {
  let result = block.content || '';
  if (block.children && Array.isArray(block.children)) {
    for (const child of block.children) {
      result += `\n- ${flattenBlock(child)}`;
    }
  }
  return result;
}

function chunkText(text: string, maxChunkSize: number): string[] {
  if (text.length <= maxChunkSize) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxChunkSize) {
    chunks.push(text.slice(i, i + maxChunkSize));
  }
  return chunks;
}

function getBlockIdentifier(block: any, fallback: string): string {
  if (typeof block?.uuid === 'string') return block.uuid;
  if (block?.uuid?.$uuid$) return block.uuid.$uuid$;
  if (block?.id != null) return String(block.id);
  return fallback;
}

export async function getEmbeddingsAllNotes(
  config: EmbeddingConfig,
  options: ChunkOptions = {},
): Promise<{ embeddings: VectorChunk[]; dimension: number }> {
  const maxChunkSize = options.maxChunkSize ?? 800;
  const pages = (await logseq.Editor.getAllPages()) ?? [];
  const allChunks: VectorChunk[] = [];
  let firstDimension: number | null = null;

  for (const page of pages) {
    const pagecontent = await logseq.Editor.getPageBlocksTree(page.uuid);
    let blockIndex = 0;

    try {
      for (const block of pagecontent) {
        const flattened = flattenBlock(block).trim();
        if (!flattened) {
          blockIndex++;
          continue;
        }
        const blockRef = getBlockIdentifier(block, `block-${blockIndex}`);
        const chunks = chunkText(flattened, maxChunkSize);

        for (let idx = 0; idx < chunks.length; idx++) {
          const chunkContent = `page: ${page.name}\nblock: ${blockRef}\n${chunks[idx]}`;
          const { embedding, dimension } = await generateEmbedding(chunkContent, config, {
            retries: 1,
          });
          if (firstDimension == null) {
            firstDimension = dimension;
          }

          allChunks.push({
            id: `${page.id}-${blockRef}-${idx}`,
            pageId: page.id.toString(),
            pageName: page.name,
            blockId: blockRef,
            lastUpdated: page.updatedAt ?? 0,
            content: chunkContent,
            embedding,
          });
        }
        blockIndex++;
      }
    } catch (err) {
      console.error('Embedding failed for page:', page.name, err);
      // Skip this page but continue indexing others.
      continue;
    }
  }

  if (firstDimension == null) {
    throw new Error('No embeddings were generated. Verify your embedding settings.');
  }

  return { embeddings: allChunks, dimension: firstDimension };
}
