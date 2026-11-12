import { defineConfig } from 'vitest/config';
import { NwiseKitReporter } from '../../../../src/reporter/index.js';

export default defineConfig({
  test: {
    include: ['**/*.fixture.ts'],
    pool: 'forks',
    reporters: [new NwiseKitReporter({ outputDir: process.env['NWISE_KIT_OUT'] ?? 'out' })],
  },
});
