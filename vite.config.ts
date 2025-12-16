import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: '/npconv/',
  root: process.cwd(),
  build: {
    outDir: 'docs',
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(process.cwd(), 'index.html')
    }
  }
});
