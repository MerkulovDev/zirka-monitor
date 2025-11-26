// Встановлюємо TEST_MODE перед імпортом config
process.env.TEST_MODE = 'true';

const { CONFIG, validateConfig } = require('./src/config');
const { sendTelegramMessage } = require('./src/telegram-pinned'); // Використовуємо версію з закріпленням
const { processSchedule, formatScheduleMessage, mergeDisconnectionPeriods } = require('./src/schedule');
const { getLastKnownState, saveState, compareStates } = require('./src/state-test');
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
    const mergedTodayIntervals = mergeDisconnectionPeriods(schedule);
    
    // Визначаємо поточний час
    now = new Date();
    hour = now.getHours();
    minutes = now.getMinutes();
    const isMorningReport = hour === 8 && minutes < 20; // О 8:00-8:20 - щоденне повідомлення про сьогодні
    const isEveningReport = hour === 21 && minutes < 20; // О 21:00-21:20 - щоденне повідомлення про завтра
    const isNightReport = hour >= 2 && hour < 4; // 2:00-4:00 - нічний моніторинг змін
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

    // Перевіряємо чи потрібне нагадування (якщо від останньої зміни пройшло більше 5 годин)
    let shouldSendReminder = false;
    const lastTodayChangeTimestamp = lastState?.lastTodayChangeTimestamp || null;
    const hoursSinceLastChange = lastTodayChangeTimestamp 
      ? (now.getTime() - new Date(lastTodayChangeTimestamp).getTime()) / (1000 * 60 * 60)
      : 999; // Якщо не було змін - вважаємо що давно
    
    if (!comparison.scheduleChanged && hoursSinceLastChange >= 5) {
      const lastReminderDate = lastState?.lastReminderDate || null;
      if (lastReminderDate === todayKey) {
        console.log('🔔 Нагадування вже відправлено сьогодні.');
      } else {
        shouldSendReminder = true;
        console.log(`🔔 Від останньої зміни пройшло ${hoursSinceLastChange.toFixed(1)} годин (>5), відправляємо нагадування.`);
      }
    }

    // Ранковий звіт о 8:00 про графік на сьогодні
    let shouldSendMorningReport = false;
    if (isMorningReport) {
      const lastMorningDate = lastState?.lastMorningReportDate || null;
      if (lastMorningDate === todayKey) {
        console.log('☀️ Ранковий звіт уже відправлено сьогодні.');
      } else {
        shouldSendMorningReport = true;
        if (comparison.scheduleChanged) {
          console.log('☀️ Ранок: графік на сьогодні змінився, відправимо як оновлення.');
        } else {
          console.log('☀️ Ранок: графік не змінився, відправимо щоденне нагадування.');
        }
      }
    }

    // Вечірній звіт о 21:00 про графік на завтра
    let shouldSendEveningReport = false;
    if (isEveningReport) {
      const lastEveningDate = lastState?.lastEveningReportDate || null;
      if (lastEveningDate === todayKey) {
        console.log('🌆 Вечірній звіт уже відправлено сьогодні.');
      } else {
        // Якщо є зміни НА ЗАВТРА - НЕ відправляємо вечірнє нагадування (відправимо оновлення)
        if (comparison.tomorrowChanged) {
          console.log('🌆 Вечір: є зміни на завтра, вечірнє нагадування не потрібне (відправимо оновлення).');
          shouldSendEveningReport = false;
        } else {
          // Тільки якщо змін на завтра немає - відправляємо щоденне нагадування
          shouldSendEveningReport = true;
          console.log('🌆 Вечір: змін на завтра немає, відправимо щоденне нагадування.');
        }
      }
    }

    // Нічний моніторинг змін (2-4 ночі)
    let shouldSendNightReport = false;
    if (isNightReport && comparison.changed) {
      shouldSendNightReport = true;
      console.log('🌙 Нічний моніторинг: зафіксовано зміни, готуємо беззвучне повідомлення.');
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
      console.log(`⏰ Наближаються відключення через ≤30 хв: ${dueReminders.map(r => r.interval.startStr).join(', ')}`);
      
      let reminderMessage = `<b>🔔 Нагадування: Найближчі 30 хв очікуйте відключення за графіком</b>\n\n`;
      
      // Перше відключення - жирним
      const firstInterval = dueReminders[0].interval;
      reminderMessage += `<b>Планове відключення: ${firstInterval.startStr} - ${firstInterval.endStr} · ${firstInterval.durationStr}</b>\n`;
      
      // Якщо є наступні відключення
      if (dueReminders.length > 1) {
        reminderMessage += `\n<b>🔜 Наступні відключення:</b>\n`;
        for (let i = 1; i < dueReminders.length; i++) {
          const interval = dueReminders[i].interval;
          reminderMessage += `${interval.startStr} - ${interval.endStr} · ${interval.durationStr}`;
          if (i !== dueReminders.length - 1) {
            reminderMessage += `\n`;
          }
        }
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
    
    const updatedRemindersSentMap = {};
    if (todaysReminderSet.size > 0) {
      updatedRemindersSentMap[todayKey] = Array.from(todaysReminderSet);
    }
    
    // Відправляємо повідомлення при змінах, планових звітах або нічних оновленнях
    if (comparison.changed || shouldSendMorningReport || shouldSendEveningReport || shouldSendNightReport || shouldSendReminder) {
      let title;
      
      // Нагадування (після 5 годин без змін)
      if (shouldSendReminder) {
        title = '🔌 Нагадування графіку на сьогодні';
      }
      // Ранковий звіт о 8:00 - завжди просто "Графік на сьогодні"
      // (не "оновлено", бо це плановий звіт, а не реакція на зміни)
      else if (shouldSendMorningReport) {
        title = '🔌 Графік на сьогодні';
      }
      // Вечірній звіт о 21:00 - завжди просто "Графік на завтра"
      // (не "оновлено", бо це плановий звіт, а не реакція на зміни)
      else if (shouldSendEveningReport) {
        title = '🔌 Графік на завтра';
      }
      // Нічне оновлення
      else if (shouldSendNightReport) {
        title = '🔌 Нічне оновлення графіку';
      }
      // Зміни поза плановими звітами
      else if (comparison.groupChanged && !comparison.scheduleChanged && !comparison.tomorrowChanged) {
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
      
      // Визначаємо чи закріплювати повідомлення
      // Закріплюємо ВСІ оновлення графіку "на сьогодні":
      // 1. Ранковий звіт о 8:00 (завжди закріплюємо)
      // 2. Нагадування (після 5 годин без змін, беззвучно закріплюємо)
      // 3. Зміни графіку на сьогодні (в будь-який час, включно з нічними оновленнями)
      // НЕ закріплюємо: зміни графіку на "завтра", вечірній звіт, зміни групи
      const shouldPin = shouldSendMorningReport || shouldSendReminder || comparison.scheduleChanged;
      
      if (shouldPin) {
        if (shouldSendNightReport || isQuietHours) {
          console.log('📢 Відправляємо повідомлення та закріплюємо його беззвучно...');
        } else {
          console.log('📢 Відправляємо повідомлення та закріплюємо його...');
        }
      } else {
        console.log('📢 Відправляємо повідомлення (без закріплення)...');
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

      // Логіка показу секцій
      if (shouldSendReminder) {
        // Нагадування - показуємо тільки сьогодні БЕЗ пройдених періодів
        pushTodaySection();
      } else if (shouldSendMorningReport) {
        // Ранковий звіт - завжди показуємо тільки сьогодні
        pushTodaySection();
      } else if (shouldSendEveningReport) {
        // Вечірній звіт - завжди показуємо тільки завтра
        pushTomorrowSection();
      } else {
        // Звичайні оновлення - показуємо що змінилось
        if (comparison.scheduleChanged) {
          pushTodaySection();
        }
        if (comparison.tomorrowChanged) {
          pushTomorrowSection();
        }
        // Якщо нічого не змінилось, але є зміни (наприклад, група), показуємо сьогодні
        if (scheduleSections.length === 0) {
          pushTodaySection();
        }
      }

      // Формуємо і відправляємо повідомлення
      // Виділяємо жирним ТІЛЬКИ ті періоди що містять зміни (не плановий звіт)
      const isUpdate = !shouldSendMorningReport && !shouldSendEveningReport && !shouldSendReminder;
      const message = formatScheduleMessage(
        title, 
        group, 
        scheduleSections, 
        factData.update,
        { 
          highlightChanges: isUpdate,
          changedHours: comparison.changedHours || [],
          changedTomorrowHours: comparison.changedTomorrowHours || [],
          filterPastToday: shouldSendReminder // Фільтруємо пройдені періоди для нагадування
        }
      );
      
      // Беззвучно: нагадування, вночі (2-4) або в тихі години (23:00-8:00)
      const forceSilent = shouldSendReminder || shouldSendNightReport || isQuietHours;
      if (forceSilent) {
        console.log('🔇 Повідомлення буде відправлено беззвучно.');
      }
      
      // Відправляємо повідомлення і закріплюємо якщо потрібно
      const sent = await sendTelegramMessage(message, forceSilent, shouldPin);

      // Формуємо поточний стан з повним графіком
      const currentState = {
        update: factData.update,
        group: group,
        fullSchedule: fullSchedule,
        tomorrowSchedule: tomorrowSchedule,
        schedule: schedule,
        timestamp: new Date().toISOString(),
        lastMorningReportDate: sent && shouldSendMorningReport ? todayKey : (lastState?.lastMorningReportDate || null),
        lastEveningReportDate: sent && shouldSendEveningReport ? todayKey : (lastState?.lastEveningReportDate || null),
        lastNightUpdateDate: sent && shouldSendNightReport ? todayKey : (lastState?.lastNightUpdateDate || null),
        lastReminderDate: sent && shouldSendReminder ? todayKey : (lastState?.lastReminderDate || null),
        lastTodayChangeTimestamp: comparison.scheduleChanged ? new Date().toISOString() : (lastState?.lastTodayChangeTimestamp || null),
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
        lastMorningReportDate: lastState?.lastMorningReportDate || null,
        lastEveningReportDate: lastState?.lastEveningReportDate || null,
        lastNightUpdateDate: lastState?.lastNightUpdateDate || null,
        lastReminderDate: lastState?.lastReminderDate || null,
        lastTodayChangeTimestamp: lastState?.lastTodayChangeTimestamp || null,
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
