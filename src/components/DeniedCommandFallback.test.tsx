/**
 * Unit tests for DeniedCommandFallback component
 *
 * **Validates: Requirements 7.1, 7.2, 7.3**
 */

// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock stitches config — render styled components as plain HTML elements
vi.mock('../stitches.config', () => {
  const styled = (tag: string, _styles?: any) => {
    const Component = React.forwardRef((props: any, ref: any) => {
      const { css: _css, variant, delay, active, action, status, ...rest } = props;
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

import type { EditCommand } from '../types/editTypes';
import { DeniedCommandFallback } from './DeniedCommandFallback';

describe('DeniedCommandFallback', () => {
  /**
   * Requirement 7.3: denied items show "Skipped" label
   */
  it('renders "Skipped" badge for all command types', () => {
    const command: EditCommand = { action: 'insert', parentBlockUUID: 'p1', content: 'Hello' };
    const { container } = render(<DeniedCommandFallback command={command} />);
    expect(container.textContent).toContain('Skipped');
  });

  it('renders action label for insert command', () => {
    const command: EditCommand = { action: 'insert', parentBlockUUID: 'p1', content: 'New block' };
    const { container } = render(<DeniedCommandFallback command={command} />);
    expect(container.textContent).toContain('insert');
  });

  /**
   * Requirement 7.1: denied insert renders content as formatted code block
   */
  it('renders content in a <pre> element for insert command', () => {
    const command: EditCommand = { action: 'insert', parentBlockUUID: 'p1', content: 'Some new content' };
    const { container } = render(<DeniedCommandFallback command={command} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe('Some new content');
  });

  /**
   * Requirement 7.1: denied update renders content as formatted code block
   */
  it('renders content in a <pre> element for update command', () => {
    const command: EditCommand = { action: 'update', blockUUID: 'b1', content: 'Updated text' };
    const { container } = render(<DeniedCommandFallback command={command} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe('Updated text');
    expect(container.textContent).toContain('update');
  });

  /**
   * Requirement 7.2: denied delete displays "Block was not deleted" note
   */
  it('renders "Block was not deleted" note for delete command', () => {
    const command: EditCommand = { action: 'delete', blockUUID: 'b1' };
    const { container } = render(<DeniedCommandFallback command={command} />);
    expect(container.textContent).toContain('Block was not deleted');
    expect(container.textContent).toContain('delete');
  });

  it('does not render a <pre> element for delete command', () => {
    const command: EditCommand = { action: 'delete', blockUUID: 'b1' };
    const { container } = render(<DeniedCommandFallback command={command} />);
    expect(container.querySelector('pre')).toBeNull();
  });

  it('renders empty string in code block when content is undefined for insert', () => {
    const command: EditCommand = { action: 'insert', parentBlockUUID: 'p1' };
    const { container } = render(<DeniedCommandFallback command={command} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe('');
  });

  it('has data-testid for integration targeting', () => {
    const command: EditCommand = { action: 'update', blockUUID: 'b1', content: 'x' };
    const { container } = render(<DeniedCommandFallback command={command} />);
    expect(container.querySelector('[data-testid="denied-command-fallback"]')).not.toBeNull();
  });
});
