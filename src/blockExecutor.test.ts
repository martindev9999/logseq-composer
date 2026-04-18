import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAll, executeOne } from './blockExecutor';
import type { EditAction, EditCommand } from './types/editTypes';

/**
 * Arbitrary generator for a valid EditCommand with all required fields present.
 */
const arbitraryEditCommand: fc.Arbitrary<EditCommand> = fc.oneof(
  fc.record({
    action: fc.constant('insert' as EditAction),
    parentBlockUUID: fc.uuid(),
    content: fc.string({ minLength: 1, maxLength: 50 }),
    siblingOrder: fc.option(fc.nat({ max: 20 }), { nil: undefined }),
  }),
  fc.record({
    action: fc.constant('update' as EditAction),
    blockUUID: fc.uuid(),
    content: fc.string({ minLength: 1, maxLength: 50 }),
    siblingOrder: fc.option(fc.nat({ max: 20 }), { nil: undefined }),
  }),
  fc.record({
    action: fc.constant('delete' as EditAction),
    blockUUID: fc.uuid(),
    siblingOrder: fc.option(fc.nat({ max: 20 }), { nil: undefined }),
  })
);

const arbitraryEditCommandArray = fc.array(arbitraryEditCommand, {
  minLength: 1,
  maxLength: 20,
});

describe('BlockExecutor', () => {
  beforeEach(() => {
    // Mock the global logseq object with Editor methods
    (globalThis as any).logseq = {
      Editor: {
        insertBlock: vi.fn(),
        updateBlock: vi.fn(),
        removeBlock: vi.fn(),
      },
    };
    // Suppress console.error noise from expected simulated failures
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).logseq;
  });

  // Feature: ai-page-editing, Property 4: Executor resilience and count invariant
  // **Validates: Requirement 4.8**
  it('successCount + failedCount + deniedCount === outcomes.length for any command array with random failures', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryEditCommandArray,
        fc.infiniteStream(fc.boolean()),
        async (commands, shouldSucceedStream) => {
          const succeedIterator = shouldSucceedStream[Symbol.iterator]();

          // Configure each mock to randomly succeed or throw based on the stream
          const makeMock = () =>
            vi.fn().mockImplementation(async () => {
              const next = succeedIterator.next();
              if (next.value) {
                return { uuid: 'mock-uuid' };
              }
              throw new Error('Simulated API failure');
            });

          (globalThis as any).logseq.Editor.insertBlock = makeMock();
          (globalThis as any).logseq.Editor.updateBlock = makeMock();
          (globalThis as any).logseq.Editor.removeBlock = makeMock();

          const result = await executeAll(commands);

          // Count invariant: successCount + failedCount + deniedCount === outcomes.length
          expect(result.successCount + result.failedCount + result.deniedCount).toBe(
            result.outcomes.length
          );

          // Length invariant: outcomes.length === commands.length
          expect(result.outcomes.length).toBe(commands.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('BlockExecutor – unit tests', () => {
  beforeEach(() => {
    (globalThis as any).logseq = {
      Editor: {
        insertBlock: vi.fn().mockResolvedValue({ uuid: 'new-block-uuid' }),
        updateBlock: vi.fn().mockResolvedValue(undefined),
        removeBlock: vi.fn().mockResolvedValue(undefined),
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).logseq;
  });

  it('insert calls logseq.Editor.insertBlock with correct args', async () => {
    const cmd: EditCommand = {
      action: 'insert',
      parentBlockUUID: 'parent-uuid-1',
      content: 'New block content',
    };

    const outcome = await executeOne(cmd);

    expect(logseq.Editor.insertBlock).toHaveBeenCalledWith('parent-uuid-1', 'New block content', {
      sibling: false,
    });
    expect(outcome.status).toBe('success');
  });

  it('update calls logseq.Editor.updateBlock with correct args', async () => {
    const cmd: EditCommand = {
      action: 'update',
      blockUUID: 'block-uuid-1',
      content: 'Updated content',
    };

    const outcome = await executeOne(cmd);

    expect(logseq.Editor.updateBlock).toHaveBeenCalledWith('block-uuid-1', 'Updated content');
    expect(outcome.status).toBe('success');
  });

  it('delete calls logseq.Editor.removeBlock with correct args', async () => {
    const cmd: EditCommand = {
      action: 'delete',
      blockUUID: 'block-uuid-2',
    };

    const outcome = await executeOne(cmd);

    expect(logseq.Editor.removeBlock).toHaveBeenCalledWith('block-uuid-2');
    expect(outcome.status).toBe('success');
  });

  it('failed API call is logged and skipped, remaining commands continue', async () => {
    (logseq.Editor.updateBlock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('API failure')
    );

    const commands: EditCommand[] = [
      { action: 'update', blockUUID: 'fail-uuid', content: 'will fail' },
      { action: 'delete', blockUUID: 'ok-uuid' },
    ];

    const result = await executeAll(commands);

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0].status).toBe('error');
    expect(result.outcomes[0].error).toBe('API failure');
    expect(result.outcomes[1].status).toBe('success');
    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('missing blockUUID produces error entry in result', async () => {
    const commands: EditCommand[] = [
      { action: 'update', content: 'no uuid' },
      { action: 'delete' },
    ];

    const result = await executeAll(commands);

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0].status).toBe('error');
    expect(result.outcomes[0].error).toContain('Missing blockUUID');
    expect(result.outcomes[1].status).toBe('error');
    expect(result.outcomes[1].error).toContain('Missing blockUUID');
    expect(result.failedCount).toBe(2);
    expect(result.successCount).toBe(0);
  });
});
