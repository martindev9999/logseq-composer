/**
 * BlockTreeFormatter — formats the active page's block tree into
 * indented text with UUIDs so the LLM can reference specific blocks.
 */

export interface BlockNode {
  uuid: string;
  content: string;
  children: BlockNode[];
}

/**
 * Format a block tree into indented text with UUIDs for LLM context.
 * Each line: `  [uuid:abc-123] - Block content here`
 * Indentation increases by 2 spaces per nesting level.
 */
export function formatBlockTree(blocks: BlockNode[], indentLevel: number = 0): string {
  const lines: string[] = [];
  const indent = ' '.repeat(indentLevel * 2);

  for (const block of blocks) {
    lines.push(`${indent}[uuid:${block.uuid}] - ${block.content}`);
    if (block.children && block.children.length > 0) {
      lines.push(formatBlockTree(block.children, indentLevel + 1));
    }
  }

  return lines.join('\n');
}

/**
 * Map a Logseq block (from getPageBlocksTree) to our BlockNode interface.
 * Logseq blocks have `uuid`, `content`, and `children` properties.
 */
function mapToBlockNodes(logseqBlocks: any[]): BlockNode[] {
  return logseqBlocks.map((b) => ({
    uuid: b.uuid,
    content: b.content ?? '',
    children: b.children ? mapToBlockNodes(b.children) : [],
  }));
}

/**
 * Recursively count all blocks in a tree.
 */
function countBlocks(blocks: BlockNode[]): number {
  let count = 0;
  for (const block of blocks) {
    count += 1;
    if (block.children && block.children.length > 0) {
      count += countBlocks(block.children);
    }
  }
  return count;
}

/**
 * Fetch and format the current page's block tree.
 * Returns null if no page is open or on error.
 */
export async function getActivePageContext(): Promise<{
  pageName: string;
  pageUUID: string;
  formattedTree: string;
  blockCount: number;
} | null> {
  try {
    const page = await logseq.Editor.getCurrentPage();
    if (page === null) {
      return null;
    }

    const pageName: string = String(page.name ?? page.originalName ?? '');
    const pageUUID: string = String(page.uuid ?? '');

    const rawBlocks = await logseq.Editor.getPageBlocksTree(pageName);
    const blockNodes = mapToBlockNodes(rawBlocks ?? []);
    const formattedTree = formatBlockTree(blockNodes);
    const blockCount = countBlocks(blockNodes);

    return { pageName, pageUUID, formattedTree, blockCount };
  } catch (err) {
    console.error('Failed to get active page context:', err);
    return null;
  }
}
