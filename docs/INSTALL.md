# Установка Atom Home через HACS

1. HACS → ⋮ → **Custom repositories** → добавить `https://github.com/maxcreet345/atom-home`, тип **Integration**.
2. Найти «Atom Home» в HACS, нажать **Download**, затем **перезапустить Home Assistant**.
3. Настройки → Устройства и службы → **Добавить интеграцию** → «Atom Home» (одна копия на дом).
4. В боковом меню появится **Atom Home**. Администратор открывает в панели «Настройка» и выбирает, что показывать; конфигурация хранится в `.storage/atom_home.config` этого HA.

Что ставится: `custom_components/atom_home/` — интеграция (панель в боковом меню, WebSocket API `atom_home/config/get|set` и `atom_home/photo/set|delete`, хранилище конфигурации в `.storage`, фото владельца в `<config>/atom_home/photos/`) и собранный фронтенд `frontend/atom-home.js` с типовыми иллюстрациями. Внешних зависимостей нет, токены не хранятся: панель работает в сессии вошедшего пользователя HA.

Обновление: HACS → Atom Home → Update → перезапуск HA. Откат: HACS → Atom Home → Redownload → выбрать прежнюю версию. Конфигурация дома при обновлении и откате сохраняется.

Экспорт конфигурации для сервисного центра: «Настройка» → «Дом» → «Экспорт JSON» → сохранить в `clients/<дом>/atom-home-config-<дата>.json`.
