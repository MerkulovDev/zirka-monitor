const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');
const browser = require('./browser');
const parser = require('./parser');
const api = require('./api');

// Конфігурація
const CONFIG = {
  URL: 'https://www.dtek-krem.com.ua/ua/shutdowns',
  CITY: 'м. Вишгород',
  STREET: 'вул. Кургузова',
  HOUSE: '1А',
  get ADDRESS() { return `${this.CITY}, ${this.STREET}, ${this.HOUSE}`; },
  DATA_FILE: path.join(__dirname, 'data', 'last_known_schedule.json'),
  CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
};

// Telegram бот
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const bot = botToken ? new TelegramBot(botToken) : null;

if (!botToken) {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN не встановлено');
}

/**
 * Зберегти розклад
 */
async function saveSchedule(tablesHtml) {
  const dataDir = path.dirname(CONFIG.DATA_FILE);
  await fs.ensureDir(dataDir);
  
  const data = {
    timestamp: new Date().toISOString(),
    tables: tablesHtml,
    address: CONFIG.ADDRESS,
  };
  
  await fs.writeJson(CONFIG.DATA_FILE, data, { spaces: 2 });
  console.log('✓ Розклад збережено');
}

/**
 * Завантажити останній розклад
 */
async function loadLastSchedule() {
  try {
    const data = await fs.readJson(CONFIG.DATA_FILE);
    return data.tables || null;
  } catch (error) {
    console.log('Початковий запуск');
    return null;
  }
}

/**
 * Порівняти розклади
 */
function compareSchedules(oldTables, newTables) {
  if (!oldTables) {
    return { changed: true, isFirstRun: true };
  }
  
  // Порівнюємо HTML контент
  const normalize = (html) => html ? html.replace(/\s+/g, ' ').trim().toLowerCase() : '';
  const oldNormalized = normalize(oldTables);
  const newNormalized = normalize(newTables);
  
  const changed = oldNormalized !== newNormalized;
  
  if (changed) {
    console.log('🔍 Виявлено зміни в таблицях');
  }
  
  return { changed, isFirstRun: false };
}

/**
 * Відправити Telegram сповіщення
 */
async function sendTelegramNotification(message, quiet = false) {
  if (!bot || !CONFIG.CHAT_ID) {
    console.log('⚠️ Telegram не налаштовано');
    return;
  }
  
  try {
    const options = {
      parse_mode: 'HTML',
      disable_notification: quiet,
    };
    
    // Telegram має обмеження на довжину повідомлення (4096 символів)
    // Якщо повідомлення занадто довге, розбиваємо на частини
    const maxLength = 4000;
    if (message.length > maxLength) {
      // Розбиваємо на частини по ~4000 символів
      const parts = [];
      let current = '';
      
      message.split('\n').forEach(line => {
        if ((current + line + '\n').length > maxLength && current) {
          parts.push(current);
          current = line + '\n';
        } else {
          current += line + '\n';
        }
      });
      
      if (current) {
        parts.push(current);
      }
      
      for (let i = 0; i < parts.length; i++) {
        const partMessage = `<b>Частина ${i + 1} з ${parts.length}</b>\n\n${parts[i]}`;
        await bot.sendMessage(CONFIG.CHAT_ID, partMessage, options);
        await new Promise(resolve => setTimeout(resolve, 500)); // Невелика затримка між повідомленнями
      }
    } else {
      await bot.sendMessage(CONFIG.CHAT_ID, message, options);
    }
    
    console.log(quiet ? '🔇 Тихий режим' : '🔊 Гучний режим');
    console.log('✓ Відправлено в Telegram');
  } catch (error) {
    console.error('Помилка Telegram:', error.message);
  }
}

/**
 * Форматувати повідомлення
 */
function formatNotificationMessage(tables, address) {
  const formattedTables = parser.formatTablesForTelegram(tables);
  
  if (!formattedTables) {
    return `⚠️ <b>Графік оновлено!</b>\n\n📍 <b>Адреса:</b> ${address}\n\nДані відсутні`;
  }
  
  return `⚠️ <b>Графік оновлено!</b>\n\n📍 <b>Адреса:</b> ${address}\n\n${formattedTables}`;
}

/**
 * Чи потрібен моніторинг
 */
function shouldRunMonitor() {
  const hour = new Date().getHours();
  return !(hour >= 0 && hour < 6);
}

/**
 * Тихий режим
 */
function isQuietHours() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const isWeekend = day === 0 || day === 6;
  
  if (isWeekend) return hour < 10;
  return (hour >= 6 && hour < 8) || hour >= 22;
}

/**
 * Головна функція - парсинг сторінки
 */
async function runMonitorPage() {
  console.log('\n===== Запуск моніторингу (Парсинг сторінки) =====');
  console.log(`Адреса: ${CONFIG.ADDRESS}`);
  
  if (!shouldRunMonitor()) {
    console.log('⏰ Нічний режим');
    return;
  }
  
  let browserInstance = null;
  
  try {
    const oldTables = await loadLastSchedule();
    
    // Запускаємо браузер
    browserInstance = await browser.launchBrowser();
    const page = await browser.createPage(browserInstance);
    
    // Завантажуємо сторінку
    await browser.loadPage(page, CONFIG.URL);
    
    // Заповнюємо форму адреси
    const formFilled = await browser.fillAddressForm(page, CONFIG.CITY, CONFIG.STREET, CONFIG.HOUSE);
    
    if (!formFilled) {
      console.log('❌ Не вдалося заповнити форму');
      return;
    }
    
    // Чекаємо трохи, щоб таблиці встигли завантажитися після заповнення форми
    console.log('⏳ Очікування завантаження таблиць...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Парсимо таблиці зі сторінки
    const tables = await parser.parsePageTables(page);
    
    if (!tables || (!tables.factInfo && !tables.factTables && !tables.scheduleTable)) {
      console.log('❌ Таблиці не знайдено');
      return;
    }
    
    // Формуємо HTML для збереження
    const tablesHtml = parser.formatTablesForTelegram(tables);
    
    console.log('\n📋 Отримано таблиці:');
    console.log(`  Розмір контенту: ${tablesHtml ? tablesHtml.length : 0} символів`);
    
    await browserInstance.close();
    browserInstance = null;
    
    // Порівнюємо з попереднім розкладом
    const comparison = compareSchedules(oldTables, tablesHtml);
    
    if (comparison.changed) {
      await saveSchedule(tablesHtml);
      
      const message = formatNotificationMessage(tables, CONFIG.ADDRESS);
      const quiet = isQuietHours();
      await sendTelegramNotification(message, quiet);
    } else {
      console.log('✓ Змін не виявлено');
    }
    
  } catch (error) {
    console.error('❌ Помилка моніторингу:', error.message);
    console.error(error.stack);
  } finally {
    if (browserInstance) {
      await browserInstance.close();
    }
    console.log('\n===== Моніторинг завершено =====');
  }
}

/**
 * Головна функція - API варіант
 */
async function runMonitorAPI() {
  console.log('\n===== Запуск моніторингу (API) =====');
  console.log(`Адреса: ${CONFIG.ADDRESS}`);
  
  if (!shouldRunMonitor()) {
    console.log('⏰ Нічний режим');
    return;
  }
  
  let browserInstance = null;
  
  try {
    const oldTables = await loadLastSchedule();
    
    // Запускаємо браузер
    browserInstance = await browser.launchBrowser();
    const page = await browser.createPage(browserInstance);
    
    // Завантажуємо сторінку
    await browser.loadPage(page, CONFIG.URL);
    
    // Отримуємо cookies та headers
    const { cookies, headers } = await browser.getCookiesAndHeaders(page);
    
    // AJAX запит для отримання групи та розкладу
    const apiData = await api.getGroupViaAPI(page, cookies, headers, CONFIG.CITY, CONFIG.STREET, CONFIG.HOUSE);
    
    if (!apiData || !apiData.result || !apiData.data) {
      console.log('❌ Дані з API не отримано');
      return;
    }
    
    const houseData = apiData.data[CONFIG.HOUSE] || apiData.data[CONFIG.HOUSE.replace('А', '')];
    if (!houseData || !houseData.sub_type_reason || houseData.sub_type_reason.length === 0) {
      console.log('✗ Дані для будинку не знайдено');
      return;
    }
    
    let group = houseData.sub_type_reason[0];
    if (group.startsWith('GPV')) {
      group = `Черга ${group.replace('GPV', '')}`;
    }
    console.log(`✓ Група визначена: ${group}`);
    
    // Отримуємо розклад з fact.data
    if (!apiData.fact || !apiData.fact.data) {
      console.log('✗ Розклад не знайдено в API відповіді');
      return;
    }
    
    console.log('✓ Розклад отримано з API');
    console.log(`  Доступно дат: ${Object.keys(apiData.fact.data).length}`);
    
    await browserInstance.close();
    browserInstance = null;
    
    // Тут можна обробити apiData.fact.data для отримання розкладу
    // Поки що просто зберігаємо що отримали
    const apiDataStr = JSON.stringify(apiData, null, 2);
    const comparison = compareSchedules(oldTables, apiDataStr);
    
    if (comparison.changed) {
      await saveSchedule(apiDataStr);
      console.log('✓ Дані збережено');
      // Тут можна відправити повідомлення в Telegram з API даними
    } else {
      console.log('✓ Змін не виявлено');
    }
    
  } catch (error) {
    console.error('❌ Помилка моніторингу:', error.message);
    console.error(error.stack);
  } finally {
    if (browserInstance) {
      await browserInstance.close();
    }
    console.log('\n===== Моніторинг завершено =====');
  }
}

// Визначаємо який варіант запустити з параметрів командного рядка
const mode = process.argv[2] || 'page';

if (mode === 'api') {
  runMonitorAPI();
} else {
  runMonitorPage();
}
