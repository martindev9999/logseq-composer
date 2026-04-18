import React from 'react';
import { styled } from '../stitches.config';
import type { EditCommand } from '../types/editTypes';

/* ------------------------------------------------------------------ */
/*  Styled primitives                                                  */
/* ------------------------------------------------------------------ */

const Wrapper = styled('div', {
  backgroundColor: '$slate2',
  border: '1px solid $slate6',
  borderRadius: '8px',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontFamily: '$sans',
});

const LabelRow = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
});

const SkippedBadge = styled('span', {
  fontSize: '$1',
  fontWeight: '$medium',
  color: '$slate8',
  backgroundColor: '$slate3',
  padding: '1px 6px',
  borderRadius: '$pill',
});

const ActionLabel = styled('span', {
  fontSize: '$1',
  fontWeight: '$medium',
  color: '$slate8',
  textTransform: 'capitalize',
});

const CodeBlock = styled('pre', {
  backgroundColor: '$slate3',
  borderRadius: '6px',
  padding: '10px 12px',
  overflow: 'auto',
  fontSize: '13px',
  margin: 0,
  color: '$slate8',
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

const Note = styled('p', {
  fontSize: '$2',
  color: '$slate8',
  margin: 0,
  fontStyle: 'italic',
});

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface DeniedCommandFallbackProps {
  command: EditCommand;
}

export function DeniedCommandFallback({ command }: DeniedCommandFallbackProps): JSX.Element {
  const isDelete = command.action === 'delete';

  return (
    <Wrapper data-testid="denied-command-fallback">
      <LabelRow>
        <SkippedBadge>Skipped</SkippedBadge>
        <ActionLabel>{command.action}</ActionLabel>
      </LabelRow>

      {isDelete ? (
        <Note>Block was not deleted</Note>
      ) : (
        <CodeBlock>{command.content ?? ''}</CodeBlock>
      )}
    </Wrapper>
  );
}
