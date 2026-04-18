/**
 * Unit tests for PermissionPrompt component
 *
 * **Validates: Requirements 6.2, 6.3, 6.4**
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock stitches config — render styled components as plain HTML elements
vi.mock('../stitches.config', () => {
  const styled = (tag: string, _styles?: any) => {
    const Component = React.forwardRef((props: any, ref: any) => {
      const { css: _css, variant, delay, active, action, ...rest } = props;
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
import { PermissionPrompt } from './PermissionPrompt';

describe('PermissionPrompt component', () => {
  /**
   * Requirement 6.2: shows action type and content preview
   */
  it('renders action type and content preview', () => {
    const command: EditCommand = {
      action: 'insert',
      parentBlockUUID: 'parent-1',
      content: 'New block content here',
    };
    const { container } = render(
      <PermissionPrompt command={command} onAllow={() => {}} onDeny={() => {}} />
    );
    expect(container.textContent).toContain('insert');
    expect(container.textContent).toContain('New block content here');
  });

  /**
   * Requirement 6.3: Allow button calls onAllow callback
   */
  it('calls onAllow when Allow button is clicked', () => {
    const onAllow = vi.fn();
    const command: EditCommand = {
      action: 'update',
      blockUUID: 'block-1',
      content: 'Updated content',
    };
    const { getByText } = render(
      <PermissionPrompt command={command} onAllow={onAllow} onDeny={() => {}} />
    );
    fireEvent.click(getByText('Allow'));
    expect(onAllow).toHaveBeenCalledTimes(1);
  });

  /**
   * Requirement 6.4: Deny button calls onDeny callback
   */
  it('calls onDeny when Deny button is clicked', () => {
    const onDeny = vi.fn();
    const command: EditCommand = {
      action: 'delete',
      blockUUID: 'block-2',
    };
    const { getByText } = render(
      <PermissionPrompt command={command} onAllow={() => {}} onDeny={onDeny} />
    );
    fireEvent.click(getByText('Deny'));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });
});
