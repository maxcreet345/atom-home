import { defineConfig } from 'vite';
export default defineConfig({ base: '/atom_home_static/', build: { outDir: '../custom_components/atom_home/frontend', emptyOutDir: true, target: 'es2022', sourcemap: false, assetsInlineLimit: 0, rollupOptions: { input: 'src/live-main.tsx', output: { entryFileNames: 'atom-home.js', assetFileNames: 'assets/[name]-[hash][extname]' } } } });
