/**
 * Unit tests for AutoEmbedToggle component
 *
 * **Validates: Requirements 7.1, 7.8**
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock stitches config — render styled components as plain HTML elements
vi.mock('../stitches.config', () => {
  const styled = (tag: string, _styles?: any) => {
    const Component = React.forwardRef((props: any, ref: any) => {
      const { css: _css, variant, delay, active, ...rest } = props;
      return React.createElement(tag, { ...rest, ref });
    });
    Component.displayName = `Styled(${tag})`;
    return Component;
  };
  return {
    styled,
    keyframes: () => 'mock-keyframe',
    darkTheme: { className: 'dark' },
    css: () => '',
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

import { AutoEmbedToggle } from './AutoEmbedToggle';

describe('AutoEmbedToggle component', () => {
  /**
   * Requirement 7.8: label shows "Auto-Embed: On" when enabled
   */
  it('renders "Auto-Embed: On" when enabled is true', () => {
    const { container } = render(
      <AutoEmbedToggle enabled={true} onToggle={() => {}} />
    );
    expect(container.textContent).toContain('Auto-Embed: On');
  });

  /**
   * Requirement 7.8: label shows "Auto-Embed: Off" when disabled
   */
  it('renders "Auto-Embed: Off" when enabled is false', () => {
    const { container } = render(
      <AutoEmbedToggle enabled={false} onToggle={() => {}} />
    );
    expect(container.textContent).toContain('Auto-Embed: Off');
  });

  /**
   * Requirement 7.1: aria-checked reflects enabled prop
   */
  it('sets aria-checked="true" when enabled', () => {
    const { container } = render(
      <AutoEmbedToggle enabled={true} onToggle={() => {}} />
    );
    const switchEl = container.querySelector('[role="switch"]')!;
    expect(switchEl.getAttribute('aria-checked')).toBe('true');
  });

  it('sets aria-checked="false" when disabled', () => {
    const { container } = render(
      <AutoEmbedToggle enabled={false} onToggle={() => {}} />
    );
    const switchEl = container.querySelector('[role="switch"]')!;
    expect(switchEl.getAttribute('aria-checked')).toBe('false');
  });

  /**
   * Requirement 7.1: onToggle fires on click
   */
  it('calls onToggle when the switch is clicked', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <AutoEmbedToggle enabled={false} onToggle={onToggle} />
    );
    const switchEl = container.querySelector('[role="switch"]')!;
    fireEvent.click(switchEl);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  /**
   * Requirement 7.8: keyboard interaction — Space to toggle
   */
  it('calls onToggle when Space key is pressed', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <AutoEmbedToggle enabled={false} onToggle={onToggle} />
    );
    const switchEl = container.querySelector('[role="switch"]')!;
    fireEvent.keyDown(switchEl, { key: ' ' });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  /**
   * Requirement 7.8: keyboard interaction — Enter to toggle
   */
  it('calls onToggle when Enter key is pressed', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <AutoEmbedToggle enabled={false} onToggle={onToggle} />
    );
    const switchEl = container.querySelector('[role="switch"]')!;
    fireEvent.keyDown(switchEl, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  /**
   * Non-toggle keys should not fire callback
   */
  it('does not call onToggle for other keys', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <AutoEmbedToggle enabled={false} onToggle={onToggle} />
    );
    const switchEl = container.querySelector('[role="switch"]')!;
    fireEvent.keyDown(switchEl, { key: 'Tab' });
    fireEvent.keyDown(switchEl, { key: 'a' });
    expect(onToggle).not.toHaveBeenCalled();
  });
});
