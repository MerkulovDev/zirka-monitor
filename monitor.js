const { CONFIG, validateConfig } = require('./src/config');
const { sendTelegramMessage } = require('./src/telegram');
const { processSchedule, formatScheduleMessage } = require('./src/schedule');
const { getLastKnownState, saveState, compareStates } = require('./src/state');
const { scrapeSchedule } = require('./src/scraper');

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Перевіряємо конфігурацію при запуску
validateConfig();

// Основна функція моніторингу
async function monitor() {
  try {
    console.log('🔌 Запуск моніторингу');
    console.log(`📍 Адреса: ${CONFIG.ADDRESS_CITY}, ${CONFIG.ADDRESS_STREET}, ${CONFIG.ADDRESS_HOUSE}\n`);

    let now = new Date();
    let hour = now.getHours();
    let minutes = now.getMinutes();
    const isMorningWindow = hour === 8 && minutes < 10; // О 8:00-8:10
    const isQuietHoursEarly = hour >= 23 || hour < 8;

    if (isQuietHoursEarly && !isMorningWindow) {
      console.log('🌙 Після 23:00 до 08:00 скрапінг не виконуємо. Очікуємо ранок.');
      return;
    }

    // Скрапінг даних
    const { factData, group, groupSchedule, tomorrowSchedule } = await scrapeSchedule();
    
    // Обробка графіку
    const { fullSchedule, schedule } = processSchedule(groupSchedule);
    console.log(`📊 Знайдено ${schedule.length} періодів відключення`);
    
    // Визначаємо чи є ранкове повідомлення (о 8:00)
    now = new Date();
    hour = now.getHours();
    minutes = now.getMinutes();
    const isMorningReport = hour === 8 && minutes < 20; // О 8:00-8:20
    const isEveningReport = hour === 21 && minutes < 20; // О 21:00-21:20
    const isQuietHours = hour >= 23 || hour < 8;
    const todayKey = getLocalDateKey(now);
    
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
    
    // Планові повідомлення
    let shouldSendMorningReport = false;
    if (isMorningReport) {
      const lastMorningDate = lastState?.lastMorningReportDate || null;
      if (lastMorningDate === todayKey) {
        console.log('☀️ Ранковий звіт уже відправлено сьогодні.');
      } else {
        shouldSendMorningReport = true;
        console.log('☀️ Плановий ранковий звіт о 08:00.');
      }
    }

    let shouldSendEveningReport = false;
    if (isEveningReport) {
      const lastEveningDate = lastState?.lastEveningReportDate || null;
      if (lastEveningDate === todayKey) {
        console.log('🌆 Вечірнє інформування вже відправлено сьогодні.');
      } else {
        shouldSendEveningReport = true;
        console.log('🌆 Планове інформування о 21:00.');
      }
    }
    
    if (comparison.changed || shouldSendMorningReport || shouldSendEveningReport) {
      let title;
      let pendingLog;
      if (shouldSendMorningReport) {
        title = '🔌 Графік на сьогодні';
        pendingLog = '📅 Відправляємо ранкове повідомлення...';
      } else if (shouldSendEveningReport) {
        title = '🔌 Графік на завтра';
        pendingLog = '🌆 Відправляємо вечірнє повідомлення...';
      } else if (comparison.groupChanged && !comparison.scheduleChanged && !comparison.tomorrowChanged) {
        title = '🔌 Групу оновлено';
        pendingLog = '📢 Виявлено зміни! Відправляємо повідомлення...';
      } else if (comparison.scheduleChanged && comparison.tomorrowChanged) {
        title = '🔌 Графік оновлено на сьогодні і завтра';
        pendingLog = '📢 Виявлено зміни! Відправляємо повідомлення...';
      } else if (comparison.scheduleChanged) {
        title = '🔌 Графік оновлено на сьогодні';
        pendingLog = '📢 Виявлено зміни! Відправляємо повідомлення...';
      } else if (comparison.tomorrowChanged) {
        title = '🔌 Графік оновлено на завтра';
        pendingLog = '📢 Виявлено зміни! Відправляємо повідомлення...';
      } else {
        title = '🔌 Оновлення графіку відключень';
        pendingLog = '📢 Виявлено зміни! Відправляємо повідомлення...';
      }

      const scheduleSections = [];
      let addedToday = false;
      let addedTomorrow = false;
      const processedTomorrowSchedule = tomorrowSchedule ? processSchedule(tomorrowSchedule).schedule : null;

      const pushTodaySection = () => {
        if (!addedToday) {
          scheduleSections.push({ label: 'сьогодні', scheduleData: schedule });
          addedToday = true;
        }
      };

      const pushTomorrowSection = () => {
        if (!addedTomorrow) {
          if (tomorrowSchedule) {
            scheduleSections.push({ label: 'завтра', scheduleData: processedTomorrowSchedule || [] });
          } else {
            scheduleSections.push({ label: 'завтра', scheduleData: [], note: 'ℹ️ Графік на завтра поки недоступний.' });
          }
          addedTomorrow = true;
        }
      };

      if (shouldSendMorningReport) {
        pushTodaySection();
      }

      if (shouldSendEveningReport) {
        pushTomorrowSection();
      }

      if (!addedToday && comparison.scheduleChanged) {
        pushTodaySection();
      }

      if (!addedTomorrow && comparison.tomorrowChanged) {
        pushTomorrowSection();
      }

      if (scheduleSections.length === 0) {
        pushTodaySection();
      }

      const lastEveningTomorrow = lastState?.tomorrowSchedule || null;
      const todaysFullScheduleJson = JSON.stringify(fullSchedule || {});
      const lastEveningTomorrowJson = JSON.stringify(lastEveningTomorrow || {});
      const isMorningSameAsLastEvening = shouldSendMorningReport && lastEveningTomorrow && todaysFullScheduleJson === lastEveningTomorrowJson;

      if (isMorningSameAsLastEvening) {
        console.log('🔇 Ранковий графік не змінився відносно вчорашнього вечірнього. Відправляємо беззвучно.');
      }

      const forceSilent = isMorningSameAsLastEvening;

      let sent = false;
      if (isQuietHours && !shouldSendMorningReport && !shouldSendEveningReport) {
        console.log('🌙 Після 23:00 повідомлення не надсилаємо. Очікуємо ранок.');
      } else {
        console.log(pendingLog);
        const message = formatScheduleMessage(
          title, 
          group, 
          scheduleSections, 
          factData.update
        );
        sent = await sendTelegramMessage(message, forceSilent);
      }
      
      const updatedLastMorningReportDate = sent && shouldSendMorningReport
        ? todayKey
        : lastState?.lastMorningReportDate || null;
      const updatedLastEveningReportDate = sent && shouldSendEveningReport
        ? todayKey
        : lastState?.lastEveningReportDate || null;
      const updatedLastMessageIn6to8 = shouldSendMorningReport
        ? sent
        : lastState?.lastMessageIn6to8 || false;

      // Формуємо поточний стан з повним графіком
      const currentState = {
        update: factData.update,
        group: group,
        fullSchedule: fullSchedule,
        tomorrowSchedule: tomorrowSchedule,
        schedule: schedule,
        timestamp: new Date().toISOString(),
        lastMessageIn6to8: updatedLastMessageIn6to8,
        lastMorningReportDate: updatedLastMorningReportDate,
        lastEveningReportDate: updatedLastEveningReportDate
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
        lastMessageIn6to8: lastState?.lastMessageIn6to8 || false,
        lastMorningReportDate: lastState?.lastMorningReportDate || null,
        lastEveningReportDate: lastState?.lastEveningReportDate || null
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
