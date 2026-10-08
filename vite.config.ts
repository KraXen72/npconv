import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import path from 'path';

export default defineConfig({
  plugins: [solidPlugin()],
  base: '/npconv/',
  root: process.cwd(),
  build: {
    outDir: 'dist',
    sourcemap: true,
    rolldownOptions: {
      input: path.resolve(process.cwd(), 'index.html')
    }
  }
});
