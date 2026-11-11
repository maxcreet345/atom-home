import { ru, type Dictionary } from './ru.ts';
import { en } from './en.ts';
import { ro } from './ro.ts';
import type { Language } from '../model/config.ts';
export type Key = keyof Dictionary;
const dictionaries: Record<Language, Dictionary> = { ru, en, ro };
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
  const dict = dictionaries[lang] ?? ru;
  return (key: Key, params: Record<string, string | number> = {}): string => {
    let text: string = dict[key] ?? ru[key] ?? key;
    const n = text.includes('|') ? count(params.n) : null;
    if (n !== null) text = plural(lang, n, text.split('|'));
    return text.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
  };
}
export type T = ReturnType<typeof translator>;
export const languages: Language[] = ['ru', 'ro', 'en'];
