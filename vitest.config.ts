import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against source, not build output, so a stale dist can never make a
    // passing suite lie about the code that ships.
    alias: {
      '@hei/audit': src('audit'),
      '@hei/rules-engine': src('rules-engine'),
      '@hei/rules-loader': src('rules-loader'),
      '@hei/extraction': src('extraction'),
      '@hei/monitoring': src('monitoring'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'scripts/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    environment: 'node',
  },
});
