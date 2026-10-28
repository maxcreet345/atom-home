# Этап 3 — HACS и установка (28.10.2026)

## Сделано
- Публичный репозиторий `https://github.com/maxcreet345/atom-home` (аккаунт владельца maxcreet345, вход через GitHub CLI по коду устройства; приватные снимки и сборки превью в репозиторий не попадают).
- Интеграция `custom_components/atom_home/` (Python, без внешних зависимостей): регистрирует боковую панель `atom-home-panel` (статика `/atom_home_static/atom-home.js?v=<версия>`), WebSocket-команды `atom_home/config/get` (любой вошедший) и `atom_home/config/set` (только администратор, до 512 КБ, `schemaVersion: 1`), хранит конфигурацию в `.storage/atom_home.config`; config flow в одну копию; переводы en/ru/ro; `hacs.json`.
- Живой элемент `frontend/src/live-main.tsx`: принимает `hass`, читает реестры по WS (обновление раз в 5 минут), конфигурацию через интеграцию (`runtime/ha-store.ts`), команды через `callService`, следит за размером. Сборка `npm run build` кладёт `atom-home.js` в папку интеграции (коммитится, HACS ставит из репозитория).
- QA живого элемента на фейковом hass (`frontend/scripts/qa-live.mjs`): 11/11 — реестр по WS, смена состояния перерисовывает без повторного чтения реестра, сохранение по WS, одна команда на нажатие с сообщением об отказе, у не-администратора нет «Настройки». Python: `py_compile`.
- `docs/INSTALL.md` — установка, обновление, откат, экспорт конфигурации.
