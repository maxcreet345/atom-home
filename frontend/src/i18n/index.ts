import { ru, type Dictionary } from './ru.ts';
import type { Language } from '../model/config.ts';
export type Key = keyof Dictionary;
/** H-6 of the audit of 17.11.2026: Russian is in the bundle; English and Romanian are separate files the panel loads when the house speaks
 *  them (about 200 KB of the 1.38 MB bundle). Until one has arrived, its words fall back to Russian, key by key, as a missing word always did. */
const dictionaries: Partial<Record<Language, Dictionary>> = { ru };
const loading = new Map<Language, Promise<void>>();
/** For the preview and the tests, which have every language at hand. */
export function provideDictionary(lang: Language, dict: Dictionary) { dictionaries[lang] = dict; }
export const hasDictionary = (lang: Language): boolean => !!dictionaries[lang];
/** Where the live panel finds a language: a self-contained file beside the bundle (vite.lang.config.ts), under the static path the integration
 *  has always served, so it is there even before Home Assistant is restarted after an update. The version names the build. */
declare const __ATOM_VERSION__: string | undefined;
const langUrl = (lang: Language) => `/atom_home_static/chunks/lang-${lang}.js?v=${encodeURIComponent(typeof __ATOM_VERSION__ === 'string' ? __ATOM_VERSION__ : 'dev')}`;
export function loadDictionary(lang: Language): Promise<void> {
  if (dictionaries[lang]) return Promise.resolve();
  let p = loading.get(lang);
  if (!p) {
    const load: Promise<Dictionary> = lang === 'ru' ? Promise.resolve(ru) : import(/* @vite-ignore */ langUrl(lang)).then((m: Record<string, Dictionary>) => { const d = m[lang]; if (!d || typeof d !== 'object') throw new Error(`no ${lang} words`); return d; });
    p = load.then(d => { dictionaries[lang] = d; }, e => { loading.delete(lang); throw e; });
    loading.set(lang, p);
  }
  return p;
}
/** Plural forms: "{n} a|{n} b|{n} c|{n} d" = zero/many | one | few | many (Russian rules; English and Romanian use one/other).
 *  Shorter keys are understood too, never silently cut to their first form: "one|other" and "one|few|many". */
export function plural(lang: Language, n: number, forms: string[]): string {
  const a = Math.abs(n) % 100, b = a % 10, whole = Number.isInteger(n);
  // which of one / few / many the number takes in this language
  const kind: 'one' | 'few' | 'many' = !whole ? (lang === 'en' ? 'many' : 'few')
    : lang === 'ru' ? ((a > 10 && a < 20) ? 'many' : b === 1 ? 'one' : (b >= 2 && b <= 4) ? 'few' : 'many')
    : lang === 'ro' ? (Math.abs(n) === 1 ? 'one' : (n === 0 || (a >= 1 && a <= 19)) ? 'few' : 'many')
    : Math.abs(n) === 1 ? 'one' : 'many';
  if (forms.length >= 4) return forms[kind === 'one' ? 1 : kind === 'few' ? 2 : 3];
  if (forms.length === 3) return forms[kind === 'one' ? 0 : kind === 'few' ? 1 : 2];
  if (forms.length === 2) return forms[kind === 'one' ? 0 : 1];
  return forms[0];
}
/** `n` as a number: a number, or a string that is one («3», «2.5»). */
const count = (v: unknown): number | null => typeof v === 'number' ? (Number.isFinite(v) ? v : null) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
export function translator(lang: Language) {
  return (key: Key, params: Record<string, string | number> = {}): string => {
    const dict = dictionaries[lang] ?? ru; // read at every call: a translator made before its language arrived speaks it from then on
    let text: string = dict[key] ?? ru[key] ?? key;
    const n = text.includes('|') ? count(params.n) : null;
    if (n !== null) text = plural(lang, n, text.split('|'));
    return text.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
  };
}
export type T = ReturnType<typeof translator>;
export const languages: Language[] = ['ru', 'ro', 'en'];
