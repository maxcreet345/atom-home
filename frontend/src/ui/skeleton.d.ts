export const SKELETON_CSS: string;
export const THEME_KEY: string;
export function readSkeletonTheme(): 'light' | 'dark';
export function rememberSkeletonTheme(theme: 'light' | 'dark'): void;
export function skeletonHtml(text?: string, theme?: 'light' | 'dark'): string;
export const LANG_KEY: string;
export const SKELETON_TEXT: Record<'ru' | 'en' | 'ro', { wait: string; fail: string }>;
export function readSkeletonLang(fallback?: string): 'ru' | 'en' | 'ro';
export function rememberSkeletonLang(lang: 'ru' | 'en' | 'ro'): void;
