// The helpers of Home Assistant the panel works through (runtime/helpers-setup.ts): the administrator's bar «не хватает помощников» and
// the clock's «Включить таймеры» (26.11.2026). ru = ro = en by keys; plural forms are zero/many | one | few | many.
const ru = {
  'helpers.title': 'Панели не хватает помощников Home Assistant',
  'helpers.sub': 'Без них не работают: {what}. Создам их сам: {n} шт.|Без них не работают: {what}. Создам его сам: {n} шт.|Без них не работают: {what}. Создам их сам: {n} шт.|Без них не работают: {what}. Создам их сам: {n} шт.',
  'helpers.what.timers': 'таймеры в «Время»',
  'helpers.what.alarm': 'баннер будильника',
  'helpers.what.sleep': '«Выключить через» у света',
  'helpers.create': 'Создать',
  'helpers.later': 'Позже',
  'helpers.done': 'Помощники созданы',
  'helpers.partly': 'Создано {ok} из {n}. Остальные: {why}',
  'helpers.busy': 'Помощников уже создают на другом экране',
  'helpers.failed': 'Не удалось создать помощников: {why}',
  'helpers.timersOff': 'Таймерам нужны помощники Home Assistant',
  'helpers.timersOn': 'Включить таймеры',
  'helpers.timersAdmin': 'Таймеры включит администратор дома',
};
type K = keyof typeof ru;
const en: Record<K, string> = {
  'helpers.title': 'The panel is missing Home Assistant helpers',
  'helpers.sub': 'Without them these do not work: {what}. I will create them: {n}.|Without it this does not work: {what}. I will create it: {n}.|Without them these do not work: {what}. I will create them: {n}.|Without them these do not work: {what}. I will create them: {n}.',
  'helpers.what.timers': 'timers in «Time»',
  'helpers.what.alarm': 'the alarm banner',
  'helpers.what.sleep': '«Turn off in» for lights',
  'helpers.create': 'Create',
  'helpers.later': 'Later',
  'helpers.done': 'Helpers created',
  'helpers.partly': 'Created {ok} of {n}. The rest: {why}',
  'helpers.busy': 'Another screen is creating the helpers',
  'helpers.failed': 'The helpers could not be created: {why}',
  'helpers.timersOff': 'Timers need Home Assistant helpers',
  'helpers.timersOn': 'Turn timers on',
  'helpers.timersAdmin': 'The home administrator will turn timers on',
};
const ro: Record<K, string> = {
  'helpers.title': 'Panoului îi lipsesc ajutoare Home Assistant',
  'helpers.sub': 'Fără ele nu funcționează: {what}. Le creez eu: {n}.|Fără el nu funcționează: {what}. Îl creez eu: {n}.|Fără ele nu funcționează: {what}. Le creez eu: {n}.|Fără ele nu funcționează: {what}. Le creez eu: {n}.',
  'helpers.what.timers': 'temporizatoarele din «Ora»',
  'helpers.what.alarm': 'bannerul alarmei',
  'helpers.what.sleep': '«Stinge peste» la lumini',
  'helpers.create': 'Creează',
  'helpers.later': 'Mai târziu',
  'helpers.done': 'Ajutoarele au fost create',
  'helpers.partly': 'Create {ok} din {n}. Restul: {why}',
  'helpers.busy': 'Ajutoarele se creează pe alt ecran',
  'helpers.failed': 'Ajutoarele nu au putut fi create: {why}',
  'helpers.timersOff': 'Temporizatoarele au nevoie de ajutoare Home Assistant',
  'helpers.timersOn': 'Pornește temporizatoarele',
  'helpers.timersAdmin': 'Temporizatoarele le pornește administratorul casei',
};
export const wordsHelpers = { ru, en, ro };
