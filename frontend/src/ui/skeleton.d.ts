export const SKELETON_CSS: string;
export const THEME_KEY: string;
export function readSkeletonTheme(): 'light' | 'dark';
export function rememberSkeletonTheme(theme: 'light' | 'dark'): void;
export function skeletonHtml(text?: string, theme?: 'light' | 'dark'): string;
