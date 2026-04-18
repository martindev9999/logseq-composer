import React from 'react';
import { styled } from '../stitches.config';
import type { EditCommand } from '../types/editTypes';

/* ------------------------------------------------------------------ */
/*  Styled primitives                                                  */
/* ------------------------------------------------------------------ */

const Card = styled('div', {
  backgroundColor: '$slate3',
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
  gap: '8px',
});

const Badge = styled('span', {
  fontSize: '$1',
  fontWeight: '$medium',
  padding: '2px 8px',
  borderRadius: '$pill',
  textTransform: 'capitalize',

  variants: {
    action: {
      insert: {
        backgroundColor: '$green3',
        color: '$green9',
      },
      update: {
        backgroundColor: '$blue3',
        color: '$blue9',
      },
      delete: {
        backgroundColor: '$red3',
        color: '$red9',
      },
    },
  },
});

const ContentPreview = styled('span', {
  fontSize: '$2',
  color: '$slate11',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const Actions = styled('div', {
  display: 'flex',
  gap: '8px',
  marginTop: '4px',
});

const Button = styled('button', {
  fontSize: '$1',
  fontFamily: '$sans',
  fontWeight: '$medium',
  padding: '4px 12px',
  borderRadius: '$2',
  border: 'none',
  cursor: 'pointer',
  transition: 'opacity 0.15s ease',

  '&:hover': {
    opacity: 0.85,
  },

  variants: {
    variant: {
      allow: {
        backgroundColor: '$green9',
        color: 'white',
      },
      deny: {
        backgroundColor: '$slate9',
        color: 'white',
      },
    },
  },
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function truncate(text: string | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface PermissionPromptProps {
  command: EditCommand;
  onAllow: () => void;
  onDeny: () => void;
}

export function PermissionPrompt({ command, onAllow, onDeny }: PermissionPromptProps) {
  const preview = truncate(command.content, 80);

  return (
    <Card>
      <Header>
        <Badge action={command.action}>{command.action}</Badge>
        {preview && <ContentPreview>{preview}</ContentPreview>}
      </Header>
      <Actions>
        <Button variant="allow" onClick={onAllow}>
          Allow
        </Button>
        <Button variant="deny" onClick={onDeny}>
          Deny
        </Button>
      </Actions>
    </Card>
  );
}
