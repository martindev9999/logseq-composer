// File: IndexManager.ts

import { Orama, getByID, remove } from "@orama/orama";
import { EmbeddingConfig, generateEmbedding } from "embedManager";
import { VectorDBSchema, batchInsertEmbeddings } from "VectorDBManager";
import { VectorDBSchemaDynamic } from "types";

let hasHooked = false;
let currentOramaInstance: Orama<VectorDBSchema>;
let indexingInProgress = false;
let currentEmbeddingConfig: EmbeddingConfig;
let currentEmbeddingDimension: number | null = null;

const isInternalPage = (name: string) => {
  return name.startsWith('card') ||
         name.startsWith('contents') ||
         name.startsWith('favorites') ||
         name.startsWith('__') ||
         name === 'journals' ||
         name === 'contents' ||
         name === 'favorites';
};

export async function checkAndIndexUpdatedPages(
  oramaInstance: Orama<VectorDBSchema>,
  embeddingConfig: EmbeddingConfig
): Promise<void> {
  if (indexingInProgress) return;

  indexingInProgress = true;

  try {
    const pages = (await logseq.Editor.getAllPages()) ?? [];

    for (const page of pages) {
      if (isInternalPage(page.name)) continue;

      const dbRecord = getByID(oramaInstance, page.id.toString());
      const lastUpdated: number = page.updatedAt ?? 0;

      if (dbRecord && dbRecord.lastUpdated >= lastUpdated) continue;

      try {
        const blocks = await logseq.Editor.getPageBlocksTree(page.uuid);
        let wholePageContent = `note_id: ${page.id}\nnote_name: ${page.name}\nnote_content:\n\n`;
        for (const block of blocks) {
          if (block.content) {
            wholePageContent += `- ${block.content}\n`;
          }
        }

        const { embedding, dimension } = await generateEmbedding(wholePageContent, embeddingConfig);
        if (currentEmbeddingDimension !== null && currentEmbeddingDimension !== dimension) {
          console.warn(
            `Embedding dimension changed from ${currentEmbeddingDimension} to ${dimension}. ` +
            'Skipping incremental update; please re-index to rebuild the vector database.',
          );
          continue;
        }
        currentEmbeddingDimension = currentEmbeddingDimension ?? dimension;

        const newEmbedding: VectorDBSchemaDynamic = {
          id: page.id.toString(),
          lastUpdated,
          content: wholePageContent,
          embedding,
        };

        if (dbRecord?.id) {
          remove(oramaInstance, dbRecord.id);
        }

        batchInsertEmbeddings(oramaInstance, [newEmbedding]);
      } catch (error) {
        console.error(`Error indexing page ${page.name} (ID: ${page.uuid}):`, error);
      }
    }
  } finally {
    setTimeout(() => {
      indexingInProgress = false;
    }, 1000); // 1 second cooldown
  }
}

export function startPageIndexingOnChange(
  oramaInstance: Orama<VectorDBSchema>,
  embeddingConfig: EmbeddingConfig
): void {
  currentOramaInstance = oramaInstance;
  currentEmbeddingConfig = embeddingConfig;

  if (hasHooked) return;
  hasHooked = true;

  logseq.DB.onChanged(async () => {
    try {
      await checkAndIndexUpdatedPages(currentOramaInstance, currentEmbeddingConfig);
    } catch (err) {
      console.error('Error indexing updated pages:', err);
    }
  });
}
