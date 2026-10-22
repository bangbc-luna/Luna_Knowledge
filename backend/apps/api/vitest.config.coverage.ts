import { defineConfig, mergeConfig } from 'vitest/config';
import e2e from './vitest.config.e2e.js';

export default mergeConfig(
  e2e,
  defineConfig({
    test: {
      include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
      coverage: {
        enabled: true,
        provider: 'v8',
        reporter: ['text'],
        allowExternal: true,
        include: [
          'src/content/content-access.service.ts',
          'src/auth/auth.guard.ts',
          'src/workspaces/workspaces.service.ts',
          '**/packages/db/dist/access.js',
          '**/packages/db/src/access.ts',
        ],
        thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  }),
);
