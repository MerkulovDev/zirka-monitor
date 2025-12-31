const { CONFIG } = require('./config');

const MINUTES_IN_DAY = 24 * 60;

function normalizeMinutes(minutes) {
  const value = minutes % MINUTES_IN_DAY;
  return value < 0 ? value + MINUTES_IN_DAY : value;
}

function formatMinutesOfDay(minutes) {
  const normalized = normalizeMinutes(minutes);
  const hrs = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function formatDurationShort(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts = [];
  if (hrs > 0) {
    parts.push(`${hrs} год`);
  }
  if (mins > 0) {
    parts.push(`${mins} хв`);
  }
  if (parts.length === 0) {
    return '0 хв';
  }
  return parts.join(' ');
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
      return `✅ Електроенергія є`;
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

// Функція для об'єднання періодів відключення в один проміжок
function mergeDisconnectionPeriods(scheduleData) {
  if (!scheduleData || scheduleData.length === 0) {
    return [];
  }

  const toMinutes = (hour, value) => {
    const hourEnd = hour * 60;
    const hourStart = hourEnd - 60;

    switch (value) {
      case 'no':
        return { start: hourStart, end: hourEnd };
      case 'first':
        return { start: hourStart, end: hourStart + 30 };
      case 'second':
        return { start: hourStart + 30, end: hourEnd };
      default:
        return null;
    }
  };

  const segments = [];
  const sorted = [...scheduleData].sort((a, b) => a.hour - b.hour);
  sorted.forEach((item) => {
    const interval = toMinutes(item.hour, item.value);
    if (interval && interval.end > interval.start) {
      segments.push(interval);
    }
  });

  if (segments.length === 0) {
    return [];
  }

  const merged = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const current = segments[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged.map(({ start, end }) => ({
    startMinutes: start,
    endMinutes: end,
    startStr: formatMinutesOfDay(start),
    endStr: formatMinutesOfDay(end),
    durationMinutes: end - start,
    durationStr: formatDurationShort(end - start),
  }));
}

// Функція для форматування графіку відключень
function formatScheduleMessage(title, group, scheduleSections, updateTime, options = {}) {
  // Прибираємо префікс "GPV" з назви групи
  const groupDisplay = group.replace(/^GPV/, '');
  const {
    hideAddress = false,
    hideGroup = false,
    hideUpdate = false,
    filterPastToday = false,
    hideEmptyTomorrowUntilAfternoon = false,
    highlightChanges = false,
    changedHours = [], // Години які змінились для сьогодні
    changedTomorrowHours = [], // Години які змінились для завтра
  } = options;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isBeforeAfternoon = now.getHours() < 13;

  let normalizedSections;
  if (Array.isArray(scheduleSections)) {
    if (scheduleSections.length === 0) {
      normalizedSections = [{ label: null, scheduleData: [], note: null }];
    } else {
      const first = scheduleSections[0];
      const looksLikeScheduleItem = first && typeof first === 'object' && 'range' in first && !('scheduleData' in first) && !('note' in first);
      if (looksLikeScheduleItem) {
        normalizedSections = [{ label: null, scheduleData: scheduleSections, note: null }];
      } else {
        normalizedSections = scheduleSections.map(section => ({
          label: section.label || null,
          scheduleData: Array.isArray(section.scheduleData)
            ? section.scheduleData
            : Array.isArray(section.schedule)
              ? section.schedule
              : [],
          note: section.note || null
        }));
      }
    }
  } else {
    normalizedSections = [{ label: null, scheduleData: [], note: null }];
  }

  let message = `<b>${title}</b>\n\n`;
  if (!hideAddress) {
    message += `📍 Адреса: ${CONFIG.ADDRESS_CITY}, ${CONFIG.ADDRESS_STREET}, ${CONFIG.ADDRESS_HOUSE}\n`;
  }
  if (!hideGroup) {
    message += `⚡ Група: <b>${groupDisplay}</b>\n`;
  }
  if (!hideUpdate) {
    message += `🕐 Оновлено: ${updateTime}\n`;
  }
  message += `\n`;

  normalizedSections.forEach((section, index) => {
    const labelDisplay = section.label ? section.label.charAt(0).toUpperCase() + section.label.slice(1) : null;
    const labelSuffix = labelDisplay ? ` (${labelDisplay})` : '';
    const labelLower = (section.label || '').toLowerCase();

    const data = Array.isArray(section.scheduleData) ? section.scheduleData : [];
    let intervals = mergeDisconnectionPeriods(data);

    if (filterPastToday && labelLower.startsWith('сьогодні')) {
      intervals = intervals.filter(interval => interval.endMinutes > nowMinutes);
    }

    if (
      hideEmptyTomorrowUntilAfternoon &&
      labelLower.startsWith('завтра') &&
      isBeforeAfternoon &&
      !section.note &&
      intervals.length === 0
    ) {
      return;
    }

    message += `<b>📅 Періоди відключення${labelSuffix}:</b>\n`;

    if (section.note) {
      message += `${section.note}`;
    } else if (intervals.length === 0) {
      message += `✅ Відключень не заплановано`;
    } else {
      // Визначаємо які години змінились для цієї секції
      const relevantChangedHours = labelLower.startsWith('завтра') ? changedTomorrowHours : changedHours;
      
      intervals.forEach((period, idx) => {
        const periodText = `${period.startStr} - ${period.endStr} · ${period.durationStr}`;
        
        // Перевіряємо чи інтервал містить змінену годину
        let isChanged = false;
        if (highlightChanges && relevantChangedHours.length > 0) {
          // Перевіряємо чи хоча б одна змінена година потрапляє в цей інтервал
          for (const hour of relevantChangedHours) {
            const hourStart = (hour - 1) * 60; // Година 13 = 720 хв (12:00)
            const hourEnd = hour * 60;         // Година 13 = 780 хв (13:00)
            // Перевіряємо перетин інтервалів
            if (hourStart < period.endMinutes && hourEnd > period.startMinutes) {
              isChanged = true;
              break;
            }
          }
        }
        
        // Виділяємо жирним тільки якщо період містить зміни
        message += isChanged ? `<b>${periodText}</b>` : periodText;
        if (idx !== intervals.length - 1) {
          message += `\n`;
        }
      });
    }

    if (index !== normalizedSections.length - 1) {
      message += `\n\n`;
    }
  });

  return message;
}

// Функція для обробки графіку з factData
function processSchedule(groupSchedule) {
  // Зберігаємо повний графік (всі 24 години) для порівняння
  const fullSchedule = {};
  for (let hour = 1; hour <= 24; hour++) {
    fullSchedule[String(hour)] = groupSchedule[String(hour)] || 'yes';
  }
  
  // Формуємо детальний графік для відображення (тільки відключення)
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
  
  return { fullSchedule, schedule };
}

module.exports = {
  getTimeRange,
  interpretHourValue,
  mergeDisconnectionPeriods,
  formatScheduleMessage,
  processSchedule,
};

