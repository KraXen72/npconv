import process from 'process';
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const prod = (process.argv[2] === 'production');

const context = await esbuild.context({
	entryPoints: [
		'src/main.ts'
	],
	bundle: true,
	format: 'esm',
	target: 'es2023',
	platform: 'browser',
	logLevel: 'info',
	sourcemap: 'linked',
	treeShaking: true,
	minify: prod,
	outdir: './dist'
});

async function copyStatic() {
	try {
		const cwd = process.cwd();
		// copy index.html and style.css to dist
		fs.copyFileSync(path.join(cwd, 'index.html'), path.join(cwd, 'dist', 'index.html'));
		fs.copyFileSync(path.join(cwd, 'style.css'), path.join(cwd, 'dist', 'style.css'));
		// copy sql.js wasm file from node_modules to dist
		const wasmSrc = path.join(cwd, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
		if (fs.existsSync(wasmSrc)) {
			fs.copyFileSync(wasmSrc, path.join(cwd, 'dist', 'sql-wasm.wasm'));
		} else {
			console.warn('sql-wasm.wasm not found in node_modules/sql.js/dist; ensure sql.js is installed');
		}
		console.log('Copied static assets to dist/');
	} catch (e) {
		console.error('Failed to copy static assets to dist/', e);
	}
}

if (prod) {
	await context.rebuild();
	await copyStatic();
	process.exit(0);
} else {
	await context.watch();
	await copyStatic();
}