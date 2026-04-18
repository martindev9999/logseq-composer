import React from 'react';
import { styled } from '../stitches.config';
import type { ExecutionResult, OperationOutcome } from '../types/editTypes';

/* ------------------------------------------------------------------ */
/*  Styled primitives                                                  */
/* ------------------------------------------------------------------ */

const Card = styled('div', {
  backgroundColor: '$slate2',
  border: '1px solid $slate6',
  borderRadius: '8px',
  padding: '$4',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  fontFamily: '$sans',
});

const Header = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '$2',
  fontWeight: '$medium',
  color: '$slate12',
});

const Counts = styled('span', {
  fontSize: '$1',
  color: '$slate11',
});

const ErrorBanner = styled('div', {
  backgroundColor: '$red3',
  color: '$red9',
  fontSize: '$2',
  fontWeight: '$medium',
  padding: '8px 12px',
  borderRadius: '$2',
  textAlign: 'center',
});

const OutcomeList = styled('ul', {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
});

const OutcomeItem = styled('li', {
  display: 'flex',
  alignItems: 'baseline',
  gap: '6px',
  fontSize: '$1',
  color: '$slate11',

  variants: {
    status: {
      success: { color: '$slate12' },
      error: { color: '$red9' },
      denied: {
        color: '$slate8',
        textDecoration: 'line-through',
      },
    },
  },
});

const StatusIcon = styled('span', {
  flexShrink: 0,
  fontWeight: '$bold',

  variants: {
    status: {
      success: { color: '$green9' },
      error: { color: '$red9' },
      denied: { color: '$slate8' },
    },
  },
});

const ActionLabel = styled('span', {
  fontWeight: '$medium',
  textTransform: 'capitalize',
});

const Preview = styled('span', {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function truncatePreview(text: string | undefined, max = 80): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface ChangeSummaryProps {
  result: ExecutionResult;
}

function renderOutcome(outcome: OperationOutcome, index: number) {
  const { command, status, error } = outcome;

  if (status === 'success') {
    return (
      <OutcomeItem key={index} status="success">
        <StatusIcon status="success">✓</StatusIcon>
        <ActionLabel>{command.action}</ActionLabel>
        <Preview>{truncatePreview(command.content)}</Preview>
      </OutcomeItem>
    );
  }

  if (status === 'error') {
    return (
      <OutcomeItem key={index} status="error">
        <StatusIcon status="error">✗</StatusIcon>
        <ActionLabel>{command.action}</ActionLabel>
        <Preview>{error ?? 'Unknown error'}</Preview>
      </OutcomeItem>
    );
  }

  // denied
  return (
    <OutcomeItem key={index} status="denied">
      <StatusIcon status="denied">–</StatusIcon>
      <ActionLabel>{command.action}</ActionLabel>
      <Preview>Skipped</Preview>
    </OutcomeItem>
  );
}

export function ChangeSummary({ result }: ChangeSummaryProps) {
  const { successCount, failedCount, outcomes } = result;
  const allFailed = successCount === 0 && failedCount > 0;

  return (
    <Card data-testid="change-summary">
      <Header>
        <span>Changes Applied</span>
        <Counts>
          {successCount} succeeded, {failedCount} failed
        </Counts>
      </Header>

      {allFailed && <ErrorBanner>No changes were applied</ErrorBanner>}

      <OutcomeList>
        {outcomes.map((outcome, i) => renderOutcome(outcome, i))}
      </OutcomeList>
    </Card>
  );
}
