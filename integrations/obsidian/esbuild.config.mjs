import esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron'],
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  logLevel: 'info',
  minify: true,
  outfile: 'main.js',
});

// The files an Obsidian plugin folder needs, also published with the app
// so they can be downloaded from Settings → Obsidian.
const out = '../../public/obsidian-plugin';
mkdirSync(out, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(f, `${out}/${f}`);
