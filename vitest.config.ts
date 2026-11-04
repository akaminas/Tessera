import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}', 'integrations/**/src/**/*.test.ts'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/db/**/*.test.ts'],
          globalSetup: ['./tests/db/global-setup.ts'],
          testTimeout: 60000,
          hookTimeout: 180000,
          fileParallelism: false,
        },
      },
    ],
  },
});
