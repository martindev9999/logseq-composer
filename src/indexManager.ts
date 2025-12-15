// File: IndexManager.ts

import { EmbeddingConfig, getEmbeddingsAllNotes } from "embedManager";
import { batchInsertEmbeddings, loadVectorDatabase } from "VectorDBManager";
import { IPluginSettings } from "./state/settings";

let hasHooked = false;
let indexingInProgress = false;

export async function rebuildIndex(
  settings: IPluginSettings,
  embeddingConfig: EmbeddingConfig
): Promise<void> {
  if (indexingInProgress) return;
  indexingInProgress = true;
  try {
    const { embeddings, dimension } = await getEmbeddingsAllNotes(embeddingConfig);
    const db = await loadVectorDatabase(settings, { forceNew: true, dimension });
    await batchInsertEmbeddings(db, embeddings);
  } catch (err) {
    console.error('Error rebuilding index:', err);
  } finally {
    setTimeout(() => {
      indexingInProgress = false;
    }, 1000);
  }
}

export function startPageIndexingOnChange(
  settings: IPluginSettings,
  embeddingConfig: EmbeddingConfig
): void {
  if (hasHooked) return;
  hasHooked = true;

  logseq.DB.onChanged(async () => {
    try {
      await rebuildIndex(settings, embeddingConfig);
    } catch (err) {
      console.error('Error indexing updated pages:', err);
    }
  });
}
