import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: { outDir: 'dist-preview', target: 'es2022', sourcemap: false, assetsInlineLimit: 0, rollupOptions: { input: 'src/preview/main.tsx', output: { entryFileNames: 'atom-preview.js', assetFileNames: 'assets/[name]-[hash][extname]' } } } });
