import React from 'react';
import { styled } from '../stitches.config';

/* ------------------------------------------------------------------ */
/*  Styled primitives                                                  */
/* ------------------------------------------------------------------ */

const Container = styled('div', {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
});

const Label = styled('span', {
  fontSize: '$1',
  fontFamily: '$sans',
  color: '$slate11',
  userSelect: 'none',
});

const Track = styled('span', {
  position: 'relative',
  width: '36px',
  height: '20px',
  borderRadius: '$pill',
  cursor: 'pointer',
  transition: 'background-color 0.2s ease',
  outline: 'none',

  '&:focus-visible': {
    boxShadow: '0 0 0 2px $colors$blue7',
  },

  variants: {
    active: {
      true: {
        backgroundColor: '$blue9',
      },
      false: {
        backgroundColor: '$slate6',
      },
    },
  },
  defaultVariants: {
    active: false,
  },
});

const Dot = styled('span', {
  position: 'absolute',
  top: '2px',
  width: '16px',
  height: '16px',
  borderRadius: '$pill',
  transition: 'left 0.2s ease, background-color 0.2s ease',
  pointerEvents: 'none',

  variants: {
    active: {
      true: {
        left: '18px',
        backgroundColor: 'white',
      },
      false: {
        left: '2px',
        backgroundColor: '$slate9',
      },
    },
  },
  defaultVariants: {
    active: false,
  },
});

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface EditToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

export function EditToggle({ enabled, onToggle }: EditToggleProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <Container>
      <Track
        role="switch"
        aria-checked={enabled}
        tabIndex={0}
        active={enabled}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
      >
        <Dot active={enabled} />
      </Track>
      <Label>AI Edit</Label>
    </Container>
  );
}
