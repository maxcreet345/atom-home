import { ru, type Dictionary } from './ru.ts';
import { en } from './en.ts';
import { ro } from './ro.ts';
import type { Language } from '../model/config.ts';
export type Key = keyof Dictionary;
const dictionaries: Record<Language, Dictionary> = { ru, en, ro };
/** Plural forms: "{n} a|{n} b|{n} c|{n} d" = zero/many | one | few | many (Russian rules; English and Romanian use one/other). */
function plural(lang: Language, n: number, forms: string[]): string {
  if (forms.length < 4) return forms[0];
  const a = Math.abs(n) % 100, b = a % 10;
  if (lang === 'ru') return (a > 10 && a < 20) ? forms[3] : b === 1 ? forms[1] : (b >= 2 && b <= 4) ? forms[2] : forms[3];
  if (lang === 'ro') return n === 1 ? forms[1] : (n === 0 || (a >= 1 && a <= 19)) ? forms[2] : forms[3];
  return n === 1 ? forms[1] : forms[3];
}
export function translator(lang: Language) {
  const dict = dictionaries[lang] ?? ru;
  return (key: Key, params: Record<string, string | number> = {}): string => {
    let text: string = dict[key] ?? ru[key] ?? key;
    if (text.includes('|') && typeof params.n === 'number') text = plural(lang, params.n, text.split('|'));
    return text.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
  };
}
export type T = ReturnType<typeof translator>;
export const languages: Language[] = ['ru', 'ro', 'en'];
