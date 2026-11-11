// Release «classic», step 4 (logic fixes ported from design-2026 pass 3, the Codex review and the studio's proposals): the words of the
// «setup» area. New keys only; spread into ru.ts / en.ts / ro.ts after the main dictionary. en and ro are typed by ru (the same keys).
// Plural forms: "{n} zero/many|{n} one|{n} few|{n} many" (i18n/index.ts).
const ru = {
  // CODEX-001: a custom button whose action the house always asks about — its «Спрашивать подтверждение» is on and held, and says why
  'setup.alwaysAsks': 'Это действие всегда спрашивает',
};
const en: typeof ru = {
  'setup.alwaysAsks': 'This action always asks',
};
const ro: typeof ru = {
  'setup.alwaysAsks': 'Această acțiune cere mereu confirmare',
};
export const wordsSetup = { ru, en, ro };
