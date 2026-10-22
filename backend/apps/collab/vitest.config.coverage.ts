import { defineConfig, mergeConfig } from 'vitest/config';
import e2e from './vitest.config.e2e.js';

export default mergeConfig(
  e2e,
  defineConfig({
    test: {
      coverage: {
        enabled: true,
        provider: 'v8',
        reporter: ['text'],
        allowExternal: true,
        include: ['src/auth.ts', '**/packages/db/src/documents.ts'],
        thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  }),
);
