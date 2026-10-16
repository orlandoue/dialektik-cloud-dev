import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['services/core-api/test/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
});
