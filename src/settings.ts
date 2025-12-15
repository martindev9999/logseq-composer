import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin';

// our LiteLLM server is only configured with these models
const settings: SettingSchemaDesc[] = [
  {
    key: 'selectedModel',
    type: 'enum',
    title: 'Selected Model',
    description: 'Choose the model to use for the plugin (powered by LITELLM)',
    default: 'gpt-3.5-turbo',
    enumChoices: [
      'gpt-3.5-turbo',
      'gpt-4',
      'gpt-4o',
      'claude-2',
      'claude-3-opus',
      'gemini-pro',
      'codestral/codestral-latest',
      'deepseek-chat'
    ],    
    enumPicker: 'select'
  },
  {
    key: 'prompt',
    type: 'string',
    title: 'AI prompt',
    description: 'This text is input in front of every query.\n("context" is variables passed to the ai, leave it in the prompt so the AI knows what to do with your data)',
    default: 'You are an AI assistant built into LogSeq. answer based on context. newer context takes priority',
  },
  {
    key: 'LiteLLMLink',
    type: 'string',
    title: 'LiteLLM api link',
    description: 'LiteLLM\'s api endpoint, replace with your own if you want custom models',
    default: 'http://172.105.80.74:4000/chat/completions',
  },
  {
    key: 'apiKey',
    type: 'string',
    title: 'API Key',
    description: 'Enter your API key for the service',
    default: 'sk-proj-1234',
  },
  {
    key: 'advancedHeading',
    type: 'heading',
    title: 'Advanced',
    description: 'Only change these settings if you are confident you know what they do.',
    default: '',
  },
  {
    key: 'useLLMKeyForEmbeddings',
    type: 'boolean',
    title: 'Advanced — use chat API key for embeddings',
    description: 'Recommended: Leave enabled so that the API key you set for chat/LLM calls determines the embedding setting. Turn off only if you need to define a different embedding model.',
    default: true,
  },
  {
    key: 'EmbeddingApiKey',
    type: 'string',
    title: 'Embedding API key override',
    description: 'Leave blank to reuse the chat API key. Provide only if your embedding provider needs a different key.',
    default: '',
  },
  {
    key: 'embeddingModel',
    type: 'string',
    title: 'Embedding model',
    description: 'Model identifier sent to the embedding endpoint (e.g. "text-embedding-3-small" or provider-specific name).',
    default: 'text-embedding-3-small',
  },
  {
    key: 'embeddingEndpoint',
    type: 'string',
    title: 'Embedding endpoint',
    description: 'Full URL for embeddings (LiteLLM /embeddings or provider-native endpoint). Defaults to a LiteLLM endpoint so it mirrors your chat setup.',
    default: 'http://172.105.80.74:4000/embeddings',
  },
  {
    key: 'embeddingAuthHeader',
    type: 'string',
    title: 'Embedding auth header',
    description: 'HTTP header used for embedding auth. Most providers use "Authorization".',
    default: 'Authorization',
  },
  {
    key: 'embeddingAuthScheme',
    type: 'string',
    title: 'Embedding auth scheme/prefix',
    description: 'Text prepended before the embedding key (e.g. "Bearer"). Leave empty to send the raw key.',
    default: 'Bearer',
  }
];

export default settings;
