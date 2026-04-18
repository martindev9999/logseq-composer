import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getButtonState } from './buttonState';

describe('getButtonState', () => {
  it('returns stop button when indexing is active', () => {
    const result = getButtonState({ isIndexing: true, isCooldownActive: false });
    expect(result).toEqual({ label: '⏹ Stop', variant: 'pause', disabled: false });
  });

  it('returns stop button when indexing is active even during cooldown', () => {
    const result = getButtonState({ isIndexing: true, isCooldownActive: true });
    expect(result).toEqual({ label: '⏹ Stop', variant: 'pause', disabled: false });
  });

  it('returns disabled re-index button during cooldown', () => {
    const result = getButtonState({ isIndexing: false, isCooldownActive: true });
    expect(result).toEqual({ label: '🔄 Re-Index', variant: 'index', disabled: true });
  });

  it('returns enabled re-index button in idle state', () => {
    const result = getButtonState({ isIndexing: false, isCooldownActive: false });
    expect(result).toEqual({ label: '🔄 Re-Index', variant: 'index', disabled: false });
  });
});

describe('getButtonState — property tests', () => {
  /**
   * Feature: reindex-button-stop-cooldown, Property 1: Indexing state implies stop button
   *
   * For any ButtonStateInput where isIndexing is true, getButtonState() returns
   * { label: '⏹ Stop', variant: 'pause', disabled: false } regardless of isCooldownActive.
   *
   * **Validates: Requirements 1.1, 1.2**
   */
  it('Property 1: Indexing state implies stop button', () => {
    fc.assert(
      fc.property(fc.boolean(), (isCooldownActive) => {
        const result = getButtonState({ isIndexing: true, isCooldownActive });
        expect(result).toEqual({ label: '⏹ Stop', variant: 'pause', disabled: false });
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Feature: reindex-button-stop-cooldown, Property 4: Cooldown invariant — button disabled
   *
   * For any input where isCooldownActive is true and isIndexing is false,
   * result has disabled === true.
   *
   * **Validates: Requirements 3.2**
   */
  it('Property 4: Cooldown invariant — button disabled', () => {
    fc.assert(
      fc.property(fc.constant(true), (_isCooldownActive) => {
        const result = getButtonState({ isIndexing: false, isCooldownActive: true });
        expect(result.disabled).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Feature: reindex-button-stop-cooldown, Property 8: Manual re-index independent of auto-embed toggle
   *
   * For any input where isIndexing is false and isCooldownActive is false,
   * result has disabled === false.
   *
   * **Validates: Requirements 7.5**
   */
  it('Property 8: Manual re-index independent of auto-embed toggle', () => {
    fc.assert(
      fc.property(fc.boolean(), (_autoEmbedEnabled) => {
        // autoEmbedEnabled is not an input to getButtonState, so regardless of its value
        // the button should be enabled when not indexing and not in cooldown
        const result = getButtonState({ isIndexing: false, isCooldownActive: false });
        expect(result.disabled).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
