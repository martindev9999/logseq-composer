// File: cooldownManager.ts

import { cancelAutoIndexDebounce } from './indexManager';

const COOLDOWN_DURATION_MS = 60_000;

let cooldownEndTime = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Starts the 60-second cooldown timer. Clears any existing cooldown first.
 * Calls `onExpire` when the timer fires, then resets state.
 */
export function startCooldown(onExpire: () => void): void {
  cancelCooldown();
  cooldownEndTime = Date.now() + COOLDOWN_DURATION_MS;
  clearAutoIndexDebounce();

  cooldownTimer = setTimeout(() => {
    cooldownTimer = null;
    cooldownEndTime = 0;
    onExpire();
  }, COOLDOWN_DURATION_MS);
}

/** Returns true if the cooldown timer is currently active. */
export function isCooldownActive(): boolean {
  return Date.now() < cooldownEndTime;
}

/** Cancels the cooldown timer early and resets state. */
export function cancelCooldown(): void {
  if (cooldownTimer !== null) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
  cooldownEndTime = 0;
}

/** Returns the remaining cooldown time in milliseconds. */
export function getCooldownRemaining(): number {
  return Math.max(0, cooldownEndTime - Date.now());
}

/**
 * Returns true if the auto-indexer should be suppressed.
 * Suppressed when: cooldown is active OR autoEmbed toggle is off.
 */
export function shouldSuppressAutoIndex(autoEmbedEnabled: boolean): boolean {
  return isCooldownActive() || !autoEmbedEnabled;
}

/**
 * Clears the pending debounce timer in the auto-indexer.
 * Delegates to `cancelAutoIndexDebounce()` from `indexManager.ts`.
 */
export function clearAutoIndexDebounce(): void {
  cancelAutoIndexDebounce();
}
