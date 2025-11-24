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
    
    // Визначаємо чи є ранкове повідомлення (о 8:00)
    now = new Date();
    hour = now.getHours();
    minutes = now.getMinutes();
    const isMorningReport = hour === 8 && minutes < 20; // О 8:00-8:20
    const isNightReport = hour === 4 && minutes < 20; // О 4:00-4:20
    const isEveningReport = hour === 21 && minutes < 20; // О 21:00-21:20
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

    let shouldSendNightReport = false;
    if (isNightReport) {
      const lastNightDate = lastState?.lastNightReportDate || null;
      if (lastNightDate === todayKey) {
        console.log('🌙 Нічний звіт уже відправлено сьогодні.');
      } else if (comparison.changed) {
        shouldSendNightReport = true;
        console.log('🌙 Нічний моніторинг: зафіксовано зміни, готуємо беззвучне повідомлення.');
      } else {
        console.log('🌙 Нічний моніторинг: змін немає, повідомлення не надсилаємо.');
      }
    }
    
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
    
    if (comparison.changed || shouldSendMorningReport || shouldSendEveningReport || shouldSendNightReport) {
      let title;
      let pendingLog;
      if (shouldSendMorningReport) {
        title = '🔌 Нагадування графіку на сьогодні';
        pendingLog = '📅 Відправляємо ранкове повідомлення...';
      } else if (shouldSendNightReport) {
        title = '🔌 Нічне оновлення графіку';
        pendingLog = '🌙 Відправляємо нічне повідомлення...';
      } else if (shouldSendEveningReport) {
        title = '🔌 Нагадування графіку на завтра';
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

      const pushTodaySection = () => {
        if (!addedToday) {
          scheduleSections.push({ label: 'сьогодні', scheduleData: schedule });
          addedToday = true;
        }
      };

      const pushTomorrowSection = () => {
        if (!addedTomorrow) {
          if (processedTomorrowSchedule) {
            scheduleSections.push({ label: 'завтра', scheduleData: processedTomorrowSchedule.schedule || [] });
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
      if (shouldSendNightReport && comparison.tomorrowChanged) {
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

      if (shouldSendNightReport) {
        console.log('🔇 Нічне повідомлення буде відправлено беззвучно.');
      } else if (isMorningSameAsLastEvening) {
        console.log('🔇 Ранковий графік не змінився відносно вчорашнього вечірнього. Відправляємо беззвучно.');
      }

      const forceSilent = isMorningSameAsLastEvening || shouldSendNightReport;

      let sent = false;
      if (isQuietHours && !shouldSendMorningReport && !shouldSendEveningReport && !shouldSendNightReport) {
        console.log('🌙 Після 23:00 повідомлення не надсилаємо. Очікуємо ранок.');
      } else {
        console.log(pendingLog);
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
        sent = await sendTelegramMessage(message, forceSilent);
      }
      
      const updatedLastMorningReportDate = sent && shouldSendMorningReport
        ? todayKey
        : lastState?.lastMorningReportDate || null;
      const updatedLastEveningReportDate = sent && shouldSendEveningReport
        ? todayKey
        : lastState?.lastEveningReportDate || null;
      const updatedLastNightReportDate = sent && shouldSendNightReport
        ? todayKey
        : lastState?.lastNightReportDate || null;
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
        lastEveningReportDate: updatedLastEveningReportDate,
        lastNightReportDate: updatedLastNightReportDate,
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
        lastMessageIn6to8: lastState?.lastMessageIn6to8 || false,
        lastMorningReportDate: lastState?.lastMorningReportDate || null,
        lastEveningReportDate: lastState?.lastEveningReportDate || null,
        lastNightReportDate: lastState?.lastNightReportDate || null,
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
