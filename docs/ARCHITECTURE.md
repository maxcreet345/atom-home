# Архитектура Atom Home

## Принципы
1. **Один код — много домов.** Панель не знает конкретных сущностей. Всё, что отличает дом, лежит в `HouseConfig` (JSON) и в реестре самого HA.
2. **HA — источник правды.** Комнаты из зон (areas), устройства из реестра устройств, состояния из `hass.states`. Панель только читает реестр и состояния, команды — через `callService`.
3. **Автоматическое распознавание + ручная правка.** `discover()` строит модель дома из реестра по доменам и `device_class`; `HouseConfig` накладывает правки: показать/скрыть, имя, комната, значок, объединение, порядок.
4. **Честность.** Неизвестное — «нет данных», а не ноль. Команда считается выполненной только по изменению состояния; «принято HA» и «физически сработало» — разные вещи.
5. **Безопасность.** Типовые действия по белому списку на вид устройства; произвольные сервисы только через конструктор кнопок с явным флагом подтверждения; опасные (кран, замок, сброс) — всегда с подтверждением. Никаких токенов в панели: используется сессия HA.

## Слои
```
frontend/src
  model/      registry.ts   типы реестра HA (areas, devices, entities, states)
              kinds.ts      виды устройств (light, climate, sensor…) и правила распознавания
              discover.ts   реестр + состояния + HouseConfig → Home (комнаты, устройства, метрики, действия)
              config.ts     схема HouseConfig v1, валидация, значения по умолчанию, слияние
  runtime/    host.ts       мост к hass: состояния, реестр по WS, callService, история/статистика
              actions.ts    белый список действий по виду + кнопки-сервисы, подтверждения, наблюдение результата
  i18n/       ru.ts ro.ts en.ts  словари интерфейса; t(key, params), склонение чисел
  ui/         экраны и карточки (дизайн-система V18): Обзор, Комнаты, Свет, Климат, Уборка, Энергия, Системы, Камера, Погода, Конфигуратор
  styles/     base.css (сброс и оболочка), motion.css, theme-light.css, theme-dark.css
preview/      изолированный запуск на снимке реестра и состояний (без HA, команды отклоняются)
custom_components/atom_home   интеграция HA (этап 3): панель в боковом меню, хранение HouseConfig и фото, сервисы
```

## Модель устройства (`Home`)
- `Room {id, name, photo?, hidden}` — из `area_registry`; устройства без зоны попадают в комнату `none` («Без комнаты»).
- `Device {key, kind, name, roomId, primary: EntityRef, entities: EntityRef[], metrics, parameters, diagnostics, actions, available, enabled}` — один прибор HA (по `device_id`) или одиночная сущность без устройства. `kind` определяется по главной сущности (приоритет: climate → light → vacuum → media → camera → cover → lock → fan → switch → sensor…). Датчики температуры/влажности/CO₂ одного прибора объединяются в одно устройство вида `environment`; мощность/энергия/напряжение — `energy`.
- Служебные сущности (категории `diagnostic`/`config`, домены update, automation, input_*, zone, sun, tts, stt, conversation, event, todo, calendar, notify) не становятся карточками: `config` → параметры устройства, `diagnostic` → диагностика.
- Объединение розетки с прибором — через `HouseConfig.devices[key].mergeInto`.

## HouseConfig v1 (JSON)
```
{ schemaVersion: 1,
  home: { name, logo?, language: 'ru'|'ro'|'en', theme: 'light'|'dark' },
  rooms: { [areaId]: { name?, photo?, hidden?, order? } },
  devices: { [deviceKey]: { enabled, name?, roomId?, icon?, kind?, mergeInto?, order? } },
  entities: { [entityId]: { hidden?, name? } },
  buttons: [ { id, label, icon?, roomId?, service: 'domain.service', target?, data?, confirm } ],
  sections: { [screen]: { hidden? } } }
```
Без конфигурации панель показывает все бытовые устройства во всех зонах — это и есть «первая установка», после которой владелец убирает лишнее.

## Сравнение с панелями Criuleni/Traian
Что переиспользуется: дизайн-система V18 и движение (home14–home18), принципы команд и подтверждений, изолированный QA на снимке, публикация с хешами и откатом. Что не переносится: каталог привязок `source-NNNN`, контроллер отопления и котёл Criuleni, go2rtc-поток, скрипты публикации конкретных домов — они остаются модулями или отдельными проектами.
