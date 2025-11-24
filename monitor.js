const { CONFIG, validateConfig } = require('./src/config');
const { sendTelegramMessage } = require('./src/telegram');
const { processSchedule, formatScheduleMessage, mergeDisconnectionPeriods } = require('./src/schedule');
const { getLastKnownState, saveState, compareStates } = require('./src/state');
const { scrapeSchedule } = require('./src/scraper');

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDurationForReminder(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (hours > 0) {
    let label;
    if (hours === 1) {
      label = '1 година';
    } else if (hours >= 5) {
      label = `${hours} годин`;
    } else {
      label = `${hours} години`;
    }
    parts.push(label);
  }

  if (minutes > 0) {
    let label;
    if (minutes === 1) {
      label = '1 хвилина';
    } else if ([2, 3, 4].includes(minutes % 10) && ![12, 13, 14].includes(minutes)) {
      label = `${minutes} хвилини`;
    } else {
      label = `${minutes} хвилин`;
    }
    parts.push(label);
  }

  if (parts.length === 0) {
    return '0 хвилин';
  }

  return parts.join(' ');
}

function formatDurationShort(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours} год`);
  }
  if (mins > 0) {
    parts.push(`${mins} хв`);
  }
  if (parts.length === 0) {
    return '0 хв';
  }
  return parts.join(' ');
}

const MINUTES_IN_DAY = 24 * 60;

function formatTimeFromMinutes(minutes) {
  const normalized = ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const hrs = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function extendIntervalsAcrossMidnight(todayIntervals, tomorrowIntervals) {
  if (!Array.isArray(todayIntervals) || todayIntervals.length === 0) {
    return [];
  }
  const extended = todayIntervals.map(interval => ({ ...interval }));
  if (!Array.isArray(tomorrowIntervals) || tomorrowIntervals.length === 0) {
    return extended;
  }

  const lastToday = extended[extended.length - 1];
  if (!lastToday || lastToday.endMinutes < MINUTES_IN_DAY) {
    return extended;
  }

  let currentEnd = lastToday.endMinutes;
  if (currentEnd < MINUTES_IN_DAY) {
    return extended;
  }

  for (const interval of tomorrowIntervals) {
    const startAbs = MINUTES_IN_DAY + interval.startMinutes;
    if (startAbs > currentEnd + 1) {
      break;
    }

    const endAbs = MINUTES_IN_DAY + interval.endMinutes;
    currentEnd = Math.max(currentEnd, endAbs);
  }

  if (currentEnd > lastToday.endMinutes) {
    lastToday.endMinutes = currentEnd;
    lastToday.endStr = formatTimeFromMinutes(currentEnd);
    lastToday.durationMinutes = currentEnd - lastToday.startMinutes;
    lastToday.durationStr = formatDurationShort(lastToday.durationMinutes);
  }

  return extended;
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
    const isMorningWindow = hour === 8 && minutes < 20; // О 8:00-8:20
    const isNightWindow = hour === 4 && minutes < 20; // О 4:00-4:20
    const isQuietHoursEarly = hour >= 23 || hour < 8;

    if (isQuietHoursEarly && !isMorningWindow && !isNightWindow) {
      console.log('🌙 Після 23:00 до 08:00 скрапінг не виконуємо. Очікуємо ранок.');
      return;
    }

    // Скрапінг даних
    const { factData, group, groupSchedule, tomorrowSchedule } = await scrapeSchedule();
    
    // Обробка графіку
    const { fullSchedule, schedule } = processSchedule(groupSchedule);
    console.log(`📊 Знайдено ${schedule.length} періодів відключення`);
    const mergedTodayIntervalsRaw = mergeDisconnectionPeriods(schedule);
    const processedTomorrowSchedule = tomorrowSchedule ? processSchedule(tomorrowSchedule) : null;
    const mergedTomorrowIntervals = processedTomorrowSchedule ? mergeDisconnectionPeriods(processedTomorrowSchedule.schedule) : [];
    const mergedTodayIntervals = extendIntervalsAcrossMidnight(mergedTodayIntervalsRaw, mergedTomorrowIntervals);
    
    // Визначаємо поточний час
    now = new Date();
    hour = now.getHours();
    minutes = now.getMinutes();
    const isQuietHours = hour >= 23 || hour < 8;
    const nowMinutes = hour * 60 + minutes;
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
    
    // Логіка нагадувань за 30 хвилин до відключення
    const remindersRaw = lastState && typeof lastState.remindersSent === 'object' && !Array.isArray(lastState.remindersSent)
      ? { ...lastState.remindersSent }
      : {};
    const todaysReminderSet = new Set(
      Array.isArray(remindersRaw[todayKey]) ? remindersRaw[todayKey] : []
    );
    const dueReminders = [];
    mergedTodayIntervals.forEach(interval => {
      const diff = interval.startMinutes - nowMinutes;
      if (diff > 0 && diff <= 30) {
        const key = String(interval.startMinutes);
        if (!todaysReminderSet.has(key)) {
          dueReminders.push({ interval });
        }
      }
    });
    
    let reminderMessageSent = false;
    if (dueReminders.length > 0) {
      console.log(`⏰ Найближчі відключення стартують менш ніж за 30 хв: ${dueReminders.map(r => r.interval.startStr).join(', ')}`);
      let reminderMessage = `<b>🔔 Нагадування: Найближчі 30 хв очікуйте відключення за графіком</b>\n\n`;
      const { interval } = dueReminders[0];
      const durationText = formatDurationForReminder(interval.durationMinutes);
      reminderMessage += `Планове відключення: ${interval.startStr} - ${interval.endStr} · ${interval.durationStr}\n`;
      if (dueReminders.length > 1) {
        const nextInterval = dueReminders[1].interval;
        reminderMessage += `Наступне відключення: ${nextInterval.startStr} - ${nextInterval.endStr} · ${nextInterval.durationStr}\n`;
      }
      
      reminderMessageSent = await sendTelegramMessage(reminderMessage, true);
      if (reminderMessageSent) {
        console.log('✅ Нагадування надіслано');
        dueReminders.forEach(({ interval }) => {
          todaysReminderSet.add(String(interval.startMinutes));
        });
      } else {
        console.log('⚠️ Нагадування не вдалося надіслати');
      }
    }
    
    const updatedRemindersSentMap = { ...remindersRaw };
    if (todaysReminderSet.size > 0) {
      updatedRemindersSentMap[todayKey] = Array.from(todaysReminderSet);
    } else {
      delete updatedRemindersSentMap[todayKey];
    }
    
    // Відправляємо повідомлення тільки при реальних змінах графіку
    if (comparison.changed) {
      let title;
      if (comparison.groupChanged && !comparison.scheduleChanged && !comparison.tomorrowChanged) {
        title = '🔌 Групу оновлено';
      } else if (comparison.scheduleChanged && comparison.tomorrowChanged) {
        title = '🔌 Графік оновлено на сьогодні і завтра';
      } else if (comparison.scheduleChanged) {
        title = '🔌 Графік оновлено на сьогодні';
      } else if (comparison.tomorrowChanged) {
        title = '🔌 Графік оновлено на завтра';
      } else {
        title = '🔌 Оновлення графіку відключень';
      }
      
      console.log('📢 Виявлено зміни! Відправляємо повідомлення та закріплюємо його...');

      // Формуємо розділи повідомлення в залежності від того, що змінилось
      const scheduleSections = [];
      
      if (comparison.scheduleChanged) {
        scheduleSections.push({ label: 'сьогодні', scheduleData: schedule });
      }
      
      if (comparison.tomorrowChanged) {
        if (processedTomorrowSchedule) {
          scheduleSections.push({ label: 'завтра', scheduleData: processedTomorrowSchedule.schedule || [] });
        } else {
          scheduleSections.push({ label: 'завтра', scheduleData: [], note: 'ℹ️ Графік на завтра поки недоступний.' });
        }
      }
      
      // Якщо нічого не змінилось, але comparison.changed = true (наприклад, група), показуємо сьогодні
      if (scheduleSections.length === 0) {
        scheduleSections.push({ label: 'сьогодні', scheduleData: schedule });
      }

      // Формуємо і відправляємо повідомлення
      const message = formatScheduleMessage(
        title, 
        group, 
        scheduleSections, 
        factData.update,
        {
          filterPastToday: true,
          hideEmptyTomorrowUntilAfternoon: true,
        }
      );
      
      // Визначаємо чи треба тихо відправити (тихі години)
      const sendStatus = require('./src/telegram').canSendMessage();
      const silent = sendStatus.silent || isQuietHours;
      
      // Відправляємо та закріплюємо повідомлення
      const sent = await sendTelegramMessage(message, silent, true); // true = закріпити

      // Формуємо поточний стан з повним графіком
      const currentState = {
        update: factData.update,
        group: group,
        fullSchedule: fullSchedule,
        tomorrowSchedule: tomorrowSchedule,
        schedule: schedule,
        timestamp: new Date().toISOString(),
        remindersSent: updatedRemindersSentMap
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
        remindersSent: updatedRemindersSentMap
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
