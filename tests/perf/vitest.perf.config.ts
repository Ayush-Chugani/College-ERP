import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '../../src') } },
  test: { include: ['tests/perf/**/*.perf.ts'], testTimeout: 600_000, hookTimeout: 600_000 },
});
