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
    return null;
  }

  // Сортуємо за годинами
  const sorted = [...scheduleData].sort((a, b) => a.hour - b.hour);
  
  // Знаходимо початок першого відключення
  // hour означає період (hour-1):00 - hour:00
  let startHour = sorted[0].hour - 1;
  let startMinute = 0;
  
  // Визначаємо початок на основі типу відключення
  if (sorted[0].value === 'second') {
    // Відключення з 30 хвилини попередньої години
    startMinute = 30;
  } else if (sorted[0].value === 'first') {
    // Відключення з початку години
    startMinute = 0;
  } else if (sorted[0].value === 'no') {
    // Відключення весь проміжок, починається з попередньої години
    startMinute = 0;
  }
  
  // Знаходимо кінець останнього відключення
  let lastItem = sorted[sorted.length - 1];
  let endHour = lastItem.hour - 1; // Базовий час - попередня година
  let endMinute = 0;
  
  // Визначаємо кінець на основі типу відключення
  if (lastItem.value === 'first') {
    // Відключення з початку години до 30 хвилини
    endHour = lastItem.hour - 1;
    endMinute = 30;
  } else if (lastItem.value === 'second') {
    // Відключення з 30 хвилини до кінця години
    endHour = lastItem.hour;
    endMinute = 0;
  } else if (lastItem.value === 'no') {
    // Відключення весь проміжок, закінчується на початку поточної години
    endHour = lastItem.hour;
    endMinute = 0;
  }
  
  const startStr = String(startHour).padStart(2, '0') + ':' + String(startMinute).padStart(2, '0');
  const endStr = String(endHour).padStart(2, '0') + ':' + String(endMinute).padStart(2, '0');
  
  return `${startStr} - ${endStr}`;
}

// Функція для форматування графіку відключень
function formatScheduleMessage(title, group, scheduleSections, updateTime) {
  // Прибираємо префікс "GPV" з назви групи
  const groupDisplay = group.replace(/^GPV/, '');

  let normalizedSections;
  if (Array.isArray(scheduleSections)) {
    const first = scheduleSections[0];
    const looksLikeScheduleItem = first && typeof first === 'object' && 'range' in first && !('scheduleData' in first);
    if (looksLikeScheduleItem) {
      normalizedSections = [{ label: null, scheduleData: scheduleSections }];
    } else {
      normalizedSections = scheduleSections.map(section => ({
        label: section.label || null,
        scheduleData: section.scheduleData || section.schedule || []
      }));
    }
  } else {
    normalizedSections = [{ label: null, scheduleData: [] }];
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
    if (!data.length) {
      message += `✅ Відключень не заплановано - світло буде весь день!`;
    } else {
      const mergedPeriod = mergeDisconnectionPeriods(data);
      if (mergedPeriod) {
        message += `${mergedPeriod}`;
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

