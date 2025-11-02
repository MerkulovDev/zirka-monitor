const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');

// Конфігурація
const CONFIG = {
  URL: 'https://www.dtek-krem.com.ua/ua/shutdowns',
  ADDRESS: 'м. Вишгород, вул. Шолуденка, 18А',
  DATA_FILE: path.join(__dirname, 'data', 'last_known_schedule.json'),
  CHAT_ID: process.env.TELEGRAM_CHAT_ID || '', // ID чату або каналу
};

// Telegram бот (ініціалізуємо тільки якщо є токен)
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const bot = botToken ? new TelegramBot(botToken) : null;

// Перевірка конфігурації
if (!botToken) {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN не встановлено, сповіщення відправлятись не будуть');
}

/**
 * Зачекати поки Incapsula завантажиться
 */
async function waitForIncapsula(page) {
  try {
    // Чекаємо на появу основного контенту
    await page.waitForSelector('.shutdowns-content, .schedule-table, [class*="schedule"]', {
      timeout: 30000,
    });
    
    // Додаткова затримка для повного рендерингу
    await page.waitForTimeout(2000);
    
    console.log('✓ Сторінка завантажилась');
  } catch (error) {
    console.error('⚠ Не вдалося дочекатись контенту');
  }
}

/**
 * Знайти розклад відключень для адреси
 */
async function findShutdownSchedule(page) {
  try {
    console.log('Пошук розкладу для адреси...');
    
    // Спробуємо знайти текст з адресою або 18А
    const houseNumber = '18А';
    
    // Отримуємо весь текст сторінки
    const pageContent = await page.evaluate(() => {
      return document.body.innerText;
    });
    
    // Шукаємо ключові слова навколо номера будинку
    const lines = pageContent.split('\n');
    let scheduleFound = false;
    let scheduleText = '';
    let foundIndex = -1;
    
    // Шукаємо рядок з номером будинку
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(houseNumber) || lines[i].includes('18') || lines[i].includes('Шолуденка')) {
        foundIndex = i;
        
        // Збираємо контекст навколо знайденої адреси
        const startIdx = Math.max(0, i - 2);
        const endIdx = Math.min(lines.length, i + 10);
        
        for (let j = startIdx; j <= endIdx; j++) {
          scheduleText += lines[j].trim() + '\n';
        }
        
        scheduleFound = true;
        break;
      }
    }
    
    if (!scheduleFound) {
      // Спробуємо через селектор таблиці
      const tableData = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table'));
        return tables.map(table => table.innerText);
      });
      
      if (tableData.length > 0) {
        for (const tableText of tableData) {
          if (tableText.includes(houseNumber) || tableText.includes('18')) {
            scheduleText = tableText;
            scheduleFound = true;
            break;
          }
        }
      }
    }
    
    if (scheduleFound) {
      console.log('✓ Розклад знайдено');
      return scheduleText.trim();
    } else {
      console.log('⚠ Розклад не знайдено для адреси');
      return null;
    }
  } catch (error) {
    console.error('Помилка при пошуку розкладу:', error.message);
    return null;
  }
}

/**
 * Зберегти поточний розклад
 */
async function saveSchedule(schedule) {
  const dataDir = path.dirname(CONFIG.DATA_FILE);
  await fs.ensureDir(dataDir);
  
  const data = {
    timestamp: new Date().toISOString(),
    schedule: schedule,
    address: CONFIG.ADDRESS,
  };
  
  await fs.writeJson(CONFIG.DATA_FILE, data, { spaces: 2 });
  console.log('✓ Розклад збережено');
}

/**
 * Завантажити останній збережений розклад
 */
async function loadLastSchedule() {
  try {
    const data = await fs.readJson(CONFIG.DATA_FILE);
    return data.schedule;
  } catch (error) {
    console.log('Початковий запуск - збережених даних немає');
    return null;
  }
}

/**
 * Порівняти розклади та визначити зміни
 */
function compareSchedules(oldSchedule, newSchedule) {
  if (!oldSchedule) {
    return {
      changed: true,
      isFirstRun: true,
    };
  }
  
  // Нормалізуємо текст для порівняння
  const normalize = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();
  
  const normalizedOld = normalize(oldSchedule);
  const normalizedNew = normalize(newSchedule);
  
  const changed = normalizedOld !== normalizedNew;
  
  return {
    changed: changed,
    isFirstRun: false,
  };
}

/**
 * Відправити сповіщення в Telegram
 */
async function sendTelegramNotification(message) {
  if (!bot) {
    console.log('⚠ Telegram бот не ініціалізовано, сповіщення не відправлено');
    return;
  }
  
  if (!CONFIG.CHAT_ID) {
    console.log('⚠ TELEGRAM_CHAT_ID не налаштовано, сповіщення не відправлено');
    return;
  }
  
  try {
    await bot.sendMessage(CONFIG.CHAT_ID, message, {
      parse_mode: 'HTML',
    });
    console.log('✓ Сповіщення відправлено в Telegram');
  } catch (error) {
    console.error('Помилка відправки в Telegram:', error.message);
  }
}

/**
 * Форматувати повідомлення про зміну
 */
function formatNotificationMessage(oldSchedule, newSchedule, isFirstRun) {
  let message = '';
  
  if (isFirstRun) {
    message = `🔌 <b>Моніторинг запущено</b>\n\n`;
    message += `📍 <b>Адреса:</b> ${CONFIG.ADDRESS}\n\n`;
    message += `<b>Поточний розклад:</b>\n<pre>${escapeHtml(newSchedule)}</pre>`;
  } else {
    message = `⚠️ <b>Зміна у розкладі відключень!</b>\n\n`;
    message += `📍 <b>Адреса:</b> ${CONFIG.ADDRESS}\n\n`;
    message += `<b>Новий розклад:</b>\n<pre>${escapeHtml(newSchedule)}</pre>\n\n`;
    
    if (oldSchedule) {
      message += `<b>Попередній розклад:</b>\n<pre>${escapeHtml(oldSchedule)}</pre>`;
    }
  }
  
  return message;
}

/**
 * Екранування HTML символів
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Головна функція моніторингу
 */
async function runMonitor() {
  console.log('\n===== Запуск моніторингу =====');
  console.log(`Адреса: ${CONFIG.ADDRESS}`);
  console.log(`URL: ${CONFIG.URL}`);
  
  let browser = null;
  
  try {
    // Завантажуємо останній збережений розклад
    const oldSchedule = await loadLastSchedule();
    
    // Запускаємо браузер
    console.log('\n🚀 Запуск браузера...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    });
    
    const page = await browser.newPage();
    
    // Встановлюємо User-Agent для більшої схожості на реальний браузер
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    // Переходимо на сторінку
    console.log('🌐 Завантаження сторінки...');
    await page.goto(CONFIG.URL, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    
    // Чекаємо поки Incapsula завантажиться
    await waitForIncapsula(page);
    
    // Знаходимо розклад
    const newSchedule = await findShutdownSchedule(page);
    
    if (newSchedule) {
      // Порівнюємо з попередніми даними
      const comparison = compareSchedules(oldSchedule, newSchedule);
      
      if (comparison.changed) {
        console.log('\n📢 Виявлено зміни у розкладі!');
        
        // Форматуємо та відправляємо сповіщення
        const message = formatNotificationMessage(
          oldSchedule,
          newSchedule,
          comparison.isFirstRun
        );
        await sendTelegramNotification(message);
        
        // Зберігаємо новий розклад
        await saveSchedule(newSchedule);
      } else {
        console.log('✓ Змін не виявлено');
      }
    } else {
      console.log('⚠️ Не вдалося отримати розклад');
      
      if (!oldSchedule) {
        // Якщо це перший запуск і не вдалося отримати дані
        await sendTelegramNotification(
          `❌ <b>Помилка моніторингу</b>\n\nНе вдалося отримати розклад відключень для адреси:\n${CONFIG.ADDRESS}`
        );
      }
    }
    
    console.log('\n===== Моніторинг завершено =====\n');
    
  } catch (error) {
    console.error('\n❌ КРИТИЧНА ПОМИЛКА:', error);
    
    // Відправляємо сповіщення про помилку
    await sendTelegramNotification(
      `❌ <b>Помилка моніторингу</b>\n\n${error.message}\n\nЧас: ${new Date().toLocaleString('uk-UA')}`
    );
  } finally {
    if (browser) {
      await browser.close();
      console.log('✓ Браузер закрито');
    }
  }
}

// Запускаємо моніторинг
if (require.main === module) {
  runMonitor().catch(console.error);
}

module.exports = { runMonitor };

