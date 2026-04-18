import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockNode } from './blockTreeFormatter';
import { formatBlockTree, getActivePageContext } from './blockTreeFormatter';

describe('formatBlockTree', () => {
  it('formats a flat block list (no children)', () => {
    const blocks: BlockNode[] = [
      { uuid: 'aaa-111', content: 'First block', children: [] },
      { uuid: 'bbb-222', content: 'Second block', children: [] },
      { uuid: 'ccc-333', content: 'Third block', children: [] },
    ];

    const result = formatBlockTree(blocks);

    expect(result).toBe(
      '[uuid:aaa-111] - First block\n' +
      '[uuid:bbb-222] - Second block\n' +
      '[uuid:ccc-333] - Third block'
    );
  });

  it('formats nested blocks with recursive child indentation', () => {
    const blocks: BlockNode[] = [
      {
        uuid: 'aaa-111',
        content: '# Heading',
        children: [
          {
            uuid: 'bbb-222',
            content: 'Child block',
            children: [
              { uuid: 'ccc-333', content: 'Grandchild block', children: [] },
            ],
          },
        ],
      },
      { uuid: 'ddd-444', content: 'Another top-level', children: [] },
    ];

    const result = formatBlockTree(blocks);

    const lines = result.split('\n');
    expect(lines[0]).toBe('[uuid:aaa-111] - # Heading');
    expect(lines[1]).toBe('  [uuid:bbb-222] - Child block');
    expect(lines[2]).toBe('    [uuid:ccc-333] - Grandchild block');
    expect(lines[3]).toBe('[uuid:ddd-444] - Another top-level');
  });

  it('returns empty string for an empty block tree', () => {
    const result = formatBlockTree([]);
    expect(result).toBe('');
  });
});

describe('getActivePageContext', () => {
  beforeEach(() => {
    (globalThis as any).logseq = {
      Editor: {
        getCurrentPage: vi.fn(),
        getPageBlocksTree: vi.fn(),
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).logseq;
    vi.restoreAllMocks();
  });

  it('returns null when no page is open', async () => {
    (globalThis as any).logseq.Editor.getCurrentPage.mockResolvedValue(null);

    const result = await getActivePageContext();

    expect(result).toBeNull();
    expect((globalThis as any).logseq.Editor.getCurrentPage).toHaveBeenCalledTimes(1);
  });

  it('returns formatted context for an active page', async () => {
    (globalThis as any).logseq.Editor.getCurrentPage.mockResolvedValue({
      name: 'Test Page',
      uuid: 'page-uuid-1',
    });
    (globalThis as any).logseq.Editor.getPageBlocksTree.mockResolvedValue([
      { uuid: 'b-1', content: 'Block one', children: [] },
      { uuid: 'b-2', content: 'Block two', children: [] },
    ]);

    const result = await getActivePageContext();

    expect(result).not.toBeNull();
    expect(result!.pageName).toBe('Test Page');
    expect(result!.pageUUID).toBe('page-uuid-1');
    expect(result!.blockCount).toBe(2);
    expect(result!.formattedTree).toContain('[uuid:b-1]');
    expect(result!.formattedTree).toContain('[uuid:b-2]');
  });
});
