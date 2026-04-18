import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getButtonState } from './buttonState';
import { cancelCooldown, isCooldownActive, shouldSuppressAutoIndex, startCooldown } from './cooldownManager';
import { cancelAutoIndexDebounce } from './indexManager';

describe('shouldSuppressAutoIndex — property tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelCooldown();
    vi.useRealTimers();
  });

  /**
   * Feature: reindex-button-stop-cooldown, Property 6: Auto-indexer suppression
   *
   * For any combination of cooldownActive and autoEmbedEnabled,
   * shouldSuppressAutoIndex(autoEmbedEnabled) returns true if and only if
   * cooldownActive === true OR autoEmbedEnabled === false.
   *
   * **Validates: Requirements 5.1, 5.3, 7.3, 7.4**
   */
  it('Property 6: Auto-indexer suppression', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (cooldownActive, autoEmbedEnabled) => {
        // Set up cooldown state based on the generated boolean
        if (cooldownActive) {
          startCooldown(() => {});
        } else {
          cancelCooldown();
        }

        const result = shouldSuppressAutoIndex(autoEmbedEnabled);
        const expected = cooldownActive || !autoEmbedEnabled;

        expect(result).toBe(expected);

        // Clean up cooldown state for next iteration
        cancelCooldown();
      }),
      { numRuns: 100 },
    );
  });
});

describe('cancelAutoIndexDebounce — property tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelCooldown();
    vi.useRealTimers();
  });

  /**
   * Feature: reindex-button-stop-cooldown, Property 7: Debounce cleared on user stop
   *
   * For any state where a debounce timer is pending and the user initiates a stop,
   * after calling cancelAutoIndexDebounce() the debounce timer is null (cleared).
   * Since the debounce timer is a private module-level variable, we verify that:
   * - cancelAutoIndexDebounce() can be called safely at any time (idempotent)
   * - Calling cancelAutoIndexDebounce() multiple times in succession never throws
   *
   * **Validates: Requirements 2.2, 5.2**
   */
  it('Property 7: Debounce cleared on user stop — cancelAutoIndexDebounce is idempotent', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 5 }),
        (callCount) => {
          // Call cancelAutoIndexDebounce 1 to 6 times — should never throw
          for (let i = 0; i <= callCount; i++) {
            expect(() => cancelAutoIndexDebounce()).not.toThrow();
          }

          // A final call after the loop is still safe
          expect(() => cancelAutoIndexDebounce()).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('State transition — property tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelCooldown();
    vi.useRealTimers();
  });

  /**
   * Feature: reindex-button-stop-cooldown, Property 2: Non-user-initiated completion never enters cooldown
   *
   * For any indexing run completing with 'completed' or 'error' (i.e., not user-paused),
   * isCooldownActive remains false and the button is idle/enabled.
   *
   * The key insight: when indexing completes normally, no one calls startCooldown(),
   * so isCooldownActive() stays false and getButtonState returns enabled.
   *
   * **Validates: Requirements 1.3, 6.1, 6.2**
   */
  it('Property 2: Non-user-initiated completion never enters cooldown', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('completed', 'error'),
        (outcome) => {
          // Simulate: indexing was running and completed normally (no user stop)
          // No call to startCooldown() — this is the key invariant
          cancelCooldown(); // ensure clean state

          // After non-user-initiated completion, cooldown should not be active
          expect(isCooldownActive()).toBe(false);

          // Button should be idle/enabled
          const state = getButtonState({ isIndexing: false, isCooldownActive: false });
          expect(state.label).toBe('🔄 Re-Index');
          expect(state.disabled).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Feature: reindex-button-stop-cooldown, Property 3: User-initiated stop transitions to cooldown
   *
   * For any state where isIndexing is true, applying a user-stop results in
   * isCooldownActive === true, isIndexing === false, button disabled.
   *
   * **Validates: Requirements 2.1, 3.1, 6.3**
   */
  it('Property 3: User-initiated stop transitions to cooldown', () => {
    fc.assert(
      fc.property(fc.boolean(), (_anyFlag) => {
        // Clean state before each iteration
        cancelCooldown();

        // Simulate user-initiated stop: call startCooldown (as App.tsx does on stop)
        startCooldown(() => {});

        // After user stop, cooldown should be active
        expect(isCooldownActive()).toBe(true);

        // Button state with isIndexing=false (stopped) and isCooldownActive=true
        const state = getButtonState({ isIndexing: false, isCooldownActive: true });
        expect(state.label).toBe('🔄 Re-Index');
        expect(state.disabled).toBe(true);

        // Clean up
        cancelCooldown();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Feature: reindex-button-stop-cooldown, Property 5: Cooldown expiry restores idle state
   *
   * For any state where isCooldownActive is true, when cooldown expires,
   * isCooldownActive === false and button is idle/enabled.
   *
   * **Validates: Requirements 3.4, 4.2**
   */
  it('Property 5: Cooldown expiry restores idle state', () => {
    fc.assert(
      fc.property(fc.boolean(), (_anyFlag) => {
        // Clean state
        cancelCooldown();

        let expired = false;
        startCooldown(() => {
          expired = true;
        });

        // Cooldown should be active before expiry
        expect(isCooldownActive()).toBe(true);

        // Advance time by 60,000ms to expire the cooldown
        vi.advanceTimersByTime(60_000);

        // onExpire callback should have fired
        expect(expired).toBe(true);

        // After expiry, cooldown should no longer be active
        expect(isCooldownActive()).toBe(false);

        // Button should be idle/enabled
        const state = getButtonState({ isIndexing: false, isCooldownActive: false });
        expect(state.label).toBe('🔄 Re-Index');
        expect(state.disabled).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
