import '@logseq/libs';
import React from 'react';
import ReactDOM from 'react-dom';
import { RecoilRoot } from 'recoil';
import 'VectorDBManager';
import App from './App';
import settings from './settings';
import { createStorageProvider } from './storage/createStorageProvider';
import type { StorageProvider } from './storage/StorageProvider';
import { ensureInitialized as ensureTokenizerReady } from './tokenizer';

/**
 * Lazy storage provider wrapper. Defers the heavy SQLite WASM initialization
 * until the first method call (typically when the user opens the chat panel
 * or the auto-indexer fires). This prevents blocking Logseq's main thread
 * during startup, which causes "Not Responding" on Windows.
 */
function createLazyStorageProvider(backend: 'sqlite' | 'settings'): StorageProvider {
  let realProvider: StorageProvider | null = null;
  let initPromise: Promise<StorageProvider> | null = null;

  async function getProvider(): Promise<StorageProvider> {
    if (realProvider) return realProvider;
    if (!initPromise) {
      initPromise = (async () => {
        // Initialize the tokenizer (loads ~1.5 MB cl100k_base encoding table)
        await ensureTokenizerReady();
        const p = await createStorageProvider(backend);
        realProvider = p;
        return p;
      })();
    }
    return initPromise;
  }

  // Start initialization when the browser is idle, with a fallback timeout.
  // requestIdleCallback ensures we only parse the heavy 1.25 MB indexManager
  // chunk when the main thread has nothing else to do.
  const scheduleInit = typeof requestIdleCallback === 'function'
    ? () => requestIdleCallback(() => { getProvider().catch(console.error); }, { timeout: 10000 })
    : () => setTimeout(() => { getProvider().catch(console.error); }, 5000);
  scheduleInit();

  const proxy: StorageProvider = {
    async clear() {
      const p = await getProvider();
      return p.clear();
    },
  };

  // Proxy all optional methods so they resolve lazily
  const optionalAsyncMethods = [
    'upsertDocuments', 'deleteDocuments', 'searchByVector',
    'getDocumentMeta', 'save', 'load',
  ] as const;

  for (const method of optionalAsyncMethods) {
    (proxy as any)[method] = async (...args: any[]) => {
      const p = await getProvider();
      const fn = (p as any)[method];
      return fn ? fn.apply(p, args) : undefined;
    };
  }

  // Proxy sync/optional methods that need the real provider
  const optionalSyncMethods = [
    'exportToFile', 'beginBulk', 'endBulk',
    'upsertBlockMetadata', 'deleteBlockMetadataForPage',
    'clearBlockMetadata', 'getBlockMetadata',
  ] as const;

  for (const method of optionalSyncMethods) {
    (proxy as any)[method] = (...args: any[]) => {
      if (!realProvider) {
        console.warn(`[LazyStorageProvider] ${method} called before initialization`);
        return undefined;
      }
      const fn = (realProvider as any)[method];
      return fn ? fn.apply(realProvider, args) : undefined;
    };
  }

  // Proxy async count methods
  (proxy as any).getDocumentCount = async () => {
    const p = await getProvider();
    return (p as any).getDocumentCount?.() ?? 0;
  };
  (proxy as any).getPageCount = async () => {
    const p = await getProvider();
    return (p as any).getPageCount?.() ?? 0;
  };
  (proxy as any).persistToIndexedDB = async () => {
    const p = await getProvider();
    return (p as any).persistToIndexedDB?.();
  };
  (proxy as any).getAllDocumentContent = () => {
    if (!realProvider) return [];
    return (realProvider as any).getAllDocumentContent?.() ?? [];
  };

  return proxy;
}

async function main() {
  const key = logseq.baseInfo.id;
  console.info(`${key}: MAIN`);

  // Create a lazy storage provider that defers heavy SQLite initialization
  const storageBackend = (logseq.settings?.storageBackend as 'sqlite' | 'settings') ?? 'sqlite';
  const storageProvider = createLazyStorageProvider(storageBackend);

  const { preferredThemeMode } = await logseq.App.getUserConfigs();

  ReactDOM.render(
    <React.StrictMode>
      <RecoilRoot>
        <App themeMode={preferredThemeMode} storageProvider={storageProvider} />
      </RecoilRoot>
    </React.StrictMode>,
    document.getElementById('root'),
  );

  logseq.provideModel({
    show() {
      logseq.showMainUI();

      setTimeout(() => {
        const container = document.getElementById("messages-container");
        if (container) {
          container.scrollTop = container.scrollHeight;
        } else {
          console.warn("Messages container not found.");
        }
      }, 300);
    },
  });

  logseq.setMainUIInlineStyle({
    position: 'fixed',
    zIndex: 11,
  });

  const toolbarButtonKey = 'logseq-composer';

  logseq.provideStyle(`
    div[data-injected-ui=${toolbarButtonKey}-${key}] {
      display: flex;
      align-items: center;
      font-weight: 500;
      position: relative;
    }
  `);

  logseq.App.registerUIItem('toolbar', {
    key: toolbarButtonKey,
    template: `
      <a data-on-click="show" class="button"
         style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 24 24">
  <path fill-rule="evenodd" d="M8 7V2.221a2 2 0 0 0-.5.365L3.586 6.5a2 2 0 0 0-.365.5H8Zm2 0V2h7a2 2 0 0 1 2 2v.126a5.087 5.087 0 0 0-4.74 1.368v.001l-6.642 6.642a3 3 0 0 0-.82 1.532l-.74 3.692a3 3 0 0 0 3.53 3.53l3.694-.738a3 3 0 0 0 1.532-.82L19 15.149V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9h5a2 2 0 0 0 2-2Z" clip-rule="evenodd"/>
  <path fill-rule="evenodd" d="M17.447 8.08a1.087 1.087 0 0 1 1.187.238l.002.001a1.088 1.088 0 0 1 0 1.539l-.377.377-1.54-1.542.373-.374.002-.001c.1-.102.22-.182.353-.237Zm-2.143 2.027-4.644 4.644-.385 1.924 1.925-.385 4.644-4.642-1.54-1.54Zm2.56-4.11a3.087 3.087 0 0 0-2.187.909l-6.645 6.645a1 1 0 0 0-.274.51l-.739 3.693a1 1 0 0 0 1.177 1.176l3.693-.738a1 1 0 0 0 .51-.274l6.65-6.646a3.088 3.088 0 0 0-2.185-5.275Z" clip-rule="evenodd"/>
</svg>
      </a>
    `,
  });
}

logseq.useSettingsSchema(settings);
logseq.ready().then(main).catch(console.error);
