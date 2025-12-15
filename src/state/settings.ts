import { atom, AtomEffect } from 'recoil';
import settings from '../settings';

export interface IPluginSettings {
  selectedModel: string;
  prompt: string;
  EmbeddingApiKey: string;
  LiteLLMLink: string;
  apiKey: string;
  VectorDBLogseqCopilot: string;
  useLLMKeyForEmbeddings: boolean;
  embeddingModel: string;
  embeddingEndpoint: string;
  embeddingAuthHeader: string;
  embeddingAuthScheme: string;
  VectorDBDimension?: number;
  VectorDBSchemaVersion?: number;
}

const defaultSettings = {
  ...settings.reduce(
    (result, item) => ({ ...result, [item.key]: item.default }),
    {},
  ),
  VectorDBLogseqCopilot: '',
} as IPluginSettings;

const settingsChangedEffect: AtomEffect<IPluginSettings> = ({ setSelf }) => {
  setSelf({ ...defaultSettings, ...(logseq.settings ?? {}) } as unknown as IPluginSettings);
  const unlisten = logseq.onSettingsChanged((newSettings) => {
    setSelf((prev) => ({ ...defaultSettings, ...prev, ...newSettings }));
  });
  return () => unlisten();
};

export const settingsState = atom<IPluginSettings>({
  key: 'settings',
  default: defaultSettings,
  effects: [settingsChangedEffect],
});
