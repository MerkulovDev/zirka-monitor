# 🧪 Паралельний запуск PROD і TEST версій

## 📋 Структура проєкту

```
zirka-monitor/
├── monitor.js              # 🟢 ПРОД версія (стабільна)
├── monitor-test.js         # 🧪 ТЕСТ версія (з закріпленням повідомлень)
│
├── data/
│   ├── last_known_schedule.json      # Стан для ПРОДА
│   └── last_known_schedule_test.json # Стан для ТЕСТУ
│
├── src/
│   ├── config.js           # Спільний (підтримує TEST_MODE)
│   ├── scraper.js          # Спільний
│   ├── schedule.js         # Спільний
│   ├── state.js            # Спільний
│   ├── telegram.js         # 🟢 Для ПРОДА (стара логіка)
│   └── telegram-pinned.js  # 🧪 Для ТЕСТУ (з закріпленням)
│
└── .github/workflows/
    ├── monitor.yml         # 🟢 ПРОД: кожні 30 хв
    └── monitor-test.yml    # 🧪 ТЕСТ: кожні 15 хв
```

## ⚙️ GitHub Secrets

### ПРОД версія використовує:
- `TELEGRAM_BOT_TOKEN` - основний бот
- `TELEGRAM_CHAT_ID` - основний чат/канал
- `ADDRESS_CITY`, `ADDRESS_STREET`, `ADDRESS_HOUSE` - адреса

### ТЕСТ версія використовує:
- `TELEGRAM_BOT_TOKEN_TEST` - тестовий бот
- `TELEGRAM_CHAT_ID_TEST` - тестовий чат/канал
- `ADDRESS_CITY`, `ADDRESS_STREET`, `ADDRESS_HOUSE` - та сама адреса

## 🚀 Workflow

### ПРОД (monitor.yml)
- Запускається: кожні 30 хв
- Файл: `monitor.js`
- Використовує: `src/telegram.js`
- Стан: `data/last_known_schedule.json`
- Логіка: старі планові нагадування (8:00, 21:00)

### ТЕСТ (monitor-test.yml)
- Запускається: кожні 15 хв
- Файл: `monitor-test.js`
- Використовує: `src/telegram-pinned.js`
- Стан: `data/last_known_schedule_test.json`
- Логіка: тільки зміни графіку + закріплення повідомлень

## 🔄 Як мігрувати ТЕСТ → ПРОД

Коли тестування успішне:

```bash
# 1. Замінюємо основні файли тестовими
cp monitor-test.js monitor.js
cp src/telegram-pinned.js src/telegram.js

# 2. Видаляємо TEST_MODE з monitor.js (рядок 2)
# Змінюємо: process.env.TEST_MODE = 'true';
# На: // process.env.TEST_MODE = 'true';

# 3. Змінюємо імпорт в monitor.js
# З: const { sendTelegramMessage } = require('./src/telegram-pinned');
# На: const { sendTelegramMessage } = require('./src/telegram');

# 4. Комітимо
git add monitor.js src/telegram.js
git commit -m "✅ Міграція: закріплення повідомлень в ПРОД"
git push
```

## 🧪 Локальне тестування

```bash
# ТЕСТ версія
export TELEGRAM_BOT_TOKEN="токен_тестового_бота"
export TELEGRAM_CHAT_ID="тестовий_chat_id"
export ADDRESS_CITY="м. Вишгород"
export ADDRESS_STREET="вул. Шолуденка"
export ADDRESS_HOUSE="18А"
node monitor-test.js

# ПРОД версія
export TELEGRAM_BOT_TOKEN="токен_прод_бота"
export TELEGRAM_CHAT_ID="прод_chat_id"
export ADDRESS_CITY="м. Вишгород"
export ADDRESS_STREET="вул. Шолуденка"
export ADDRESS_HOUSE="18А"
node monitor.js
```

## 🎯 Переваги цієї архітектури

✅ **Ізоляція**: ПРОД і ТЕСТ працюють незалежно  
✅ **Безпека**: ПРОД залишається стабільним під час тестування  
✅ **Зручність**: Легко мігрувати зміни з ТЕСТ в ПРОД  
✅ **Спільний код**: Scraper, schedule, state не дублюються  
✅ **Паралельність**: Обидві версії працюють одночасно  

## 📊 Моніторинг

- ПРОД логи: GitHub Actions → "Power Outage Monitor"
- ТЕСТ логи: GitHub Actions → "Monitor TEST (Pinned Messages)"

## 🔧 Налаштування нового тестового бота

1. Створіть бота через [@BotFather](https://t.me/BotFather)
2. Отримайте токен
3. Створіть тестовий канал/чат
4. Додайте бота в канал
5. Отримайте chat_id через `https://api.telegram.org/botТОКЕН/getUpdates`
6. Додайте в GitHub Secrets:
   - `TELEGRAM_BOT_TOKEN_TEST`
   - `TELEGRAM_CHAT_ID_TEST`

