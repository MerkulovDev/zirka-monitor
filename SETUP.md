# 📦 Інструкція з налаштування

## Крок 1: Push на GitHub

Запустіть в терміналі з директорії проекту:

```bash
git push -u origin main
```

Якщо виникнуть проблеми з автентифікацією, використайте Personal Access Token:

```bash
# Встановіть GitHub CLI (якщо не встановлено)
# brew install gh

# Авторизуйтесь
gh auth login

# Push
git push -u origin main
```

Або використайте SSH:

```bash
# Змініть remote на SSH
git remote set-url origin git@github.com:MerkulovDev/zirka-monitor.git

# Push
git push -u origin main
```

## Крок 2: Налаштування GitHub Secrets

1. Перейдіть на GitHub: https://github.com/MerkulovDev/zirka-monitor
2. Натисніть `Settings` → `Secrets and variables` → `Actions`
3. Натисніть `New repository secret`
4. Додайте два секрети:

### TELEGRAM_BOT_TOKEN

**Як отримати:**
1. Відкрийте [@BotFather](https://t.me/BotFather) в Telegram
2. Відправте `/newbot`
3. Слідуйте інструкціям
4. Скопіюйте токен (формат: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

### TELEGRAM_CHAT_ID

**Для особистого чату:**
1. Відправте боту `/start`
2. Відкрийте: `https://api.telegram.org/botВАШ_ТОКЕН/getUpdates`
3. Знайдіть `"chat":{"id":123456789}`
4. Скопіюйте ID

**Для каналу:**
1. Створіть канал або використайте існуючий
2. Додайте бота як адміністратора
3. Публічний канал: використайте формат `@ім'я_каналу`
4. Приватний канал: використайте негативний ID з API

## Крок 3: Тестове виконання

1. Перейдіть до вкладки `Actions`
2. Виберіть workflow `DTEK Power Outage Monitor`
3. Натисніть `Run workflow`
4. Виберіть `main` гілку
5. Натисніть `Run workflow`

## Крок 4: Перевірка роботи

- Workflow запускатиметься кожну годину автоматично
- Очікуйте сповіщення в Telegram при першому запуску
- Перегляньте логи в `Actions` для налагодження

## 🔧 Локальний запуск (опційно)

Для тестування на локальній машині:

```bash
# Встановіть залежності
npm install

# Встановіть змінні середовища
export TELEGRAM_BOT_TOKEN="ваш_токен"
export TELEGRAM_CHAT_ID="ваш_chat_id"

# Запустіть моніторинг
npm start
```

## ❓ Вирішення проблем

### Workflow не запускається автоматично
- Перевірте, що файл `.github/workflows/dtek-monitor.yml` є в основній гілці
- Перевірте, що cron вираз коректний: `0 * * * *`

### Не приходить сповіщення
- Перевірте правильність `TELEGRAM_BOT_TOKEN` в Secrets
- Перевірте правильність `TELEGRAM_CHAT_ID` в Secrets
- Переконайтесь, що бот додано в канал/чат
- Перегляньте логи в GitHub Actions для деталей помилки

### Incapsula блокує доступ
- Логіка обходу вже включена в `monitor.js`
- Може знадобитися додаткове очікування залежно від навантаження сайту
- Перегляньте логи для деталей

## 📊 Редагування налаштувань

### Зміна частоти моніторингу

Відредагуйте `.github/workflows/dtek-monitor.yml`:

```yaml
schedule:
  - cron: '0 * * * *'      # Кожну годину
  # - cron: '*/30 * * * *'  # Кожні 30 хвилин
  # - cron: '0 */2 * * *'   # Кожні 2 години
  # - cron: '0 9,18 * * *'  # О 9:00 та 18:00
```

### Зміна адреси моніторингу

Відредагуйте `monitor.js`:

```javascript
const CONFIG = {
  ADDRESS: 'м. Вишгород, вул. Шолуденка, 18А', // Змініть тут
};
```

## 🎉 Готово!

Після налаштування моніторинг працюватиме автоматично кожну годину.

