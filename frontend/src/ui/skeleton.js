// First paint before the bundle, the registry and the config are here (ST-1 / F3 of the audit of 04.11.2026): a quiet grey shell with
// the geometry of the home grid, so a wall tablet never wakes up to a black screen. Plain JS so the QA scripts (Node) and the panel
// (Vite) share one copy; the HA loader in custom_components/atom_home/__init__.py (LOADER_JS) carries the same markup — keep them in step.
export const SKELETON_CSS = '.hm-skeleton{position:absolute;inset:0;display:flex;flex-direction:column;gap:16px;padding:20px 24px;background:#f2f2f6;color:#6b6b70;font:500 15px/1.4 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif;overflow:hidden;box-sizing:border-box}'
  + '.hm-skeleton-head{height:34px;width:42%;max-width:260px;border-radius:10px}.hm-skeleton-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(142px,1fr));gap:12px}.hm-skeleton-tile{aspect-ratio:1;border-radius:22px}'
  + '.hm-skeleton .is-bone{background:linear-gradient(100deg,#e3e3ea 30%,#ededf2 50%,#e3e3ea 70%);background-size:200% 100%;animation:hm-shimmer 1.4s linear infinite}.hm-skeleton p{margin:auto 0 0;text-align:center}'
  + '@keyframes hm-shimmer{to{background-position:-200% 0}}@media (max-width:599px){.hm-skeleton{padding:14px}.hm-skeleton-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}'
  + '@media (prefers-reduced-motion:reduce){.hm-skeleton .is-bone{animation:none}}.hm-skeleton.is-dark{background:#0f1016;color:#ffffffcc}.hm-skeleton.is-dark .is-bone{background:linear-gradient(100deg,#232430 30%,#2c2d3a 50%,#232430 70%);background-size:200% 100%}';
// S2 of the audit: the skeleton wears the panel's own theme (config.home.theme), not the system's, so a dark system does not flash a dark
// screen before a light panel. The loader runs before the config arrives, so the panel leaves its theme here for the next load.
export const THEME_KEY = 'atom-home-theme';
/** @returns {'light' | 'dark'} */
export function readSkeletonTheme() { try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } }
/** @type {string | undefined} */
let remembered;
/** @param {'light' | 'dark'} theme */
export function rememberSkeletonTheme(theme) { if (theme === remembered) return; remembered = theme; try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode: the next skeleton is light, a convenience only */ } }
/** @param {string} [text] @param {'light' | 'dark'} [theme] */
export const skeletonHtml = (text = 'Подключаемся к дому…', theme = 'light') => '<div class="hm-skeleton' + (theme === 'dark' ? ' is-dark' : '') + '" role="status" aria-busy="true" aria-live="polite"><div class="hm-skeleton-head is-bone"></div><div class="hm-skeleton-grid">' + '<div class="hm-skeleton-tile is-bone"></div>'.repeat(8) + '</div><p>' + text + '</p></div>';
