const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// Конфігурація
const CONFIG = {
  URL: 'https://www.dtek-krem.com.ua/ua/shutdowns',
  ADDRESS_CITY: 'м. Вишгород',
  ADDRESS_STREET: 'вул. Кургузова',
  ADDRESS_HOUSE: '1А',
  STATE_FILE: path.join(__dirname, 'data', 'last_known_schedule.json'),
};

// Функція для визначення, чи можна відправляти повідомлення в поточний час
function canSendMessage() {
  const now = new Date();
  const hour = now.getHours();
  const minutes = now.getMinutes();
  const currentTime = hour * 60 + minutes; // Час в хвилинах від початку дня
  const dayOfWeek = now.getDay(); // 0 = неділя, 6 = субота
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
  // 00:00-06:00 - не відправляти взагалі
  if (currentTime >= 0 && currentTime < 360) {
    return { canSend: false, silent: false, reason: 'Нічний час (00:00-06:00)' };
  }
  
  // 06:00-08:00 - беззвучні повідомлення
  if (currentTime >= 360 && currentTime < 480) {
    return { canSend: true, silent: true, reason: 'Ранковий час (06:00-08:00)' };
  }
  
  // 22:00-00:00 - беззвучні повідомлення
  if (currentTime >= 1320) {
    return { canSend: true, silent: true, reason: 'Вечірній час (22:00-00:00)' };
  }
  
  // Вихідні 06:00-10:00 - беззвучні повідомлення
  if (isWeekend && currentTime >= 360 && currentTime < 600) {
    return { canSend: true, silent: true, reason: 'Вихідний ранковий час (06:00-10:00)' };
  }
  
  // В інший час - звичайні повідомлення
  return { canSend: true, silent: false, reason: 'Робочий час' };
}

// Функція для відправки повідомлення в Telegram
async function sendTelegramMessage(message, silent = false) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.CHAT_ID) {
    console.log('⚠️  Telegram не налаштовано (відсутні TELEGRAM_BOT_TOKEN або CHAT_ID)');
    return false;
  }

  // Перевіряємо, чи можна відправляти в поточний час
  const sendStatus = canSendMessage();
  
  if (!sendStatus.canSend) {
    console.log(`⏸️  Повідомлення не відправлено: ${sendStatus.reason}`);
    return false;
  }

  if (sendStatus.silent) {
    console.log(`🔇 Повідомлення буде відправлено беззвучно: ${sendStatus.reason}`);
  }

  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: process.env.CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_notification: sendStatus.silent || silent,
    });

    if (response.data.ok) {
      const silentText = (sendStatus.silent || silent) ? ' (беззвучно)' : '';
      console.log(`✅ Повідомлення відправлено в Telegram${silentText}`);
      return true;
    } else {
      console.error('❌ Помилка відправки в Telegram:', response.data);
      return false;
    }
  } catch (error) {
    console.error('❌ Помилка при відправці в Telegram:', error.message);
    return false;
  }
}

// Функція для форматування графіку відключень
function formatScheduleMessage(group, scheduleData, updateTime) {
  let message = `<b>🔌 Оновлення графіку відключень</b>\n\n`;
  message += `📍 Адреса: ${CONFIG.ADDRESS_CITY}, ${CONFIG.ADDRESS_STREET}, ${CONFIG.ADDRESS_HOUSE}\n`;
  message += `⚡ Група: <b>${group}</b>\n`;
  message += `🕐 Оновлено: ${updateTime}\n\n`;

  if (!scheduleData || scheduleData.length === 0) {
    message += `✅ Відключень не заплановано - світло буде весь день!`;
  } else {
    message += `<b>📅 Періоди відключення:</b>\n`;
    scheduleData.forEach(({ range, interpretation }) => {
      message += `${range}: ${interpretation}\n`;
    });
  }

  return message;
}

// Функція для отримання попереднього стану
function getLastKnownState() {
  try {
    if (fs.existsSync(CONFIG.STATE_FILE)) {
      const data = fs.readFileSync(CONFIG.STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.log('⚠️  Неможливо прочитати попередній стан:', error.message);
  }
  return null;
}

// Функція для збереження поточного стану
function saveState(state) {
  try {
    // Створюємо директорію, якщо її немає
    const dir = path.dirname(CONFIG.STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
    console.log('💾 Стан збережено');
  } catch (error) {
    console.error('❌ Помилка збереження стану:', error.message);
  }
}

// Функція для порівняння станів
function compareStates(oldState, newState) {
  if (!oldState) {
    return { changed: true, reason: 'Перший запуск' };
  }

  // Порівнюємо update timestamp
  if (oldState.update !== newState.update) {
    return { changed: true, reason: `Оновлено з ${oldState.update} на ${newState.update}` };
  }

  // Порівнюємо графік для групи
  const oldSchedule = oldState.schedule || [];
  const newSchedule = newState.schedule || [];

  if (oldSchedule.length !== newSchedule.length) {
    return { changed: true, reason: 'Змінився кількість періодів відключення' };
  }

  // Порівнюємо кожен період
  for (let i = 0; i < newSchedule.length; i++) {
    const oldItem = oldSchedule[i];
    const newItem = newSchedule[i];

    if (!oldItem || oldItem.range !== newItem.range || oldItem.value !== newItem.value) {
      return { changed: true, reason: `Змінився період ${newItem.range}` };
    }
  }

  return { changed: false, reason: 'Змін немає' };
}

// Функції для обробки графіку
function getTimeRange(hour) {
  const startHour = String(hour - 1).padStart(2, '0');
  const endHour = String(hour).padStart(2, '0');
  return `${startHour}:00-${endHour}:00`;
}

function interpretHourValue(hour, value) {
  const startHour = hour - 1;
  const endHour = hour;
  const startStr = String(startHour).padStart(2, '0');
  const endStr = String(endHour).padStart(2, '0');
  
  switch(value) {
    case 'yes':
      return `✅ Світло є`;
    case 'no':
      return `❌ Відключення весь проміжок`;
    case 'first':
      return `⚠️ Відключення з ${startStr}:00 до ${startStr}:30`;
    case 'second':
      return `⚠️ Відключення з ${startStr}:30 до ${endStr}:00`;
    default:
      return `❓ Невідоме значення "${value}"`;
  }
}

// Основна функція моніторингу
async function monitor() {
  let browser;
  
  try {
    console.log('🔌 Запуск моніторингу відключень ДТЕК');
    console.log(`📍 Адреса: ${CONFIG.ADDRESS_CITY}, ${CONFIG.ADDRESS_STREET}, ${CONFIG.ADDRESS_HOUSE}\n`);
    
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('🌐 Завантажуємо сторінку...');
    await page.goto(CONFIG.URL, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });
    
    await page.waitForTimeout(5000);
    
    // Крок 1: Витягуємо DisconSchedule.fact
    console.log('🔍 Витягуємо графік відключень...');
    const factData = await page.evaluate(() => {
      if (typeof DisconSchedule !== 'undefined' && DisconSchedule.fact) {
        return DisconSchedule.fact;
      }
      return null;
    });
    
    if (!factData) {
      throw new Error('Не вдалося витягти DisconSchedule.fact');
    }
    
    console.log('✅ Графік отримано (оновлено:', factData.update + ')');
    
    // Крок 2: Отримуємо CSRF токен
    const csrfToken = await page.evaluate(() => {
      const metaTag = document.querySelector('meta[name="csrf-token"]');
      return metaTag ? metaTag.getAttribute('content') : null;
    });
    
    if (!csrfToken) {
      throw new Error('CSRF токен не знайдено');
    }
    
    // Крок 3: Шукаємо групу для адреси
    console.log('🔍 Шукаємо групу для адреси...');
    const searchResult = await page.evaluate(async (city, street, update, csrf) => {
      const ajaxUrl = document.querySelector('meta[name="ajaxUrl"]')?.getAttribute('content') || '/ua/ajax';
      const fullUrl = ajaxUrl.startsWith('http') ? ajaxUrl : `${window.location.origin}${ajaxUrl}`;
      
      const params = new URLSearchParams();
      params.append('method', 'getHomeNum');
      params.append('data[0][name]', 'city');
      params.append('data[0][value]', city);
      params.append('data[1][name]', 'street');
      params.append('data[1][value]', street);
      params.append('data[2][name]', 'updateFact');
      params.append('data[2][value]', update);
      
      try {
        const response = await fetch(fullUrl, {
          method: 'POST',
          headers: {
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-csrf-token': csrf,
            'x-requested-with': 'XMLHttpRequest',
            'referer': window.location.href
          },
          body: params.toString()
        });
        
        return await response.json();
      } catch (error) {
        return { error: error.message };
      }
    }, CONFIG.ADDRESS_CITY, CONFIG.ADDRESS_STREET, factData.update, csrfToken);
    
    if (searchResult.error) {
      throw new Error('Помилка пошуку адреси: ' + searchResult.error);
    }
    
    if (!searchResult.result || !searchResult.data) {
      throw new Error('Неочікуваний формат відповіді від сервера');
    }
    
    // Шукаємо будинок
    const houseKey = CONFIG.ADDRESS_HOUSE.toUpperCase();
    const houseKeyAlt1 = houseKey.replace('А', '-А');
    const houseKeyAlt2 = houseKey.replace('А', 'A');
    
    let houseData = searchResult.data[houseKey] || 
                   searchResult.data[houseKeyAlt1] || 
                   searchResult.data[houseKeyAlt2];
    
    if (!houseData) {
      const matchingKey = Object.keys(searchResult.data).find(key => 
        key === houseKey || key === houseKeyAlt1 || key === houseKeyAlt2 ||
        key.startsWith(houseKey) || key.includes(houseKey) ||
        key.startsWith(houseKeyAlt1) || key.includes(houseKeyAlt1)
      );
      if (matchingKey) {
        houseData = searchResult.data[matchingKey];
      }
    }
    
    if (!houseData || !houseData.sub_type_reason || houseData.sub_type_reason.length === 0) {
      throw new Error(`Будинок ${CONFIG.ADDRESS_HOUSE} не знайдено або група не визначена`);
    }
    
    const group = houseData.sub_type_reason[0];
    console.log(`✅ Знайдено групу: ${group}`);
    
    // Крок 4: Витягуємо графік для групи
    const firstDayKey = Object.keys(factData.data || {})[0];
    if (!firstDayKey || !factData.data[firstDayKey][group]) {
      throw new Error(`Графік для групи ${group} не знайдено`);
    }
    
    const groupSchedule = factData.data[firstDayKey][group];
    
    // Формуємо детальний графік
    const schedule = [];
    for (let hour = 1; hour <= 24; hour++) {
      const value = groupSchedule[String(hour)];
      if (value && value !== 'yes') {
        schedule.push({
          hour,
          range: getTimeRange(hour),
          value,
          interpretation: interpretHourValue(hour, value)
        });
      }
    }
    
    console.log(`📊 Знайдено ${schedule.length} періодів відключення`);
    
    // Формуємо поточний стан
    const currentState = {
      update: factData.update,
      group: group,
      schedule: schedule,
      timestamp: new Date().toISOString()
    };
    
    // Порівнюємо з попереднім станом
    const lastState = getLastKnownState();
    const comparison = compareStates(lastState, currentState);
    
    console.log(`🔍 Порівняння: ${comparison.reason}`);
    
    if (comparison.changed) {
      console.log('📢 Виявлено зміни! Відправляємо повідомлення...');
      
      const message = formatScheduleMessage(group, schedule, factData.update);
      await sendTelegramMessage(message);
      
      // Зберігаємо новий стан
      saveState(currentState);
    } else {
      console.log('✅ Змін не виявлено, повідомлення не відправляється');
    }
    
    await browser.close();
    
  } catch (error) {
    console.error('❌ Помилка моніторингу:', error.message);
    if (browser) {
      await browser.close();
    }
    
    // Відправляємо помилку в Telegram
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.CHAT_ID) {
      await sendTelegramMessage(`❌ <b>Помилка моніторингу</b>\n\n${error.message}`);
    }
    
    process.exit(1);
  }
}

// Запускаємо моніторинг
monitor();

