import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, Plugin } from 'vite';
import tsconifgPaths from 'vite-tsconfig-paths';

function copySqlJsWasm(): Plugin {
  return {
    name: 'copy-sql-js-wasm',
    writeBundle(options) {
      const outDir = options.dir || resolve(__dirname, 'dist');
      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }
      const src = resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm');
      const dest = resolve(outDir, 'sql-wasm.wasm');
      copyFileSync(src, dest);
    },
  };
}

/**
 * Copies hnswlib-wasm assets to the dist directory.
 *
 * hnswlib-wasm is compiled with Emscripten's SINGLE_FILE mode, so the WASM
 * binary is embedded as a base64 data URI inside the JS bundle. No separate
 * .wasm file needs to be fetched at runtime.
 *
 * This plugin copies the pre-built JS files (which contain the embedded WASM)
 * into dist/ so they are available for the dynamic `import()` used by
 * `loadHnswlib()` at runtime.
 */
function copyHnswlibWasm(): Plugin {
  return {
    name: 'copy-hnswlib-wasm',
    writeBundle(options) {
      const outDir = options.dir || resolve(__dirname, 'dist');
      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }
      const hnswlibDist = resolve(__dirname, 'node_modules/hnswlib-wasm/dist');
      if (!existsSync(hnswlibDist)) {
        console.warn('[copy-hnswlib-wasm] hnswlib-wasm dist directory not found');
        return;
      }
      // Copy the JS files that contain the embedded WASM binary
      const files = readdirSync(hnswlibDist).filter(f => f.endsWith('.js'));
      for (const file of files) {
        const src = resolve(hnswlibDist, file);
        const dest = resolve(outDir, file);
        copyFileSync(src, dest);
      }
    },
  };
}

// https://vitejs.dev/config/
const isTest = process.env.VITEST === 'true';

export default defineConfig({
  plugins: [
    ...(!isTest ? [react()] : []),
    tsconifgPaths(),
    copySqlJsWasm(),
    copyHnswlibWasm(),
  ],
  base: '',
  resolve: {
    alias: {
      // hnswlib-wasm uses "module" field but no "exports" map, which Vite
      // cannot resolve automatically. Point it to the dist entry.
      'hnswlib-wasm': resolve(__dirname, 'node_modules/hnswlib-wasm/dist/hnswlib.js'),
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Split heavy dependencies into separate chunks that load lazily.
        // This prevents the 1.7 MB monolithic bundle from blocking Logseq's
        // main thread during startup (causes "Not Responding" on Windows).
        manualChunks: {
          'vendor-tiktoken': ['js-tiktoken'],
          'vendor-sqljs': ['sql.js'],
          'vendor-orama': ['@orama/orama', '@orama/plugin-data-persistence'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
