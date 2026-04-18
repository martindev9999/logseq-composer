import { vi } from 'vitest';

// ---- Module mocks (relative paths) ----

vi.mock('./LLMManager', () => ({
  queryLiteLLM: vi.fn(),
}));

vi.mock('./embedManager', () => ({
  useGenerateEmbedding: vi.fn(),
  clearRefCache: vi.fn(),
}));

vi.mock('./VectorDBManager', () => ({
  getOrLoadVectorDatabase: vi.fn(),
  loadVectorDatabase: vi.fn(),
  vectorSearchOramaDB: vi.fn(),
}));

vi.mock('./indexManager', () => ({
  checkAndIndexUpdatedPages: vi.fn(),
  startPageIndexingOnChange: vi.fn(),
}));

vi.mock('./storage/SQLiteVectorStore', () => ({
  SQLiteVectorStore: vi.fn(),
}));

// Import mocked modules via relative paths
import { queryLiteLLM } from './LLMManager';
import { getOrLoadVectorDatabase, vectorSearchOramaDB } from './VectorDBManager';
import { useGenerateEmbedding } from './embedManager';
import { clearConversationHistory, handleQuery } from './manager';

const mockedQueryLiteLLM = vi.mocked(queryLiteLLM);
const mockedUseGenerateEmbedding = vi.mocked(useGenerateEmbedding);
const mockedGetOrLoadVectorDatabase = vi.mocked(getOrLoadVectorDatabase);
const mockedVectorSearchOramaDB = vi.mocked(vectorSearchOramaDB);

/** Minimal mock settings object */
function makeSettings(overrides: Record<string, any> = {}) {
  return {
    prompt: 'You are a helpful assistant.',
    selectedModel: 'gpt-4',
    apiKey: 'test-key',
    LiteLLMLink: 'https://example.com/v1/chat/completions',
    EmbeddingApiKey: 'embed-key',
    embeddingModel: 'text-embedding-ada-002',
    embeddingEndpoint: 'https://example.com/v1/embeddings',
    embeddingProvider: 'openai',
    ...overrides,
  };
}

/** Minimal mock storage provider (legacy path — no searchByVector) */
function makeLegacyStorageProvider(): StorageProvider {
  return {
    clear: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(null),
  };
}

describe('handleQuery – edit mode', () => {
  beforeEach(() => {
    clearConversationHistory();

    // Mock global logseq object
    (globalThis as any).logseq = {
      Editor: {
        getCurrentPage: vi.fn().mockResolvedValue({
          name: 'Test Page',
          uuid: 'page-uuid',
          id: 1,
        }),
        getPageBlocksTree: vi.fn().mockResolvedValue([
          { uuid: 'b-1', content: 'Block one', children: [] },
        ]),
      },
    };

    // Mock embedding to return a dummy vector
    mockedUseGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3] as any);

    // Legacy path: mock Orama vector search to return empty results
    mockedGetOrLoadVectorDatabase.mockResolvedValue({} as any);
    mockedVectorSearchOramaDB.mockResolvedValue({ hits: [], count: 0 } as any);

    // Suppress console noise
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).logseq;
  });

  it('appends edit system prompt to system message when editMode is true', async () => {
    const editResponse = `Here are the changes:\n\`\`\`json-edit\n[{ "action": "insert", "parentBlockUUID": "b-1", "content": "New block" }]\n\`\`\`\nDone!`;

    mockedQueryLiteLLM.mockResolvedValue({
      choices: [{ message: { content: editResponse } }],
    });

    await handleQuery('add a block', makeSettings(), makeLegacyStorageProvider(), undefined, true);

    expect(mockedQueryLiteLLM).toHaveBeenCalledTimes(1);
    const messages = mockedQueryLiteLLM.mock.calls[0][0];
    const systemMsg = messages.find((m: any) => m.role === 'system');

    // The system message should contain the edit system prompt keywords
    expect(systemMsg?.content).toContain('EDIT MODE INSTRUCTIONS');
    expect(systemMsg?.content).toContain('json-edit');
    expect(systemMsg?.content).toContain('blockUUID');
    expect(systemMsg?.content).toContain('parentBlockUUID');
  });

  it('includes block tree context in user message when editMode is true', async () => {
    mockedQueryLiteLLM.mockResolvedValue({
      choices: [{ message: { content: 'No edits needed.' } }],
    });

    await handleQuery('update the heading', makeSettings(), makeLegacyStorageProvider(), undefined, true);

    const messages = mockedQueryLiteLLM.mock.calls[0][0];
    const userMsg = messages.find((m: any) => m.role === 'user');

    // The user message should contain the page context from buildPageContextMessage
    expect(userMsg?.content).toContain('Test Page');
    expect(userMsg?.content).toContain('[uuid:b-1]');
    expect(userMsg?.content).toContain('Block one');
  });

  it('parses edit commands from LLM response and returns EditQueryResult', async () => {
    const editResponse = [
      'I will make these changes:',
      '```json-edit',
      '[',
      '  { "action": "update", "blockUUID": "b-1", "content": "Updated block one" },',
      '  { "action": "insert", "parentBlockUUID": "b-1", "content": "Child block" }',
      ']',
      '```',
      'Changes complete.',
    ].join('\n');

    mockedQueryLiteLLM.mockResolvedValue({
      choices: [{ message: { content: editResponse } }],
    });

    const result = await handleQuery('update block one', makeSettings(), makeLegacyStorageProvider(), undefined, true);

    // Should return EditQueryResult, not a plain string
    expect(typeof result).toBe('object');
    const editResult = result as EditQueryResult;

    expect(editResult.commands).toHaveLength(2);
    expect(editResult.commands[0]).toEqual({
      action: 'update',
      blockUUID: 'b-1',
      content: 'Updated block one',
    });
    expect(editResult.commands[1]).toEqual({
      action: 'insert',
      parentBlockUUID: 'b-1',
      content: 'Child block',
    });

    // text should have json-edit blocks stripped
    expect(editResult.text).not.toContain('json-edit');
    expect(editResult.text).toContain('I will make these changes:');
    expect(editResult.text).toContain('Changes complete.');
  });

  it('returns plain string when editMode is false', async () => {
    const plainResponse = 'This page contains notes about testing.';

    mockedQueryLiteLLM.mockResolvedValue({
      choices: [{ message: { content: plainResponse } }],
    });

    const result = await handleQuery('what does this page say?', makeSettings(), makeLegacyStorageProvider(), undefined, false);

    expect(typeof result).toBe('string');
    expect(result).toBe(plainResponse);
  });

  it('returns plain string when editMode is undefined', async () => {
    const plainResponse = 'Here is a summary of your notes.';

    mockedQueryLiteLLM.mockResolvedValue({
      choices: [{ message: { content: plainResponse } }],
    });

    const result = await handleQuery('summarize my notes', makeSettings(), makeLegacyStorageProvider());

    expect(typeof result).toBe('string');
    expect(result).toBe(plainResponse);
  });

  it('does not append edit system prompt when editMode is false', async () => {
    mockedQueryLiteLLM.mockResolvedValue({
      choices: [{ message: { content: 'Normal response.' } }],
    });

    await handleQuery('hello', makeSettings(), makeLegacyStorageProvider(), undefined, false);

    const messages = mockedQueryLiteLLM.mock.calls[0][0];
    const systemMsg = messages.find((m: any) => m.role === 'system');

    expect(systemMsg?.content).not.toContain('EDIT MODE INSTRUCTIONS');
  });

  it('returns EditQueryResult with empty commands when LLM response has no json-edit blocks', async () => {
    mockedQueryLiteLLM.mockResolvedValue({
      choices: [{ message: { content: 'The page looks good, no changes needed.' } }],
    });

    const result = await handleQuery('review this page', makeSettings(), makeLegacyStorageProvider(), undefined, true);

    const editResult = result as EditQueryResult;
    expect(editResult.commands).toEqual([]);
    expect(editResult.text).toContain('no changes needed');
  });
});
