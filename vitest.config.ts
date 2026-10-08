import { defineConfig, mergeConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import viteConfig from './vite.config';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default mergeConfig(viteConfig, defineConfig({
  root: projectRoot,
  resolve: {
    alias: { '@tests': resolve(projectRoot, 'tests') }
  },
  test: {
    environment: 'node',
    provide: { fixturesRoot: resolve(projectRoot, 'fixtures') },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.ts', 'src/types/**'],
      reporter: ['text', 'html', 'json', 'json-summary']
    }
  }
}));
