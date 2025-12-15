import { VectorDBSchemaDynamic } from 'types';

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

export async function getEmbeddingsAllNotes(
  config: EmbeddingConfig,
): Promise<{ embeddings: VectorDBSchemaDynamic[]; dimension: number }> {
  const pages = (await logseq.Editor.getAllPages()) ?? [];
  const allNotesEmbeddings: VectorDBSchemaDynamic[] = [];
  let firstDimension: number | null = null;

  for (const page of pages) {
    const pagecontent = await logseq.Editor.getPageBlocksTree(page.uuid);
    let wholePageContent = `note_id: ${page.id}\nnote_name: ${page.name}\nnote_content: \n\n`;

    for (const element of pagecontent) {
      wholePageContent = `${wholePageContent}- ${element.content}\n`;
    }

    try {
      const { embedding, dimension } = await generateEmbedding(wholePageContent, config, {
        retries: 1,
      });
      if (firstDimension == null) {
        firstDimension = dimension;
      }
      allNotesEmbeddings.push({
        id: page.id.toString(),
        lastUpdated: page.updatedAt ?? 0,
        content: wholePageContent,
        embedding,
      });
    } catch (err) {
      console.error('Embedding failed for page:', page.name, err);
      // Skip this page but continue indexing others.
      continue;
    }
  }

  if (firstDimension == null) {
    throw new Error('No embeddings were generated. Verify your embedding settings.');
  }

  return { embeddings: allNotesEmbeddings, dimension: firstDimension };
}
