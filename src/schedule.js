const { CONFIG } = require('./config');

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

  const formatMinutes = (minutes) => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
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

  return merged.map(({ start, end }) => `${formatMinutes(start)} - ${formatMinutes(end)}`);
}

// Функція для форматування графіку відключень
function formatScheduleMessage(title, group, scheduleSections, updateTime) {
  // Прибираємо префікс "GPV" з назви групи
  const groupDisplay = group.replace(/^GPV/, '');

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
  message += `📍 Адреса: ${CONFIG.ADDRESS_CITY}, ${CONFIG.ADDRESS_STREET}, ${CONFIG.ADDRESS_HOUSE}\n`;
  message += `⚡ Група: <b>${groupDisplay}</b>\n`;
  message += `🕐 Оновлено: ${updateTime}\n\n`;

  normalizedSections.forEach((section, index) => {
    const labelDisplay = section.label ? section.label.charAt(0).toUpperCase() + section.label.slice(1) : null;
    const labelSuffix = labelDisplay ? ` (${labelDisplay})` : '';
    message += `<b>📅 Періоди відключення${labelSuffix}:</b>\n`;

    const data = Array.isArray(section.scheduleData) ? section.scheduleData : [];
    if (section.note) {
      message += `${section.note}`;
    } else if (!data.length) {
      message += `✅ Відключень не заплановано - світло буде весь день!`;
    } else {
      const mergedPeriods = mergeDisconnectionPeriods(data);
      if (mergedPeriods.length > 0) {
        mergedPeriods.forEach((period, idx) => {
          message += `${period}`;
          if (idx !== mergedPeriods.length - 1) {
            message += `\n`;
          }
        });
      } else {
        data.forEach(({ range, interpretation }, idx) => {
          message += `${range}: ${interpretation}`;
          if (idx !== data.length - 1) {
            message += `\n`;
          }
        });
      }
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

