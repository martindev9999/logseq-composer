export type ButtonVisualState =
  | { label: '⏹ Stop'; variant: 'pause'; disabled: false }
  | { label: '🔄 Re-Index'; variant: 'index'; disabled: false }
  | { label: '🔄 Re-Index'; variant: 'index'; disabled: true };

export interface ButtonStateInput {
  isIndexing: boolean;
  isCooldownActive: boolean;
}

/** Pure function: derives button visual state from flags. */
export function getButtonState(input: ButtonStateInput): ButtonVisualState {
  if (input.isIndexing) {
    return { label: '⏹ Stop', variant: 'pause', disabled: false };
  }
  if (input.isCooldownActive) {
    return { label: '🔄 Re-Index', variant: 'index', disabled: true };
  }
  return { label: '🔄 Re-Index', variant: 'index', disabled: false };
}
