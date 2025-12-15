import { create, insert, search } from '@orama/orama';
import { EmbeddingCapableSettings, generateEmbedding, resolveEmbeddingConfig } from '../embedManager';

// Simple smoke check to validate embedding settings and Orama vector flow.
export async function checkIfVectorDBIndexed(settings: EmbeddingCapableSettings): Promise<boolean> {
  try {
    const config = resolveEmbeddingConfig(settings);
    const first = await generateEmbedding('This is a test note.', config);
    const dimension = first.dimension;

    const oramaIndex = create({
      schema: {
        id: 'string',
        content: 'string',
        embedding: `vector[${dimension}]`,
      },
      id: 'main-orama-db',
    });
    insert(oramaIndex, {
      content: 'This is a test note.',
      embedding: first.embedding,
    });

    const probe = await generateEmbedding('This is note.', config);
    search(oramaIndex, {
      mode: 'vector',
      vector: {
        value: probe.embedding,
        property: 'embedding',
      },
      similarity: 0.85,
      limit: 10,
      offset: 0,
    });

    return true;
  } catch (error) {
    console.error('Error checking Orama index:', error);
    return false;
  }
}
