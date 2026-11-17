import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Run as child processes by the integration tests, which v8 coverage does not follow.
      exclude: ['src/cli/index.ts', 'src/vitest/**', 'src/reporter/**'],
      reporter: ['text-summary', 'html'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 85 },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
    ],
  },
});
