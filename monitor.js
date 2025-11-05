const { CONFIG, validateConfig } = require('./src/config');
const { sendTelegramMessage } = require('./src/telegram');
const { processSchedule, formatScheduleMessage } = require('./src/schedule');
const { getLastKnownState, saveState, compareStates } = require('./src/state');
const { scrapeSchedule } = require('./src/scraper');

// Перевіряємо конфігурацію при запуску
validateConfig();

// Основна функція моніторингу
async function monitor() {
  try {
    console.log('🔌 Запуск моніторингу');
    console.log(`📍 Адреса: ${CONFIG.ADDRESS_CITY}, ${CONFIG.ADDRESS_STREET}, ${CONFIG.ADDRESS_HOUSE}\n`);
    
    // Скрапінг даних
    const { factData, group, groupSchedule, tomorrowSchedule } = await scrapeSchedule();
    
    // Обробка графіку
    const { fullSchedule, schedule } = processSchedule(groupSchedule);
    console.log(`📊 Знайдено ${schedule.length} періодів відключення`);
    
    // Визначаємо чи є ранкове повідомлення (о 8:00)
    const now = new Date();
    const hour = now.getHours();
    const minutes = now.getMinutes();
    const isMorningReport = hour === 8 && minutes < 10; // О 8:00-8:10
    
    // Порівнюємо з попереднім станом
    const lastState = getLastKnownState();
    const comparison = compareStates(
      lastState, 
      {
        update: factData.update,
        group: group,
        fullSchedule: fullSchedule
      },
      tomorrowSchedule,
      lastState?.tomorrowSchedule || null
    );
    
    console.log(`🔍 Порівняння: ${comparison.reason}`);
    
    // Перевіряємо чи було повідомлення в період 6-8 сьогодні
    let shouldSendMorningReport = false;
    if (isMorningReport && lastState) {
      const lastTimestamp = new Date(lastState.timestamp || 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const lastDate = new Date(lastTimestamp);
      lastDate.setHours(0, 0, 0, 0);
      
      // Перевіряємо чи це той самий день і чи не було повідомлень з 6:00 до 8:00
      const lastHour = lastTimestamp.getHours();
      const wasMessageIn6to8 = lastState.lastMessageIn6to8 || (lastHour >= 6 && lastHour < 8 && lastDate.getTime() === today.getTime());
      
      if (!wasMessageIn6to8 && lastDate.getTime() === today.getTime()) {
        shouldSendMorningReport = true;
        console.log('📅 Ранкове повідомлення: не було змін з 6:00-8:00, відправляємо графік на день');
      }
    }
    
    if (comparison.changed || shouldSendMorningReport) {
      let title;
      if (shouldSendMorningReport) {
        title = '🔌 Графік на сьогодні';
        console.log('📅 Відправляємо ранкове повідомлення...');
      } else {
        title = comparison.title || '🔌 Оновлення графіку відключень';
        console.log('📢 Виявлено зміни! Відправляємо повідомлення...');
      }
      
      let scheduleForMessage = schedule;
      if (
        !shouldSendMorningReport &&
        comparison.tomorrowChanged &&
        !comparison.scheduleChanged &&
        tomorrowSchedule
      ) {
        const { schedule: processedTomorrowSchedule } = processSchedule(tomorrowSchedule);
        scheduleForMessage = processedTomorrowSchedule;
        console.log('📅 Надсилаємо оновлений графік на завтра');
      }

      const message = formatScheduleMessage(
        title, 
        group, 
        scheduleForMessage, 
        factData.update, 
        comparison.tomorrowChanged && !shouldSendMorningReport
      );
      const sent = await sendTelegramMessage(message);
      
      // Формуємо поточний стан з повним графіком
      const currentState = {
        update: factData.update,
        group: group,
        fullSchedule: fullSchedule,
        tomorrowSchedule: tomorrowSchedule,
        schedule: schedule,
        timestamp: new Date().toISOString(),
        lastMessageIn6to8: sent && (hour >= 6 && hour < 8)
      };
      
      // Зберігаємо новий стан
      saveState(currentState);
    } else {
      console.log('✅ Змін не виявлено, повідомлення не відправляється');
      
      // Все одно оновлюємо timestamp стану
      const currentState = {
        update: factData.update,
        group: group,
        fullSchedule: fullSchedule,
        tomorrowSchedule: tomorrowSchedule,
        schedule: schedule,
        timestamp: new Date().toISOString(),
        lastMessageIn6to8: lastState?.lastMessageIn6to8 || false
      };
      saveState(currentState);
    }
    
  } catch (error) {
    console.error('❌ Помилка моніторингу:', error.message);
    
    // Відправляємо помилку в Telegram
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      await sendTelegramMessage(`❌ <b>Помилка моніторингу</b>\n\n${error.message}`);
    }
    
    process.exit(1);
  }
}

// Запускаємо моніторинг
monitor();
