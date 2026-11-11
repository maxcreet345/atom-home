// The words of the release «classic» additions (11.11.2026): the house status strip on Home (model/house-status.ts, ui/house-status.tsx) and the
// alarm / doorbell takeover over every page and sheet (ui/shell-banner.tsx). Ported from design-2026 phase 2 (i18n/words-home.ts) with the same keys.
// Spread into ru.ts / en.ts / ro.ts; en and ro are typed by ru. Plural forms: "{n} zero/many|{n} one|{n} few|{n} many" (i18n/index.ts).
const ru = {
  // ---- the house status strip
  'status.ok': 'Всё в порядке', 'status.attention': 'Нужно внимание: {n}', 'status.label': 'Состояние дома',
  'status.alarm': 'Тревога', 'status.alarmAt': 'Тревога · {room}', 'status.entry': 'Вход: снимите охрану',
  'status.gasAt': 'Газ · {room}', 'status.gasN': 'Газ: {n} датчиков|Газ: {n} датчик|Газ: {n} датчика|Газ: {n} датчиков',
  'status.smokeAt': 'Дым · {room}', 'status.smokeN': 'Дым: {n} датчиков|Дым: {n} датчик|Дым: {n} датчика|Дым: {n} датчиков',
  'status.coAt': 'Угарный газ · {room}', 'status.coN': 'Угарный газ: {n} датчиков|Угарный газ: {n} датчик|Угарный газ: {n} датчика|Угарный газ: {n} датчиков',
  'status.leakAt': 'Протечка · {room}', 'status.leakN': 'Протечка: {n} мест|Протечка: {n} место|Протечка: {n} места|Протечка: {n} мест',
  'status.offline': 'Нет связи с домом',
  'status.armedOpen': 'Открыто при охране · {room}', 'status.armedOpenN': 'Открыто при охране: {n}',
  'status.windowAt': 'Окно открыто, батарея ждёт · {room}', 'status.windowN': 'Окна открыты, батареи ждут: {n}',
  'status.pressure': 'Давление котла ниже нормы',
  'status.heating': 'Отопление: нет связи', 'status.heatingAt': 'Отопление · {room}: нет связи',
  'status.nolink1': '{name}: нет связи', 'status.nolinkN': '{n} устройств без связи|{n} устройство без связи|{n} устройства без связи|{n} устройств без связи',
  'status.battery1': '{name}: садится батарея', 'status.batteryN': 'Садятся батареи: {n}', 'status.trv': 'Батарея отопления · {room}',
  'status.vacError': 'Пылесос: ошибка', 'status.vacCare': 'Пылесос: {what}', 'status.vacCareN': 'Пылесос: {what} и ещё {n}',
  // ---- the alarm and the doorbell take over the screen
  'take.disarm': 'Снять с охраны', 'take.show': 'Показать', 'take.closeWater': 'Перекрыть воду', 'take.since': 'с {t}',
  'take.ring': 'Кто-то у двери', 'take.video': 'Открыть видео', 'take.later': 'Позже',
};
const en: typeof ru = {
  'status.ok': 'All is well', 'status.attention': 'Needs attention: {n}', 'status.label': 'The house',
  'status.alarm': 'Alarm', 'status.alarmAt': 'Alarm · {room}', 'status.entry': 'Entry: disarm now',
  'status.gasAt': 'Gas · {room}', 'status.gasN': 'Gas: {n} sensors|Gas: {n} sensor|Gas: {n} sensors|Gas: {n} sensors',
  'status.smokeAt': 'Smoke · {room}', 'status.smokeN': 'Smoke: {n} sensors|Smoke: {n} sensor|Smoke: {n} sensors|Smoke: {n} sensors',
  'status.coAt': 'Carbon monoxide · {room}', 'status.coN': 'Carbon monoxide: {n} sensors|Carbon monoxide: {n} sensor|Carbon monoxide: {n} sensors|Carbon monoxide: {n} sensors',
  'status.leakAt': 'Water leak · {room}', 'status.leakN': 'Water leak: {n} places|Water leak: {n} place|Water leak: {n} places|Water leak: {n} places',
  'status.offline': 'No connection to the house',
  'status.armedOpen': 'Open while armed · {room}', 'status.armedOpenN': 'Open while armed: {n}',
  'status.windowAt': 'Window open, radiator waits · {room}', 'status.windowN': 'Windows open, radiators wait: {n}',
  'status.pressure': 'Boiler pressure is low',
  'status.heating': 'Heating: no connection', 'status.heatingAt': 'Heating · {room}: no connection',
  'status.nolink1': '{name}: no connection', 'status.nolinkN': '{n} devices without connection|{n} device without connection|{n} devices without connection|{n} devices without connection',
  'status.battery1': '{name}: battery low', 'status.batteryN': 'Batteries low: {n}', 'status.trv': 'Radiator head · {room}',
  'status.vacError': 'Vacuum: error', 'status.vacCare': 'Vacuum: {what}', 'status.vacCareN': 'Vacuum: {what} and {n} more',
  'take.disarm': 'Disarm', 'take.show': 'Show', 'take.closeWater': 'Shut off water', 'take.since': 'since {t}',
  'take.ring': 'Someone at the door', 'take.video': 'Open video', 'take.later': 'Later',
};
const ro: typeof ru = {
  'status.ok': 'Totul e în regulă', 'status.attention': 'Necesită atenție: {n}', 'status.label': 'Casa',
  'status.alarm': 'Alarmă', 'status.alarmAt': 'Alarmă · {room}', 'status.entry': 'Intrare: dezarmați',
  'status.gasAt': 'Gaz · {room}', 'status.gasN': 'Gaz: {n} senzori|Gaz: {n} senzor|Gaz: {n} senzori|Gaz: {n} de senzori',
  'status.smokeAt': 'Fum · {room}', 'status.smokeN': 'Fum: {n} senzori|Fum: {n} senzor|Fum: {n} senzori|Fum: {n} de senzori',
  'status.coAt': 'Monoxid de carbon · {room}', 'status.coN': 'Monoxid de carbon: {n} senzori|Monoxid de carbon: {n} senzor|Monoxid de carbon: {n} senzori|Monoxid de carbon: {n} de senzori',
  'status.leakAt': 'Scurgere · {room}', 'status.leakN': 'Scurgere: {n} locuri|Scurgere: {n} loc|Scurgere: {n} locuri|Scurgere: {n} de locuri',
  'status.offline': 'Nu există legătură cu casa',
  'status.armedOpen': 'Deschis sub pază · {room}', 'status.armedOpenN': 'Deschis sub pază: {n}',
  'status.windowAt': 'Geam deschis, caloriferul așteaptă · {room}', 'status.windowN': 'Geamuri deschise, caloriferele așteaptă: {n}',
  'status.pressure': 'Presiunea centralei e scăzută',
  'status.heating': 'Încălzire: fără legătură', 'status.heatingAt': 'Încălzire · {room}: fără legătură',
  'status.nolink1': '{name}: fără legătură', 'status.nolinkN': '{n} dispozitive fără legătură|{n} dispozitiv fără legătură|{n} dispozitive fără legătură|{n} de dispozitive fără legătură',
  'status.battery1': '{name}: bateria e pe terminate', 'status.batteryN': 'Baterii pe terminate: {n}', 'status.trv': 'Cap de calorifer · {room}',
  'status.vacError': 'Aspirator: eroare', 'status.vacCare': 'Aspirator: {what}', 'status.vacCareN': 'Aspirator: {what} și încă {n}',
  'take.disarm': 'Dezarmează', 'take.show': 'Arată', 'take.closeWater': 'Închide apa', 'take.since': 'de la {t}',
  'take.ring': 'Cineva la ușă', 'take.video': 'Deschide video', 'take.later': 'Mai târziu',
};
export const wordsStatus = { ru, en, ro };
