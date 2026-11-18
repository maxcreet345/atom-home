// Every language at once, for the preview and the tests (the live panel loads English and Romanian on demand: i18n/index.ts).
import { provideDictionary } from './index.ts';
import { en } from './en.ts';
import { ro } from './ro.ts';
provideDictionary('en', en);
provideDictionary('ro', ro);
