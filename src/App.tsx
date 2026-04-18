import { AppUserConfigs } from '@logseq/libs/dist/LSPlugin';
import ChatMessageList, { ChatMessage } from 'components/ChatMessageList';
import { useThemeMode } from 'hooks/useThemeMode';
import type { IndexingResult } from 'indexManager';
import { cancelAutoIndexDebounce, getIndexingProgress, isIndexingActive, requestPauseIndexing, setAutoEmbedEnabled as setAutoEmbedEnabledIM, setAutoIndexDebounceSeconds } from 'indexManager';
import { clearConversationHistory, enableAutoIndexer, handleQuery, indexEntireLogSeq } from 'manager';
import React, { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { executeAll } from './blockExecutor';
import { getActivePageContext } from './blockTreeFormatter';
import { getButtonState } from './buttonState';
import { AutoEmbedToggle } from './components/AutoEmbedToggle';
import { ChangeSummary } from './components/ChangeSummary';
import { EditToggle } from './components/EditToggle';
import { cancelCooldown, startCooldown } from './cooldownManager';
import { useAppVisible } from './hooks/useAppVisible';
import { useCtrlKey } from './hooks/useCtrlKey';
import { aiEditModeState, settingsState } from './state/settings';
import { darkTheme, keyframes, styled } from './stitches.config';
import type { StorageProvider } from './storage/StorageProvider';
import type { ExecutionResult } from './types/editTypes';

// --- Animations ---

const slideIn = keyframes({
  '0%': { transform: 'translateX(100%)' },
  '100%': { transform: 'translateX(0)' },
});

const fadeIn = keyframes({
  '0%': { opacity: 0, transform: 'translateY(-4px)' },
  '100%': { opacity: 1, transform: 'translateY(0)' },
});

const fadeOut = keyframes({
  '0%': { opacity: 1, transform: 'translateY(0)' },
  '100%': { opacity: 0, transform: 'translateY(-4px)' },
});

const pulse = keyframes({
  '0%, 100%': { opacity: 0.4 },
  '50%': { opacity: 1 },
});

// --- Styled Components ---

const Overlay = styled('div', {
  position: 'fixed',
  top: 0, right: 0, bottom: 0, left: 0,
  zIndex: 99,
  backgroundColor: 'rgba(0, 0, 0, 0.15)',
});

const ChatPanel = styled('main', {
  position: 'fixed',
  top: 0, right: 0, bottom: 0,
  width: '520px',
  maxWidth: '85%',
  backgroundColor: '$elevation0',
  boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.12)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 100,
  animation: `${slideIn} 0.25s ease-out`,
  borderLeft: '1px solid $slate6',
});

const Header = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid $slate6',
  backgroundColor: '$elevation0',
});

const HeaderLeft = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
});

const LogoIcon = styled('span', { fontSize: '18px' });

const Title = styled('h2', {
  margin: 0,
  fontSize: '15px',
  fontWeight: 600,
  color: '$highContrast',
});

const CloseButton = styled('button', {
  background: 'transparent',
  border: 'none',
  width: '28px',
  height: '28px',
  borderRadius: '6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: '$slate9',
  fontSize: '14px',
  transition: 'all 0.15s',
  '&:hover': { backgroundColor: '$slate3', color: '$highContrast' },
});

const HeaderRight = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
});

const HeaderButton = styled('button', {
  background: 'transparent',
  border: '1px solid $slate6',
  borderRadius: '6px',
  padding: '4px 8px',
  cursor: 'pointer',
  color: '$slate10',
  fontSize: '12px',
  fontWeight: 500,
  transition: 'all 0.15s',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  '&:hover': { backgroundColor: '$slate3', borderColor: '$slate8', color: '$highContrast' },
});

const MessagesContainer = styled('div', {
  flex: 1,
  overflowY: 'auto',
  padding: '16px',
  backgroundColor: '$elevation0',
  '&::-webkit-scrollbar': { width: '6px' },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': { background: '$slate6', borderRadius: '3px' },
  '& a.ctrl-link': {
    color: 'inherit',
    textDecoration: 'none',
    cursor: 'default',
  },
  '&.ctrl-held a.ctrl-link:hover': {
    textDecoration: 'underline',
    cursor: 'pointer',
  },
});

const ErrorBanner = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  margin: '0 16px',
  padding: '8px 12px',
  backgroundColor: '$red3',
  border: '1px solid $red6',
  borderRadius: '8px',
  color: '$red11',
  fontSize: '13px',
});

const RetryButton = styled('button', {
  background: 'none',
  border: 'none',
  color: '$red11',
  textDecoration: 'underline',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
  padding: 0,
  '&:hover': { color: '$red12' },
});

const InputArea = styled('div', {
  padding: '12px 16px 16px',
  borderTop: '1px solid $slate6',
  backgroundColor: '$elevation0',
});

const InputWrapper = styled('div', {
  display: 'flex',
  alignItems: 'flex-end',
  gap: '8px',
  border: '1px solid $slate7',
  borderRadius: '10px',
  padding: '8px 8px 8px 12px',
  backgroundColor: '$elevation1',
  transition: 'border-color 0.15s, box-shadow 0.15s',
  '&:focus-within': { borderColor: '$blue8', boxShadow: '0 0 0 2px $colors$blue4' },
});

const TextArea = styled('textarea', {
  flex: 1,
  minHeight: '80px',
  maxHeight: '160px',
  resize: 'none',
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontSize: '14px',
  fontFamily: 'inherit',
  lineHeight: 1.5,
  outline: 'none',
  color: '$highContrast',
  overflowY: 'auto',
  '&::placeholder': { color: '$slate8' },
  '&:disabled': { opacity: 0.5 },
  '&::-webkit-scrollbar': { width: '4px' },
  '&::-webkit-scrollbar-thumb': { background: '$slate6', borderRadius: '2px' },
});

const SendButton = styled('button', {
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  border: 'none',
  backgroundColor: '$blue9',
  color: 'white',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'background-color 0.15s, transform 0.1s',
  '&:hover:not(:disabled)': { backgroundColor: '$blue10' },
  '&:active:not(:disabled)': { transform: 'scale(0.95)' },
  '&:disabled': { opacity: 0.4, cursor: 'default' },
  svg: { width: '16px', height: '16px', fill: 'currentColor' },
});

const ToolbarRow = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '6px',
  marginTop: '8px',
});

const StatusText = styled('span', {
  fontSize: '11px',
  color: '$slate9',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
});

const ToolbarButton = styled('button', {
  padding: '5px 10px',
  borderRadius: '6px',
  border: '1px solid $slate6',
  backgroundColor: '$elevation1',
  color: '$slate11',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  '&:hover': { backgroundColor: '$elevation2', borderColor: '$slate8', color: '$highContrast' },
  variants: {
    variant: {
      index: {
        backgroundColor: '$green3',
        borderColor: '$green7',
        color: '$green11',
        '&:hover': { backgroundColor: '$green4', borderColor: '$green8', color: '$green12' },
      },
      pause: {
        backgroundColor: '$red3',
        borderColor: '$red7',
        color: '$red11',
        '&:hover': { backgroundColor: '$red4', borderColor: '$red8', color: '$red12' },
      },
    },
  },
});

const TypingIndicator = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '12px 16px',
  color: '$slate9',
  fontSize: '13px',
});

const Dot = styled('span', {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  backgroundColor: '$slate8',
  animation: `${pulse} 1.2s ease-in-out infinite`,
  variants: {
    delay: {
      0: { animationDelay: '0s' },
      1: { animationDelay: '0.2s' },
      2: { animationDelay: '0.4s' },
    },
  },
});

const StatusIndicator = styled('span', {
  fontSize: '11px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 8px',
  borderRadius: '6px',
  fontWeight: 500,

  '@motionSafe': {
    animation: `${fadeIn} 0.2s ease-out`,
  },

  variants: {
    variant: {
      success: {
        backgroundColor: '$green3',
        color: '$green11',
      },
      paused: {
        backgroundColor: '$amber3',
        color: '$amber11',
      },
      progress: {
        backgroundColor: 'transparent',
        color: '$slate9',
      },
    },
    dismissing: {
      true: {
        '@motionSafe': {
          animation: `${fadeOut} 0.2s ease-in forwards`,
        },
      },
    },
  },
});

// --- Component ---

type Props = {
  themeMode: AppUserConfigs['preferredThemeMode'];
  storageProvider: StorageProvider;
};

export function App({ themeMode: initialThemeMode, storageProvider }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isVisible = useAppVisible();
  const themeMode = useThemeMode(initialThemeMode);
  const ctrlHeld = useCtrlKey();
  const settings = useRecoilValue(settingsState);
  const [aiEditMode, setAiEditMode] = useRecoilState(aiEditModeState);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isIndexing, setIsIndexing] = useState(isIndexingActive());
  const [editResults, setEditResults] = useState<Map<string | number, ExecutionResult>>(new Map());

  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [indexingStatus, setIndexingStatus] = useState<IndexingResult | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);
  const [progressCount, setProgressCount] = useState(getIndexingProgress);
  const [autoEmbedEnabled, setAutoEmbedEnabled] = useState(() => (logseq.settings?.autoEmbedEnabled as boolean) ?? true);
  const [cooldownActive, setCooldownActive] = useState(false);

  // Cancel cooldown timer on unmount
  useEffect(() => {
    return () => { cancelCooldown(); };
  }, []);

  // Poll document and page count every 10 seconds
  useEffect(() => {
    const fetchCount = async () => {
      if (storageProvider.getDocumentCount) {
        try {
          const count = await storageProvider.getDocumentCount();
          setDocCount(count);
        } catch { /* ignore */ }
      }
      if (storageProvider.getPageCount) {
        try {
          const count = await storageProvider.getPageCount();
          setPageCount(count);
        } catch { /* ignore */ }
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 10000);
    return () => clearInterval(interval);
  }, [storageProvider]);

  useEffect(() => {
    if (settings) {
      enableAutoIndexer(settings, storageProvider);
      // Sync configurable debounce delay from settings
      const debounce = settings.autoIndexDebounceSeconds;
      if (typeof debounce === 'number' && debounce > 0) {
        setAutoIndexDebounceSeconds(debounce);
      }
    }
  }, [settings]);

  // Auto-dismiss success status after 4 seconds
  useEffect(() => {
    if (indexingStatus?.outcome !== 'completed') return;
    const timer = setTimeout(() => {
      setIsDismissing(true);
      // Remove from DOM after animation completes
      setTimeout(() => { setIndexingStatus(null); setIsDismissing(false); }, 200);
    }, 4000);
    return () => clearTimeout(timer);
  }, [indexingStatus]);

  // Poll indexing progress every 500ms while indexing is active.
  // Also detects when auto-indexer finishes (isIndexingActive becomes false).
  useEffect(() => {
    if (!isIndexing) return;
    const interval = setInterval(() => {
      setProgressCount(getIndexingProgress());
      // Detect auto-indexer completion
      if (!manualIndexingRef.current && !isIndexingActive()) {
        setIsIndexing(false);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isIndexing]);

  // Detect auto-indexer activity: poll isIndexingActive() to sync the
  // React isIndexing state with the module-level indexingInProgress flag.
  // Polls every 1s when the panel is visible and not during manual indexing.
  const manualIndexingRef = useRef(false);
  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(() => {
      if (manualIndexingRef.current) return;
      const active = isIndexingActive();
      setIsIndexing(prev => {
        if (active && !prev) return true;
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isVisible]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputMessage(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const handleSubmit = async () => {
    if (!inputMessage.trim()) return;

    setInputHistory(prev => [...prev, inputMessage.trim()]);
    setHistoryIndex(-1);
    setSavedDraft('');

    const userMessage: ChatMessage = {
      id: Date.now() + '_user',
      content: inputMessage.trim(),
      sender: 'user',
    };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);
    setError(null);
    setInputMessage('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // When edit mode is on, check for an active page first
      let effectiveEditMode = aiEditMode || undefined;
      if (aiEditMode) {
        const pageCtx = await getActivePageContext();
        if (!pageCtx) {
          effectiveEditMode = undefined;
          setMessages(prev => [...prev, {
            id: Date.now() + '_warning',
            content: '⚠️ No active page is open. Edit mode requires an open page to work. Sending query without edit context.',
            sender: 'assistant',
          }]);
        }
      }

      const resp = await handleQuery(inputMessage.trim(), settings, storageProvider, controller.signal, effectiveEditMode);
      abortControllerRef.current = null;

      if (aiEditMode && typeof resp === 'object' && resp !== null && 'text' in resp) {
        const editResp = resp;
        const assistantMsgId = Date.now() + '_assistant';
        setMessages(prev => [...prev, {
          id: assistantMsgId,
          content: editResp.text,
          sender: 'assistant',
        }]);

        if (editResp.commands.length > 0) {
          const result = await executeAll(editResp.commands);
          setEditResults(prev => new Map(prev).set(assistantMsgId, result));
        }
      } else {
        setMessages(prev => [...prev, {
          id: Date.now() + '_assistant',
          content: typeof resp === 'string' ? resp : resp.text,
          sender: 'assistant',
        }]);
      }
    } catch (err: any) {
      abortControllerRef.current = null;
      if (err.name === 'AbortError') {
        // User cancelled — don't show error
        return;
      }
      console.error('Error in handleQuery:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    if (e.key === 'ArrowUp' && inputHistory.length > 0) {
      const ta = e.currentTarget;
      if (ta.selectionStart === 0 && ta.selectionEnd === 0) {
        e.preventDefault();
        if (historyIndex === -1) {
          setSavedDraft(inputMessage);
          const idx = inputHistory.length - 1;
          setHistoryIndex(idx);
          setInputMessage(inputHistory[idx]);
        } else if (historyIndex > 0) {
          const idx = historyIndex - 1;
          setHistoryIndex(idx);
          setInputMessage(inputHistory[idx]);
        }
      }
    }
    if (e.key === 'ArrowDown' && historyIndex >= 0) {
      const ta = e.currentTarget;
      if (ta.selectionStart === ta.value.length) {
        e.preventDefault();
        if (historyIndex < inputHistory.length - 1) {
          const idx = historyIndex + 1;
          setHistoryIndex(idx);
          setInputMessage(inputHistory[idx]);
        } else {
          setHistoryIndex(-1);
          setInputMessage(savedDraft);
        }
      }
    }
  };

  const handleIndexDB = async () => {
    if (isIndexing) {
      requestPauseIndexing();
      cancelAutoIndexDebounce();
      startCooldown(() => setCooldownActive(false));
      setCooldownActive(true);
      return;
    }
    if (cooldownActive) return;
    manualIndexingRef.current = true;
    setIsIndexing(true);
    setError(null);
    setIndexingStatus(null);
    setIsDismissing(false);

    try {
      const result = await indexEntireLogSeq(settings, storageProvider);
      if (result.outcome === 'error') {
        setError(result.errorMessage || 'Indexing failed.');
      } else {
        setIndexingStatus(result);
      }
    } catch (err: any) {
      setError(err.message || 'Indexing failed.');
    } finally {
      setIsIndexing(false);
      manualIndexingRef.current = false;
    }
  };

  const handleNewSession = () => {
    setMessages([]);
    setInputMessage('');
    setError(null);
    setAiEditMode(false);
    setEditResults(new Map());
    clearConversationHistory();
  };

  const handleAutoEmbedToggle = () => {
    const newValue = !autoEmbedEnabled;
    setAutoEmbedEnabled(newValue);
    setAutoEmbedEnabledIM(newValue);
    logseq.updateSettings({ autoEmbedEnabled: newValue });
    // When disabling auto-embed, also stop any in-progress auto-indexing
    // and cancel pending debounce timers so the user gets immediate feedback
    if (!newValue && isIndexing && !manualIndexingRef.current) {
      requestPauseIndexing();
      cancelAutoIndexDebounce();
    }
  };

  if (!isVisible) return null;

  const buttonProps = getButtonState({ isIndexing, isCooldownActive: cooldownActive });

  return (
    <Overlay onClick={e => {
      if (!panelRef.current?.contains(e.target as Node)) window.logseq.hideMainUI();
    }}>
      <ChatPanel ref={panelRef} className={themeMode === 'dark' ? darkTheme.className : ''}>
        <Header>
          <HeaderLeft>
            <LogoIcon>✍️</LogoIcon>
            <Title>Composer</Title>
          </HeaderLeft>
          <HeaderRight>
            <HeaderButton onClick={handleNewSession} aria-label="New Session">✨ New</HeaderButton>
            <CloseButton onClick={() => window.logseq.hideMainUI()} aria-label="Close">✕</CloseButton>
          </HeaderRight>
        </Header>

        <MessagesContainer id="messages-container" className={ctrlHeld ? 'ctrl-held' : ''}>
          <ChatMessageList
            messages={messages}
            getBlockMetadata={(uuid) => {
              const provider = storageProvider as any;
              return provider.getBlockMetadata?.(uuid) ?? null;
            }}
          />
          {messages.map((msg) => {
            const result = editResults.get(msg.id);
            return result ? (
              <div key={`summary-${msg.id}`} style={{ display: 'flex', gap: '8px', justifyContent: 'flex-start', marginTop: '12px' }}>
                <div style={{ width: '28px', flexShrink: 0 }} />
                <div style={{ maxWidth: '80%' }}>
                  <ChangeSummary result={result} />
                </div>
              </div>
            ) : null;
          })}
          {loading && (
            <TypingIndicator>
              <Dot delay={0} /><Dot delay={1} /><Dot delay={2} />
            </TypingIndicator>
          )}
          <div ref={messagesEndRef} />
        </MessagesContainer>

        {error && (
          <ErrorBanner>
            <span>⚠️</span>
            <span style={{ flex: 1 }}>{error}</span>
            <RetryButton onClick={handleSubmit}>Retry</RetryButton>
          </ErrorBanner>
        )}

        <InputArea>
          <InputWrapper>
            <TextArea
              ref={textareaRef}
              placeholder={loading ? 'Thinking...' : 'Ask about your notes...'}
              value={inputMessage}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={loading}
              rows={4}
            />
            {loading ? (
              <SendButton onClick={handleCancel} aria-label="Cancel" css={{ backgroundColor: '$red9', '&:hover:not(:disabled)': { backgroundColor: '$red10' } }}>
                <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              </SendButton>
            ) : (
              <SendButton onClick={handleSubmit} disabled={!inputMessage.trim()} aria-label="Send">
                <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
              </SendButton>
            )}
          </InputWrapper>
          <ToolbarRow>
            {isIndexing ? (
              <StatusIndicator variant="progress">
                Indexing… {progressCount} pages processed
              </StatusIndicator>
            ) : indexingStatus?.outcome === 'completed' ? (
              <StatusIndicator variant="success" dismissing={isDismissing || undefined}>
                ✓ Indexing complete — {docCount?.toLocaleString()} chunks indexed{pageCount ? ` from ${pageCount.toLocaleString()} pages` : ''}
              </StatusIndicator>
            ) : indexingStatus?.outcome === 'paused' ? (
              <StatusIndicator variant="paused">
                ⏸ Indexing paused
              </StatusIndicator>
            ) : (
              <StatusText>
                {docCount !== null && <>📊 {docCount.toLocaleString()} chunks indexed{pageCount ? ` from ${pageCount.toLocaleString()} pages` : ''}</>}
              </StatusText>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AutoEmbedToggle enabled={autoEmbedEnabled} onToggle={handleAutoEmbedToggle} />
              <EditToggle enabled={aiEditMode} onToggle={() => setAiEditMode(prev => !prev)} />
              {storageProvider.exportToFile && (
                <ToolbarButton onClick={() => storageProvider.exportToFile?.()}>📥 Export</ToolbarButton>
              )}
              <ToolbarButton
                variant={buttonProps.variant}
                onClick={handleIndexDB}
                disabled={buttonProps.disabled}
                css={buttonProps.disabled ? { opacity: 0.5, cursor: 'default' } : undefined}
              >
                {buttonProps.label}
              </ToolbarButton>
            </div>
          </ToolbarRow>
        </InputArea>
      </ChatPanel>
    </Overlay>
  );
}

export default App;
