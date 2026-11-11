// Release «classic», step 4 (logic fixes ported from design-2026 pass 3, the Codex review and the studio's proposals): the words of the
// «climate» area. New keys only; spread into ru.ts / en.ts / ro.ts after the main dictionary. en and ro are typed by ru (the same keys).
// Plural forms: "{n} zero/many|{n} one|{n} few|{n} many" (i18n/index.ts).
const ru = {
  // ST-05: the boiler is silent — the note says exactly what is known by the relay, never that the burner works
  'module.heat.b.offlineRelayUnknown': 'Нет данных от котла и реле. Работа отопления не подтверждена.',
  'module.heat.b.offlineRelayOn': 'Нет данных от котла. Реле запрашивает тепло; работа горелки не подтверждена.',
  'module.heat.b.offlineRelayOff': 'Нет данных от котла. Реле не запрашивает тепло.',
  // CODEX-002: the office's «С охраны» asks first, as the house's does
  'osec.ask.disarm': 'Снять здание с охраны?',
};
const en: typeof ru = {
  'module.heat.b.offlineRelayUnknown': 'No data from the boiler or relay. Heating operation is not confirmed.',
  'module.heat.b.offlineRelayOn': 'No data from the boiler. The relay is requesting heat; burner operation is not confirmed.',
  'module.heat.b.offlineRelayOff': 'No data from the boiler. The relay is not requesting heat.',
  'osec.ask.disarm': 'Disarm the building?',
};
const ro: typeof ru = {
  'module.heat.b.offlineRelayUnknown': 'Nu există date de la centrală sau releu. Funcționarea încălzirii nu este confirmată.',
  'module.heat.b.offlineRelayOn': 'Nu există date de la centrală. Releul solicită căldură; funcționarea arzătorului nu este confirmată.',
  'module.heat.b.offlineRelayOff': 'Nu există date de la centrală. Releul nu solicită căldură.',
  'osec.ask.disarm': 'Dezarmați clădirea?',
};
export const wordsClimate = { ru, en, ro };
