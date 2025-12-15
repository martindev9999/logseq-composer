import { create, insertMultiple, type Orama, search } from "@orama/orama";
import { persist, restore } from "@orama/plugin-data-persistence";
import { VectorDBSchemaDynamic } from "types";

export type VectorDBSchema = {
  id: 'string';
  lastUpdated: 'number';
  content: 'string';
  embedding: `vector[${number}]`;
};

type LoadVectorDBOptions = {
  forceNew?: boolean;
  dimension?: number;
};

export async function loadVectorDatabase(
  settings: any,
  options: LoadVectorDBOptions = {},
): Promise<Orama<VectorDBSchema>> {
  let oramaInstance: Orama<VectorDBSchema>;
  const desiredDimension = options.dimension ?? settings.VectorDBDimension ?? 1536;

  async function createNewDatabase(dim: number): Promise<Orama<VectorDBSchema>> {
    return await create({
      schema: {
        id: 'string',
        lastUpdated: 'number',
        content: 'string',
        embedding: `vector[${dim}]`,
      },
      id: 'main-orama-db',
    });
  }

  if (!settings.VectorDBLogseqCopilot || settings.VectorDBLogseqCopilot === '' || options.forceNew) {
    const freshDB = await createNewDatabase(desiredDimension);
    const jsonIndex = await persist(freshDB, 'json');
    await logseq.updateSettings({
      VectorDBLogseqCopilot: jsonIndex,
      VectorDBDimension: desiredDimension,
    });
    oramaInstance = await restore('json', jsonIndex);
  }

  else {

    try {
      oramaInstance = await restore('json', settings.VectorDBLogseqCopilot);
      const storedDimension = settings.VectorDBDimension;
      if (storedDimension && storedDimension !== desiredDimension && !options.forceNew) {
        console.warn(
          `Vector DB dimension mismatch (stored ${storedDimension} vs desired ${desiredDimension}). Rebuilding index.`,
        );
        const freshDB = await createNewDatabase(desiredDimension);
        const jsonIndex = await persist(freshDB, 'json');
        await logseq.updateSettings({
          VectorDBLogseqCopilot: jsonIndex,
          VectorDBDimension: desiredDimension,
        });
        oramaInstance = await restore('json', jsonIndex);
      }
    }
    catch (error) {
      console.log("Error: database couldn't be recovered from settings. Resetting...");
      const freshDB = await createNewDatabase(desiredDimension);
      const jsonIndex = await persist(freshDB, 'json');
      await logseq.updateSettings({
        VectorDBLogseqCopilot: jsonIndex,
        VectorDBDimension: desiredDimension,
      });
      oramaInstance = await restore('json', jsonIndex);
    }
  }

  return oramaInstance;
}

export async function batchInsertEmbeddings(
  oramaDBInstance: Orama<VectorDBSchema>,
  Embedings: VectorDBSchemaDynamic[],
) {
  insertMultiple(oramaDBInstance, Embedings);
  const jsonIndex = await persist(oramaDBInstance, 'json');
  await logseq.updateSettings({ VectorDBLogseqCopilot: jsonIndex });
}

type VectorSearchOptions = {
  similarity?: number;
  limit?: number;
  offset?: number;
};

export async function vectorSearchOramaDB(
  oramaDBInstance: Orama<VectorDBSchema>,
  vector: number[],
  options: VectorSearchOptions = {},
) {
  const { similarity = 0.3, limit = 10, offset = 0 } = options;
  const results = search(oramaDBInstance, {
    mode: "vector",
    vector: {
      value: vector,
      property: "embedding",
    },
    similarity,
    includeVectors: false, // Defaults to `false`
    limit,
    offset,
  });
  return results
}
