import { defineConfig } from 'vite';
// H-6 of the audit of 17.11.2026: one language as one self-contained ES module (no imports), built after the bundle into frontend/chunks/:
// LANG_ENTRY=en vite build --config vite.lang.config.ts. i18n/index.ts loads it from /atom_home_static/chunks/lang-<lang>.js.
const lang = process.env.LANG_ENTRY;
if (lang !== 'en' && lang !== 'ro') throw new Error('LANG_ENTRY must be en or ro');
export default defineConfig({ build: { outDir: '../custom_components/atom_home/frontend/chunks', emptyOutDir: false, target: 'es2022', sourcemap: false, minify: true, lib: { entry: `src/i18n/${lang}.ts`, formats: ['es'], fileName: () => `lang-${lang}.js` }, rollupOptions: { output: { inlineDynamicImports: true } } } });
