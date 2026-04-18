import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseEditCommands, serializeEditCommands, validateEditCommand } from './editCommandParser';
import type { EditCommand } from './types/editTypes';

/**
 * Arbitrary generator for a safe string that won't contain triple backticks,
 * which would break the json-edit fence format.
 */
const safeString = fc.string().filter((s) => !s.includes('```'));

const safeUUID = fc.uuid().filter((s) => !s.includes('```'));

/**
 * Arbitrary generator for a valid EditCommand.
 */
const arbitraryEditCommand: fc.Arbitrary<EditCommand> = fc.oneof(
  // insert command
  fc.record({
    action: fc.constant('insert' as const),
    parentBlockUUID: safeUUID,
    content: safeString,
    siblingOrder: fc.option(fc.nat(), { nil: undefined }),
  }),
  // update command
  fc.record({
    action: fc.constant('update' as const),
    blockUUID: safeUUID,
    content: safeString,
    siblingOrder: fc.option(fc.nat(), { nil: undefined }),
  }),
  // delete command
  fc.record({
    action: fc.constant('delete' as const),
    blockUUID: safeUUID,
    siblingOrder: fc.option(fc.nat(), { nil: undefined }),
  })
);

const arbitraryEditCommandArray = fc.array(arbitraryEditCommand, { minLength: 0, maxLength: 10 });

describe('EditCommandParser', () => {
  // Feature: ai-page-editing, Property 3: EditCommand round-trip serialization
  // **Validates: Requirements 3.6**
  it('round-trip: parseEditCommands(serializeEditCommands(commands)) produces equivalent array', () => {
    fc.assert(
      fc.property(arbitraryEditCommandArray, (commands) => {
        const serialized = serializeEditCommands(commands);
        const parsed = parseEditCommands(serialized);
        expect(parsed.commands).toEqual(commands);
      }),
      { numRuns: 100 }
    );
  });
});

describe('EditCommandParser – unit tests', () => {
  // --- Valid json-edit block extraction ---
  it('extracts valid commands from a json-edit block', () => {
    const input = [
      'Here are the changes:',
      '```json-edit',
      '[',
      '  { "action": "insert", "parentBlockUUID": "p-1", "content": "New block" },',
      '  { "action": "update", "blockUUID": "b-2", "content": "Updated" },',
      '  { "action": "delete", "blockUUID": "b-3" }',
      ']',
      '```',
      'Done!',
    ].join('\n');

    const result = parseEditCommands(input);

    expect(result.commands).toHaveLength(3);
    expect(result.commands[0]).toEqual({
      action: 'insert',
      parentBlockUUID: 'p-1',
      content: 'New block',
    });
    expect(result.commands[1]).toEqual({
      action: 'update',
      blockUUID: 'b-2',
      content: 'Updated',
    });
    expect(result.commands[2]).toEqual({
      action: 'delete',
      blockUUID: 'b-3',
    });
  });

  // --- Invalid / missing fields are excluded ---
  it('excludes commands with invalid or missing required fields', () => {
    const input = [
      '```json-edit',
      '[',
      '  { "action": "insert", "content": "no parent" },',
      '  { "action": "update", "blockUUID": "b-1" },',
      '  { "action": "delete" },',
      '  { "action": "unknown", "blockUUID": "b-2" },',
      '  { "action": "insert", "parentBlockUUID": "p-1", "content": "valid" }',
      ']',
      '```',
    ].join('\n');

    const result = parseEditCommands(input);

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toEqual({
      action: 'insert',
      parentBlockUUID: 'p-1',
      content: 'valid',
    });
  });

  // --- No json-edit block returns empty list ---
  it('returns empty commands when no json-edit block is present', () => {
    const input = 'This is a normal LLM response with no edit commands.';
    const result = parseEditCommands(input);

    expect(result.commands).toEqual([]);
    expect(result.textWithoutEditBlocks).toBe(input);
  });

  // --- Multiple json-edit blocks are concatenated ---
  it('concatenates commands from multiple json-edit blocks', () => {
    const input = [
      'First batch:',
      '```json-edit',
      '[{ "action": "insert", "parentBlockUUID": "p-1", "content": "A" }]',
      '```',
      'Second batch:',
      '```json-edit',
      '[{ "action": "delete", "blockUUID": "b-2" }]',
      '```',
    ].join('\n');

    const result = parseEditCommands(input);

    expect(result.commands).toHaveLength(2);
    expect(result.commands[0].action).toBe('insert');
    expect(result.commands[1].action).toBe('delete');
  });

  // --- Text stripping produces correct textWithoutEditBlocks ---
  it('strips json-edit blocks from response text', () => {
    const input = [
      'Before the block.',
      '```json-edit',
      '[{ "action": "delete", "blockUUID": "b-1" }]',
      '```',
      'After the block.',
    ].join('\n');

    const result = parseEditCommands(input);

    expect(result.textWithoutEditBlocks).not.toContain('json-edit');
    expect(result.textWithoutEditBlocks).toContain('Before the block.');
    expect(result.textWithoutEditBlocks).toContain('After the block.');
  });

  it('strips multiple json-edit blocks and preserves surrounding text', () => {
    const input = [
      'Intro text.',
      '```json-edit',
      '[{ "action": "insert", "parentBlockUUID": "p-1", "content": "X" }]',
      '```',
      'Middle text.',
      '```json-edit',
      '[{ "action": "delete", "blockUUID": "b-1" }]',
      '```',
      'Outro text.',
    ].join('\n');

    const result = parseEditCommands(input);

    expect(result.textWithoutEditBlocks).toContain('Intro text.');
    expect(result.textWithoutEditBlocks).toContain('Middle text.');
    expect(result.textWithoutEditBlocks).toContain('Outro text.');
    expect(result.textWithoutEditBlocks).not.toContain('json-edit');
  });

  // --- validateEditCommand edge cases ---
  it('validateEditCommand returns null for non-object inputs', () => {
    expect(validateEditCommand(null)).toBeNull();
    expect(validateEditCommand(undefined)).toBeNull();
    expect(validateEditCommand('string')).toBeNull();
    expect(validateEditCommand(42)).toBeNull();
  });

  it('validateEditCommand includes optional siblingOrder when present', () => {
    const cmd = validateEditCommand({
      action: 'insert',
      parentBlockUUID: 'p-1',
      content: 'hello',
      siblingOrder: 3,
    });

    expect(cmd).toEqual({
      action: 'insert',
      parentBlockUUID: 'p-1',
      content: 'hello',
      siblingOrder: 3,
    });
  });
});
