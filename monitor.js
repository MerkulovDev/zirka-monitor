const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');

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
 * Зачекати поки Incapsula завантажиться та закрити модалку якщо є
 */
async function waitForIncapsula(page) {
  try {
    // Чекаємо трохи на завантаження
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Перевіряємо чи є модальне вікно
    const modalOverlay = await page.$('.modal__overlay');
    if (modalOverlay) {
      console.log('Знайдено модальне вікно, закриваю...');
      
      // Спробуємо знайти кнопку закриття
      const closeButtons = [
        '.modal__close.m-attention__close',
        '.modal__close',
        'button.modal__close',
        '.m-attention__close',
        '[aria-label*="close" i]',
        '[aria-label*="закрити" i]',
        '.modal__overlay',
      ];
      
      let closed = false;
      for (const selector of closeButtons) {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          console.log(`✓ Модалку закрито (${selector})`);
          closed = true;
          break;
        }
      }
      
      // Якщо не знайшли кнопку, просто клацнемо на overlay
      if (!closed) {
        await modalOverlay.click();
        console.log('✓ Клікнуто на overlay');
      }
      
      // Чекаємо поки модалка зникне
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Чекаємо на появу основного контенту (не строго обов'язкове)
    try {
      await page.waitForSelector('.shutdowns-content, .schedule-table, [class*="schedule"], table, .shutdowns-table, [class*="shutdown"]', {
        timeout: 10000,
      });
      console.log('✓ Знайдено селектор розкладу');
    } catch (error) {
      console.log('⚠ Спеціальні селектори не знайдені, продовжуємо...');
    }
    
    // Додаткова затримка для повного рендерингу
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('✓ Сторінка завантажилась');
  } catch (error) {
    console.error('⚠ Не вдалося дочекатись контенту');
  }
}

/**
 * Зробити API запит за розкладом
 */
async function getScheduleViaAPI(cookies, headers) {
  try {
    console.log('Спроба отримати розклад через API...');
    
    // Формуємо cookie header
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    // CSRF токен з cookies
    const csrfCookie = cookies.find(c => c.name.includes('csrf'));
    const csrfToken = csrfCookie ? csrfCookie.value : '';
    
    // Формуємо postData
    const postData = new URLSearchParams({
      method: 'getHomeNum',
      'data[0][name]': 'city',
      'data[0][value]': 'м. Вишгород',
      'data[1][name]': 'street',
      'data[1][value]': 'вул. Шолуденка',
      'data[2][name]': 'updateFact',
      'data[2][value]': new Date().toLocaleString('uk-UA', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).replace(',', '')
    });
    
    const options = {
      hostname: 'www.dtek-krem.com.ua',
      port: 443,
      path: '/ua/ajax',
      method: 'POST',
      headers: {
        'accept': 'application/json, text/javascript, */*; q=0.01',
        'accept-language': 'uk-UA,uk;q=0.9',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'cookie': cookieStr,
        'origin': 'https://www.dtek-krem.com.ua',
        'referer': 'https://www.dtek-krem.com.ua/ua/shutdowns',
        'user-agent': headers.userAgent,
        'x-csrf-token': csrfToken,
        'x-requested-with': 'XMLHttpRequest',
      }
    };
    
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          console.log(`API відповідь (${res.statusCode}):`, data.substring(0, 200));
          try {
            const json = JSON.parse(data);
            console.log('✓ API відповідь відпарсено');
            resolve(json);
          } catch (e) {
            console.log('Помилка парсингу API відповіді:', e.message, data.substring(0, 200));
            resolve(null);
          }
        });
      });
      
      req.on('error', (e) => {
        console.error('Помилка API запиту:', e.message);
        resolve(null);
      });
      
      req.write(postData.toString());
      req.end();
    });
  } catch (error) {
    console.error('Помилка API запиту:', error.message);
    return null;
  }
}

/**
 * Отримати дані розкладу через форму на сторінці
 */
async function fillFormAndGetSchedule(page) {
  try {
    console.log('Заповнення форми...');
    
    // Заповнюємо місто
    await page.waitForSelector('#city', { timeout: 10000 });
    await page.click('#city');
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.type('#city', 'м. Вишгород');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Чекаємо на появу автокомпліту та клікаємо
    try {
      await page.waitForSelector('#cityautocomplete-list.autocomplete-items', { timeout: 5000 });
      await page.click('#cityautocomplete-list > div:first-child');
      console.log('✓ Вибрано місто з автокомпліту');
    } catch (e) {
      console.log('Автокомпліт не з\'явився для міста, пропускаємо...');
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Заповнюємо вулицю
    await page.waitForSelector('#street:not([disabled])', { timeout: 10000 });
    await page.click('#street');
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.type('#street', 'вул. Шолуденка');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Чекаємо на появу автокомпліту та клікаємо
    try {
      await page.waitForSelector('#streetautocomplete-list.autocomplete-items', { timeout: 5000 });
      await page.click('#streetautocomplete-list > div:first-child');
      console.log('✓ Вибрано вулицю з автокомпліту');
    } catch (e) {
      console.log('Автокомпліт не з\'явився для вулиці, пропускаємо...');
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Заповнюємо будинок
    console.log('Чекаю на появу поля будинку...');
    await page.waitForSelector('#house_num:not([disabled])', { timeout: 15000 });
    await page.click('#house_num');
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.type('#house_num', '18А');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Чекаємо на появу автокомпліту та клікаємо
    try {
      await page.waitForSelector('#house_numautocomplete-list.autocomplete-items', { timeout: 5000 });
      await page.click('#house_numautocomplete-list > div:first-child');
      console.log('✓ Вибрано будинок з автокомпліту');
    } catch (e) {
      console.log('Автокомпліт не з\'явився для будинку, пропускаємо...');
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Отримуємо дані з форми
    const scheduleData = await page.evaluate(() => {
      // Знаходимо групу
      const groupDiv = document.getElementById('group-name');
      const group = groupDiv ? groupDiv.textContent.trim() : null;
      
      console.log('Знайдено групу:', group);
      
      // Знаходимо таблицю розкладу (тільки активну)
      const table = document.querySelector('table');
      if (!table) {
        console.log('Таблиця не знайдена');
        return null;
      }
      
      // Знаходимо всі комірки з розкладом
      const scheduledCells = table.querySelectorAll('.cell-scheduled, .cell-first-half, .cell-second-half');
      console.log('Знайдено комірок з розкладом:', scheduledCells.length);
      
      const timeSlots = [];
      
      // Отримуємо всі headers з годинами
      const headers = Array.from(table.querySelectorAll('th[scope="col"] div'));
      console.log('Знайдено headers:', headers.length);
      
      scheduledCells.forEach((cell, index) => {
        const row = cell.closest('tr');
        const cellIndex = Array.from(row.cells).indexOf(cell);
        // Віднімаємо 2 бо перші 2 колонки - це заголовки
        const headerIndex = cellIndex - 2;
        
        if (headerIndex >= 0 && headerIndex < headers.length) {
          const timeText = headers[headerIndex].textContent.trim();
          const cellType = cell.classList.contains('cell-first-half') ? '30' :
                          cell.classList.contains('cell-second-half') ? '30' : '00';
          timeSlots.push({ time: timeText, type: cellType });
        }
      });
      
      return { group, timeSlots };
    });
    
    console.log('Дані з таблиці:', scheduleData);
    
    if (scheduleData && scheduleData.group) {
      console.log(`✓ Група знайдена: ${scheduleData.group}`);
      
      if (scheduleData.timeSlots && scheduleData.timeSlots.length > 0) {
        console.log('✓ Дані з таблиці отримано');
        let result = `Група: ${scheduleData.group}\n\n`;
        
        // Групуємо комірки по суміжних періодах
        const outages = [];
        let currentOutage = null;
        
        scheduleData.timeSlots.forEach((slot, idx) => {
          const [startH, endH] = slot.time.split('-');
          const cellType = slot.type;
          
          if (idx === 0) {
            // Початок першого відключення
            currentOutage = {
              start: `${startH}:${cellType}`,
              end: `${endH}:00`
            };
          } else {
            // Перевіряємо чи це продовження поточного відключення
            const prevSlot = scheduleData.timeSlots[idx - 1];
            const [prevEndH] = prevSlot.time.split('-')[1];
            
            if (prevEndH === startH && prevSlot.type === cellType) {
              // Продовження відключення
              currentOutage.end = `${endH}:00`;
            } else {
              // Новий період відключення
              outages.push(currentOutage);
              currentOutage = {
                start: `${startH}:${cellType}`,
                end: `${endH}:00`
              };
            }
          }
          
          if (idx === scheduleData.timeSlots.length - 1 && currentOutage) {
            outages.push(currentOutage);
          }
        });
        
        // Форматуємо результат
        outages.forEach((outage, idx) => {
          if (idx === 0) {
            result += `Відключення: ${outage.start}\nУвімкнення: ${outage.end}\n`;
          } else {
            result += `\nВідключення: ${outage.start}\nУвімкнення: ${outage.end}\n`;
          }
        });
        
        return result.trim();
      } else {
        // Таблиця порожня
        console.log('⚠️ Таблиця розкладу порожня');
        return `Група: ${scheduleData.group}\n\nВідключення відсутні`;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Помилка заповнення форми:', error.message);
    return null;
  }
}

/**
 * Знайти розклад відключень для адреси
 */
async function findShutdownSchedule(page, cookies, headers) {
  try {
    console.log('Пошук розкладу для адреси...');
    
    // Спочатку спробуємо через API
    const apiData = await getScheduleViaAPI(cookies, headers);
    if (apiData && apiData.result) {
      console.log('✓ Дані отримані з API');
      
      // Парсимо API відповідь
      let result = '';
      if (apiData.result.sub_type_reason && apiData.result.sub_type_reason.length > 0) {
        result += `Група: ${apiData.result.sub_type_reason[0]}\n`;
      }
      if (apiData.result.start_date) {
        result += `Початок: ${apiData.result.start_date}\n`;
      }
      if (apiData.result.end_date) {
        result += `Кінець: ${apiData.result.end_date}\n`;
      }
      if (apiData.result.type) {
        result += `Тип: ${apiData.result.type}\n`;
      }
      
      return result.trim() || JSON.stringify(apiData.result);
    }
    
    // Fallback: спробуємо через форму
    const formSchedule = await fillFormAndGetSchedule(page);
    if (formSchedule) {
      return formSchedule;
    }
    
    // Fallback: шукаємо текст з адресою
    const houseNumber = '18А';
    const pageContent = await page.evaluate(() => {
      return document.body.innerText;
    });
    
    console.log(`Довжина сторінки: ${pageContent.length} символів`);
    
    const lines = pageContent.split('\n');
    let scheduleFound = false;
    let scheduleText = '';
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(houseNumber) || lines[i].includes('18') || lines[i].includes('Шолуденка')) {
        const startIdx = Math.max(0, i - 2);
        const endIdx = Math.min(lines.length, i + 10);
        
        for (let j = startIdx; j <= endIdx; j++) {
          scheduleText += lines[j].trim() + '\n';
        }
        
        scheduleFound = true;
        break;
      }
    }
    
    if (scheduleFound) {
      console.log('✓ Розклад знайдено (текстовий)');
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
    
    // Слухаємо network requests для знаходження API
    const apiResponses = [];
    page.on('response', async response => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('json') || url.includes('api') || url.includes('ajax') || url.includes('shutdown')) {
        try {
          const data = await response.json();
          apiResponses.push({ url, data });
          console.log(`API Response: ${url}`);
        } catch (e) {
          // Не JSON
        }
      }
    });
    
    // Переходимо на сторінку
    console.log('🌐 Завантаження сторінки...');
    await page.goto(CONFIG.URL, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    
    // Чекаємо поки Incapsula завантажиться
    await waitForIncapsula(page);
    
    // Перевіряємо чи є API responses
    console.log(`Захоплено API responses: ${apiResponses.length}`);
    if (apiResponses.length > 0) {
      console.log('Знайдені API URLs:');
      apiResponses.forEach((resp, idx) => {
        console.log(`${idx + 1}. ${resp.url.substring(0, 150)}`);
      });
    }
    
    // Отримуємо cookies та headers для API запиту
    const cookies = await page.cookies();
    const headers = await page.evaluate(() => {
      return {
        userAgent: navigator.userAgent,
      };
    });
    
    console.log(`Отримано cookies: ${cookies.length}`);
    
    // Знаходимо розклад (спочатку API, потім форма)
    const newSchedule = await findShutdownSchedule(page, cookies, headers);
    
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

