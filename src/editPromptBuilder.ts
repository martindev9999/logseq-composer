/**
 * EditPromptBuilder — builds the edit-mode system prompt supplement
 * and the page context user message for the LLM.
 */

/**
 * Build the edit-mode system prompt that defines the json-edit schema
 * and instructs the LLM on how to emit edit commands.
 */
export function buildEditSystemPrompt(): string {
  return `EDIT MODE INSTRUCTIONS:
You have the ability to edit the user's current Logseq page. When the user asks you to make changes to their page, respond with structured edit commands inside a \`\`\`json-edit fenced code block.

Each command is a JSON object with these fields:
- "action": "insert" | "update" | "delete"
- "blockUUID": (string) The UUID of the block to update or delete. Required for "update" and "delete".
- "parentBlockUUID": (string) The UUID of the parent block under which to insert. Required for "insert".
- "content": (string) The block content in Logseq markdown format. Required for "insert" and "update".
- "siblingOrder": (number, optional) Position among siblings (0 = first child).

Wrap all commands in a JSON array inside a \`\`\`json-edit code fence. You may include explanatory text before and after the fence.

IMPORTANT:
- Only reference block UUIDs that appear in the page context below.
- For top-level inserts, use the page's root block UUID as parentBlockUUID.
- You may include multiple commands in a single array.
- If the user's request is a question (not an edit request), respond normally without edit commands.
- In Logseq, every block is already a bullet point. Do NOT prefix content with "- " or "* ". If you want to create a list, insert each item as a separate child block under the same parent.
- For nested/indented content, insert child blocks (using the parent block's UUID as parentBlockUUID) rather than using markdown list syntax within a single block's content.
- To set or edit block properties/attributes, include them in the content field on new lines using the format "property:: value". For example: "Task title\\npriority:: high\\nstatus:: todo". To update a property on an existing block, use "update" and include the full block content with the modified property lines.
- To set or edit time tracking (clock entries) on a task block, include CLOCK lines in org-mode format: "CLOCK: [YYYY-MM-DD ddd HH:MM]--[YYYY-MM-DD ddd HH:MM] =>  HH:MM". For example: "DOING My task\\nCLOCK: [2024-03-15 Fri 09:00]--[2024-03-15 Fri 10:30] =>  01:30". Multiple CLOCK entries can be stacked on separate lines. Task states include TODO, DOING, DONE, NOW, LATER, WAITING, CANCELLED.`;
}

/**
 * Build the user message section containing the active page block tree.
 */
export function buildPageContextMessage(
  pageName: string,
  formattedTree: string,
): string {
  return `Page: "${pageName}" (current page)\nBlocks:\n${formattedTree}`;
}
