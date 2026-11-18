import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
// the bundle knows which integration version it was built for (live-main.tsx: an update without a restart of Home Assistant is told to the administrator)
const version = JSON.parse(readFileSync(new URL('../custom_components/atom_home/manifest.json', import.meta.url), 'utf8')).version as string;
export default defineConfig({ define: { __ATOM_VERSION__: JSON.stringify(version) }, base: '/atom_home_static/', build: { outDir: '../custom_components/atom_home/frontend', emptyOutDir: true, target: 'es2022', sourcemap: false, assetsInlineLimit: 0, rollupOptions: { input: 'src/live-main.tsx', output: { entryFileNames: 'atom-home.js', assetFileNames: 'assets/[name]-[hash][extname]' } } } });
