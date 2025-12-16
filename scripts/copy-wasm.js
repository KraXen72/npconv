import fs from 'fs';
import path from 'path';

const src = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
const destDir = path.join(process.cwd(), 'public');
const dest = path.join(destDir, 'sql-wasm.wasm');

try {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log('Copied sql-wasm.wasm to public/');
  } else {
    console.warn('sql-wasm.wasm not found at', src);
  }
} catch (e) {
  console.error('Failed to copy sql-wasm.wasm', e);
  process.exit(1);
}
