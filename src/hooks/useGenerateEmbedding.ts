import { EmbeddingConfig, generateEmbedding } from '../embedManager';

export async function useGenerateEmbedding(
  inputText: string,
  config: EmbeddingConfig,
): Promise<number[]> {
  const { embedding } = await generateEmbedding(inputText, config);
  return embedding;
}
