import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadVectorDatabase } from '../src/VectorDBManager';

let persistedDB: any;

vi.mock('@orama/plugin-data-persistence', () => {
  return {
    persist: vi.fn(async (db: any) => {
      persistedDB = db;
      return 'token';
    }),
    restore: vi.fn(async () => persistedDB),
  };
});

describe('VectorDBManager schema/dimension guard', () => {
  beforeEach(() => {
    persistedDB = undefined;
    (global as any).logseq = {
      updateSettings: vi.fn(async (s: any) => {
        Object.assign((global as any).__settings, s);
      }),
    };
    (global as any).__settings = {};
  });

  it('rebuilds when schema version mismatches', async () => {
    const settings: any = {
      VectorDBLogseqCopilot: 'token',
      VectorDBDimension: 16,
      VectorDBSchemaVersion: 1,
    };

    await loadVectorDatabase(settings, { dimension: 16 });

    expect((global as any).logseq.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        VectorDBSchemaVersion: 2,
        VectorDBDimension: 16,
      }),
    );
  });

  it('rebuilds when dimension mismatches', async () => {
    const settings: any = {
      VectorDBLogseqCopilot: 'token',
      VectorDBDimension: 8,
      VectorDBSchemaVersion: 2,
    };

    await loadVectorDatabase(settings, { dimension: 32 });

    expect((global as any).logseq.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        VectorDBDimension: 32,
      }),
    );
  });
});
