/**
 * Unit tests for ChangeSummary component
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
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

import type { ExecutionResult } from '../types/editTypes';
import { ChangeSummary } from './ChangeSummary';

describe('ChangeSummary component', () => {
  /**
   * Requirement 5.3: displays success and fail counts
   */
  it('renders success and fail counts', () => {
    const result: ExecutionResult = {
      successCount: 2,
      failedCount: 1,
      deniedCount: 0,
      outcomes: [
        { command: { action: 'insert', parentBlockUUID: 'p1', content: 'A' }, status: 'success' },
        { command: { action: 'update', blockUUID: 'b1', content: 'B' }, status: 'success' },
        { command: { action: 'delete', blockUUID: 'b2' }, status: 'error', error: 'Block not found' },
      ],
    };
    const { container } = render(<ChangeSummary result={result} />);
    expect(container.textContent).toContain('2 succeeded');
    expect(container.textContent).toContain('1 failed');
  });

  /**
   * Requirement 5.1, 5.2: renders individual outcome entries
   */
  it('renders individual outcome entries with correct content', () => {
    const result: ExecutionResult = {
      successCount: 1,
      failedCount: 1,
      deniedCount: 1,
      outcomes: [
        { command: { action: 'insert', parentBlockUUID: 'p1', content: 'Inserted block' }, status: 'success' },
        { command: { action: 'update', blockUUID: 'b1', content: 'Updated block' }, status: 'error', error: 'API failure' },
        { command: { action: 'delete', blockUUID: 'b2' }, status: 'denied' },
      ],
    };
    const { container } = render(<ChangeSummary result={result} />);

    // Success entry shows check mark and action
    expect(container.textContent).toContain('✓');
    expect(container.textContent).toContain('insert');
    expect(container.textContent).toContain('Inserted block');

    // Error entry shows X mark and error message
    expect(container.textContent).toContain('✗');
    expect(container.textContent).toContain('update');
    expect(container.textContent).toContain('API failure');

    // Denied entry shows dash and Skipped label
    expect(container.textContent).toContain('–');
    expect(container.textContent).toContain('delete');
    expect(container.textContent).toContain('Skipped');
  });

  /**
   * Requirement 5.4: all-failed state shows error banner
   */
  it('shows error banner when all commands failed', () => {
    const result: ExecutionResult = {
      successCount: 0,
      failedCount: 2,
      deniedCount: 0,
      outcomes: [
        { command: { action: 'insert', parentBlockUUID: 'p1', content: 'A' }, status: 'error', error: 'fail1' },
        { command: { action: 'update', blockUUID: 'b1', content: 'B' }, status: 'error', error: 'fail2' },
      ],
    };
    const { container } = render(<ChangeSummary result={result} />);
    expect(container.textContent).toContain('No changes were applied');
  });

  /**
   * Requirement 5.4: error banner is NOT shown when some commands succeed
   */
  it('does not show error banner when some commands succeed', () => {
    const result: ExecutionResult = {
      successCount: 1,
      failedCount: 1,
      deniedCount: 0,
      outcomes: [
        { command: { action: 'insert', parentBlockUUID: 'p1', content: 'A' }, status: 'success' },
        { command: { action: 'update', blockUUID: 'b1', content: 'B' }, status: 'error', error: 'fail' },
      ],
    };
    const { container } = render(<ChangeSummary result={result} />);
    expect(container.textContent).not.toContain('No changes were applied');
  });

  /**
   * Requirement 7.3: denied items show "Skipped" label
   */
  it('renders denied items with "Skipped" label', () => {
    const result: ExecutionResult = {
      successCount: 0,
      failedCount: 0,
      deniedCount: 2,
      outcomes: [
        { command: { action: 'insert', parentBlockUUID: 'p1', content: 'Denied insert' }, status: 'denied' },
        { command: { action: 'delete', blockUUID: 'b1' }, status: 'denied' },
      ],
    };
    const { container } = render(<ChangeSummary result={result} />);

    // Both denied items should show "Skipped"
    const text = container.textContent || '';
    const skippedCount = (text.match(/Skipped/g) || []).length;
    expect(skippedCount).toBe(2);
  });

  /**
   * Requirement 5.5: renders as a visually distinct card with data-testid
   */
  it('renders with data-testid for the summary card', () => {
    const result: ExecutionResult = {
      successCount: 1,
      failedCount: 0,
      deniedCount: 0,
      outcomes: [
        { command: { action: 'insert', parentBlockUUID: 'p1', content: 'A' }, status: 'success' },
      ],
    };
    const { container } = render(<ChangeSummary result={result} />);
    expect(container.querySelector('[data-testid="change-summary"]')).not.toBeNull();
  });
});
