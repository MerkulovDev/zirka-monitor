const { CONFIG, validateConfig } = require('./src/config');
const { sendTelegramMessage, sendTelegramMessageToAdmin } = require('./src/telegram-pinned'); // Використовуємо версію з закріпленням
const { processSchedule, formatScheduleMessage, mergeDisconnectionPeriods } = require('./src/schedule');
const { getLastKnownState, saveState, compareStates } = require('./src/state');
const { scrapeSchedule } = require('./src/scraper');

// Налаштування: вечірнє нагадування (щоб вимкнути, змініть на false)
const ENABLE_EVENING_REPORT = true;

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

    // Скрапінг даних
    const { factData, group, groupSchedule, tomorrowSchedule } = await scrapeSchedule();
    
    // Обробка графіку
    const { fullSchedule, schedule } = processSchedule(groupSchedule);
    console.log(`📊 Знайдено ${schedule.length} періодів відключення`);
    const mergedTodayIntervals = mergeDisconnectionPeriods(schedule);
    
    // Визначаємо поточний час
    const now = new Date();
    const hour = now.getHours();
    const minutes = now.getMinutes();
    const isMorningReport = hour === 8; // О 8:00-9:00 - щоденне повідомлення про сьогодні
    const isEveningReport = hour === 21 && minutes < 20; // О 21:00-21:20 - щоденне повідомлення про завтра
    const isQuietHours = hour >= 23 || hour < 8;
    const isMorningWindow = isMorningReport;
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

    // Перевіряємо скільки часу пройшло від останніх змін на сьогодні та завтра
    const lastTodayChangeTimestamp = lastState?.lastTodayChangeTimestamp || null;
    const lastTomorrowChangeTimestamp = lastState?.lastTomorrowChangeTimestamp || null;
    
    const hoursSinceLastTodayChange = lastTodayChangeTimestamp 
      ? (now.getTime() - new Date(lastTodayChangeTimestamp).getTime()) / (1000 * 60 * 60)
      : 999; // Якщо не було змін - вважаємо що давно
    
    const hoursSinceLastTomorrowChange = lastTomorrowChangeTimestamp 
      ? (now.getTime() - new Date(lastTomorrowChangeTimestamp).getTime()) / (1000 * 60 * 60)
      : 999; // Якщо не було змін - вважаємо що давно

    // Ранковий звіт о 8:00-9:00 про графік на сьогодні
    // Відправляємо ТІЛЬКИ якщо:
    // 1. Немає змін зараз
    // 2. Останні зміни НА СЬОГОДНІ були більше 5 годин тому (або не було взагалі)
    let shouldSendMorningReport = false;
    if (isMorningReport) {
      const lastMorningDate = lastState?.lastMorningReportDate || null;
      if (lastMorningDate === todayKey) {
        console.log('☀️ Ранкове повідомлення вже відправлено сьогодні.');
      } else if (comparison.scheduleChanged) {
        console.log('☀️ Ранок: графік на сьогодні змінився, відправимо як оновлення (це і є ранкове повідомлення).');
        // Не встановлюємо shouldSendMorningReport, бо відправимо оновлення
      } else if (hoursSinceLastTodayChange < 5) {
        console.log(`☀️ Ранок: останні зміни на сьогодні були ${hoursSinceLastTodayChange.toFixed(1)} год тому (<5), ранкове нагадування не потрібне.`);
      } else {
        shouldSendMorningReport = true;
        console.log(`☀️ Ранок: останні зміни на сьогодні ${hoursSinceLastTodayChange.toFixed(1)} год тому (>5), відправимо ранкове нагадування.`);
      }
    }

    // Вечірній звіт о 21:00 про графік на завтра
    // Відправляємо ТІЛЬКИ якщо:
    // 1. Немає змін на завтра зараз
    // 2. Останні зміни НА ЗАВТРА були більше 5 годин тому (або не було взагалі)
    let shouldSendEveningReport = false;
    if (ENABLE_EVENING_REPORT && isEveningReport) {
      const lastEveningDate = lastState?.lastEveningReportDate || null;
      if (lastEveningDate === todayKey) {
        console.log('🌆 Вечірній звіт уже відправлено сьогодні.');
      } else if (comparison.tomorrowChanged) {
        // Якщо є зміни НА ЗАВТРА зараз - НЕ відправляємо вечірнє нагадування (відправимо оновлення)
        console.log('🌆 Вечір: є зміни на завтра, відправимо як оновлення (це і є вечірнє повідомлення).');
        shouldSendEveningReport = false;
      } else if (hoursSinceLastTomorrowChange < 5) {
        console.log(`🌆 Вечір: останні зміни на завтра були ${hoursSinceLastTomorrowChange.toFixed(1)} год тому (<5), вечірнє нагадування не потрібне.`);
      } else {
        // Тільки якщо змін на завтра немає І давно не було - відправляємо щоденне нагадування
        shouldSendEveningReport = true;
        console.log(`🌆 Вечір: останні зміни на завтра ${hoursSinceLastTomorrowChange.toFixed(1)} год тому (>5), відправимо вечірнє нагадування.`);
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
    
    // Логіка "Наступне планове відключення" після закінчення поточного
    const nextOutageNotificationsRaw = lastState && typeof lastState.nextOutageNotificationsSent === 'object' && !Array.isArray(lastState.nextOutageNotificationsSent)
      ? { ...lastState.nextOutageNotificationsSent }
      : {};
    const todaysNextOutageSet = new Set(
      Array.isArray(nextOutageNotificationsRaw[todayKey]) ? nextOutageNotificationsRaw[todayKey] : []
    );
    
    // Шукаємо період що вже закінчився і є наступний період
    // Логіка: якщо зараз між двома відключеннями - повідомляємо про наступне (якщо ще не повідомляли)
    let justEndedInterval = null;
    let nextInterval = null;
    for (let i = 0; i < mergedTodayIntervals.length; i++) {
      const interval = mergedTodayIntervals[i];
      const diffFromEnd = nowMinutes - interval.endMinutes;
      
      // Період вже закінчився (мінімум 5 хв тому)
      if (diffFromEnd >= 5) {
        // Перевіряємо чи є наступний період
        if (i + 1 < mergedTodayIntervals.length) {
          const next = mergedTodayIntervals[i + 1];
          // Якщо наступний період ще не почався - це наш кандидат
          if (nowMinutes < next.startMinutes) {
            justEndedInterval = interval;
            nextInterval = next;
            break; // Знайшли, виходимо
          }
        }
      }
    }
    
    let nextOutageMessageSent = false;
    if (justEndedInterval && nextInterval) {
      // ВАЖЛИВО: повідомляти тільки якщо наступний період ЩЕ НЕ ПОЧАВСЯ
      // Вікно: після закінчення попереднього ДО початку наступного
      if (nowMinutes < nextInterval.startMinutes) {
        const nextKey = `${nextInterval.startMinutes}-${nextInterval.endMinutes}`;
        if (!todaysNextOutageSet.has(nextKey)) {
          const timeUntilNext = nextInterval.startMinutes - nowMinutes;
          console.log(`💡 Період ${justEndedInterval.startStr}-${justEndedInterval.endStr} щойно закінчився, наступний ${nextInterval.startStr}-${nextInterval.endStr} через ${timeUntilNext} хв`);
          
          const nextOutageMessage = `<b>💡 Наступне планове відключення</b>\n\n<b>${nextInterval.startStr} - ${nextInterval.endStr} · ${nextInterval.durationStr}</b>`;
          
          // Беззвучно вночі (23:00-8:00)
          const silent = isQuietHours;
          nextOutageMessageSent = await sendTelegramMessage(nextOutageMessage, silent, false);
          if (nextOutageMessageSent) {
            console.log('✅ Повідомлення про наступне відключення надіслано');
            todaysNextOutageSet.add(nextKey);
          } else {
            console.log('⚠️ Повідомлення про наступне відключення не вдалося надіслати');
          }
        } else {
          console.log(`ℹ️  Повідомлення про наступне відключення ${nextInterval.startStr}-${nextInterval.endStr} вже було відправлено`);
        }
      } else {
        console.log(`ℹ️  Наступний період ${nextInterval.startStr}-${nextInterval.endStr} вже почався, повідомлення не відправляємо`);
      }
    } else if (justEndedInterval && !nextInterval) {
      // Період закінчився, але наступного немає
      const noMoreKey = 'no-more-today';
      if (!todaysNextOutageSet.has(noMoreKey)) {
        console.log(`💡 Період ${justEndedInterval.startStr}-${justEndedInterval.endStr} закінчився, більше відключень на сьогодні не заплановано`);
        
        const noMoreMessage = `<b>🔋 Наразі відключень на сьогодні більше не заплановано 😌✨</b>\n\nЯкщо щось зміниться — одразу повідомимо!`;
        
        // Беззвучно вночі (23:00-8:00)
        const silent = isQuietHours;
        nextOutageMessageSent = await sendTelegramMessage(noMoreMessage, silent, false);
        if (nextOutageMessageSent) {
          console.log('✅ Повідомлення про відсутність подальших відключень надіслано');
          todaysNextOutageSet.add(noMoreKey);
        } else {
          console.log('⚠️ Повідомлення не вдалося надіслати');
        }
      } else {
        console.log('ℹ️  Повідомлення про відсутність подальших відключень вже було відправлено');
      }
    }
    
    const updatedNextOutageMap = {};
    if (todaysNextOutageSet.size > 0) {
      updatedNextOutageMap[todayKey] = Array.from(todaysNextOutageSet);
    }
    
    // Відправляємо повідомлення при змінах, планових звітах або нічних оновленнях
    if (comparison.changed || shouldSendMorningReport || shouldSendEveningReport) {
      let title;
      
    // Ранковий звіт о 8:00-9:00 - нагадування (тільки якщо давно не було змін)
      if (shouldSendMorningReport) {
        title = '🔌 Нагадування графіку на сьогодні';
      }
      // Вечірній звіт о 21:00 - завжди просто "Графік на завтра"
      // (не "оновлено", бо це плановий звіт, а не реакція на зміни)
      else if (shouldSendEveningReport) {
        title = '🔌 Графік на завтра';
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
      // 1. Ранковий звіт о 8:00 (ранкове нагадування, беззвучно закріплюємо)
      // 2. Зміни графіку на сьогодні (в будь-який час, включно з нічними оновленнями)
      // НЕ закріплюємо: зміни графіку на "завтра", вечірній звіт, зміни групи
      const shouldPin = shouldSendMorningReport || comparison.scheduleChanged;
      
      if (shouldPin) {
        if (isQuietHours) {
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
      if (shouldSendMorningReport) {
        // Ранковий звіт - завжди показуємо тільки сьогодні БЕЗ пройдених періодів
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
      const isUpdate = !shouldSendMorningReport && !shouldSendEveningReport;
      const message = formatScheduleMessage(
        title, 
        group, 
        scheduleSections, 
        factData.update,
        { 
          highlightChanges: isUpdate,
          changedHours: comparison.changedHours || [],
          changedTomorrowHours: comparison.changedTomorrowHours || [],
          filterPastToday: shouldSendMorningReport // Фільтруємо пройдені періоди для ранкового нагадування
        }
      );
      
      // Беззвучно: ранкове нагадування, вночі (2-4) або в тихі години (23:00-8:00)
      const forceSilent = shouldSendMorningReport || isQuietHours;
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
        // Ранкове повідомлення відправлено якщо:
        // 1. Відправили ранкове нагадування (shouldSendMorningReport)
        // 2. АБО в ранковий час (isMorningWindow) відправили оновлення на сьогодні
        lastMorningReportDate: sent && (shouldSendMorningReport || (isMorningWindow && comparison.scheduleChanged)) ? todayKey : (lastState?.lastMorningReportDate || null),
        // Вечірнє повідомлення відправлено якщо:
        // 1. Відправили вечірнє нагадування (shouldSendEveningReport)
        // 2. АБО в вечірній час (isEveningReport) відправили оновлення на завтра
        lastEveningReportDate: sent && (shouldSendEveningReport || (isEveningReport && comparison.tomorrowChanged)) ? todayKey : (lastState?.lastEveningReportDate || null),
        lastNightUpdateDate: lastState?.lastNightUpdateDate || null,
        lastTodayChangeTimestamp: comparison.scheduleChanged ? new Date().toISOString() : (lastState?.lastTodayChangeTimestamp || null),
        lastTomorrowChangeTimestamp: comparison.tomorrowChanged ? new Date().toISOString() : (lastState?.lastTomorrowChangeTimestamp || null),
        remindersSent: updatedRemindersSentMap,
        // При змінах графіку очищаємо історію повідомлень про наступні відключення (бо періоди могли змінитись)
        nextOutageNotificationsSent: comparison.scheduleChanged ? {} : updatedNextOutageMap
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
        lastTodayChangeTimestamp: lastState?.lastTodayChangeTimestamp || null,
        lastTomorrowChangeTimestamp: lastState?.lastTomorrowChangeTimestamp || null,
        remindersSent: updatedRemindersSentMap,
        nextOutageNotificationsSent: updatedNextOutageMap
      };
      saveState(currentState);
    }
    
  } catch (error) {
    console.error('❌ Помилка моніторингу:', error.message);
    
    // Відправляємо помилку тільки адміну
    if (process.env.TELEGRAM_BOT_TOKEN) {
      await sendTelegramMessageToAdmin(`❌ <b>Помилка моніторингу</b>\n\n${error.message}`);
    }
    
    process.exit(1);
  }
}

// Запускаємо моніторинг
monitor();
