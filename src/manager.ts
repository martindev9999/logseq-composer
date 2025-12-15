import { generateEmbedding, getEmbeddingsAllNotes, resolveEmbeddingConfig } from 'embedManager';
import { startPageIndexingOnChange } from 'indexManager';
import { queryLiteLLM } from 'LLMManager';
import { batchInsertEmbeddings, loadVectorDatabase, vectorSearchOramaDB } from 'VectorDBManager';
import { IPluginSettings } from './state/settings';

// Global variable to store conversation history
const conversationHistory: Array<{ role: 'user' | 'assistant', content: string }> = [];
// Set maximum number of history messages to include in the prompt (e.g., last 6 messages)
const MAX_HISTORY_LENGTH = 6;

export async function indexEntireLogSeq(settings: IPluginSettings) {
  const embeddingConfig = resolveEmbeddingConfig(settings);
  const { embeddings, dimension } = await getEmbeddingsAllNotes(embeddingConfig);
  const oramaDatabaseInstance = await loadVectorDatabase(settings, { forceNew: true, dimension });
  batchInsertEmbeddings(oramaDatabaseInstance, embeddings);
}

export async function enableAutoIndexer(settings: IPluginSettings) {
  const embeddingConfig = resolveEmbeddingConfig(settings);
  await loadVectorDatabase(settings, {
    dimension: settings.VectorDBDimension,
  });
  startPageIndexingOnChange(settings, embeddingConfig);
}

export async function handleQuery(query: string, settings: IPluginSettings): Promise<string> {
  // Add the new user query to the conversation history
  conversationHistory.push({ role: "user", content: query });

  let vectorContext = "";

  // Wrap vector search in try/catch to prevent indexing issues from blocking LLM query.
  try {
    const embeddingConfig = resolveEmbeddingConfig(settings);
    let oramaDatabaseInstance = await loadVectorDatabase(settings, {
      dimension: settings.VectorDBDimension,
    });
    const queryEmbedding = await generateEmbedding(query, embeddingConfig);
    const needsRebuild =
      settings.VectorDBDimension && settings.VectorDBDimension !== queryEmbedding.dimension;

    if (needsRebuild) {
      console.warn(
        `Vector DB dimension (${settings.VectorDBDimension}) differs from embedding dimension (${queryEmbedding.dimension}). Rebuilding vector DB.`,
      );
      oramaDatabaseInstance = await loadVectorDatabase(settings, {
        forceNew: true,
        dimension: queryEmbedding.dimension,
      });
    }

    const { context, hits } = await collectVectorContext(
      oramaDatabaseInstance,
      queryEmbedding.embedding,
    );
    vectorContext = context;
    console.info(`[composer] Vector search hits: ${hits}`);
    if (hits === 0) {
      console.warn(
        '[composer] No vector hits found for this query. Reindex may be required or similarity is too high.',
      );
    }
  } catch (err) {
    console.error("Vector search failed, proceeding without additional context:", err);
    // Optionally, you could update vectorContext with a note or leave it empty.
    vectorContext = "";
  }

  // Construct prompt starting with your base prompt.
  let prompt = settings.prompt + "\n";

  // Append recent conversation history (limited to the most recent MAX_HISTORY_LENGTH messages)
  const recentHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);
  if (recentHistory.length > 0) {
    prompt += "Conversation History:\n";
    recentHistory.forEach(entry => {
      prompt += entry.role === "user"
        ? "User: " + entry.content + "\n"
        : "Assistant: " + entry.content + "\n";
    });
    prompt += "\n";
  }

  // Try to include the current page context, but do not fail if it cannot be retrieved.
  try {
    const page = await logseq.Editor.getCurrentPage();
    if (page !== null) {
      const pageContent = await logseq.Editor.getPageBlocksTree(page.uuid);
      let wholePageContent = "";
      pageContent.forEach(element => {
        wholePageContent += "- " + element.content + "\n";
      });
      prompt += "Current Page Context:\n";
      prompt += `current_page_open_id: ${page.id}\n`;
      prompt += `current_page_open_name: ${page.name}\n`;
      prompt += `current_page_open_content: ${wholePageContent}\n\n`;
    }
  } catch (err) {
    console.error("Failed to retrieve current page context:", err);
  }

  // Append additional context from vector search if available.
  if (vectorContext) {
    prompt += "Additional Context from Knowledge Base:\n";
    prompt += vectorContext;
  }

  // Query the LLM with the complete prompt.
  const llmOutput = await queryLiteLLM(prompt, settings.selectedModel, settings.apiKey, settings.LiteLLMLink);
  const assistantResponse = llmOutput.choices[0].message["content"];

  // Add the assistant's answer to the conversation history.
  conversationHistory.push({ role: "assistant", content: assistantResponse });

  // Trim conversation history if it grows too large.
  if (conversationHistory.length > MAX_HISTORY_LENGTH * 2) {
    conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_LENGTH * 2);
  }

  return assistantResponse;
}

async function collectVectorContext(
  oramaDatabaseInstance: any,
  queryVector: number[],
): Promise<{ context: string; hits: number }> {
  const vectorResult = await vectorSearchOramaDB(oramaDatabaseInstance, queryVector);
  let context = "";
  if (vectorResult.hits && vectorResult.hits.length > 0) {
    vectorResult.hits.forEach((hit: any) => {
      const pageName = hit.document.pageName ? `Page: ${hit.document.pageName}\n` : '';
      const blockLabel = hit.document.blockId ? `Block: ${hit.document.blockId}\n` : '';
      context += `${pageName}${blockLabel}${hit.document.content}\n\n`;
    });
  }
  return { context, hits: vectorResult.hits?.length ?? 0 };
}
