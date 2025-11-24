const fs = require('fs');
const { CONFIG } = require('./config');

// Функція для отримання попереднього стану
function getLastKnownState() {
  try {
    if (fs.existsSync(CONFIG.STATE_FILE)) {
      const data = fs.readFileSync(CONFIG.STATE_FILE, 'utf8');
      const state = JSON.parse(data);
      console.log('📂 Прочитано попередній стан:');
      console.log('  - Update:', state.update);
      console.log('  - Group:', state.group);
      console.log('  - Timestamp:', state.timestamp);
      return state;
    } else {
      console.log('📂 Попередній стан не знайдено (перший запуск або файл видалено)');
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
    const dir = require('path').dirname(CONFIG.STATE_FILE);
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
function compareStates(oldState, newState, tomorrowSchedule = null, oldTomorrowSchedule = null) {
  if (!oldState) {
    console.log('🔍 Порівняння: Немає попереднього стану (перший запуск)');
    return { 
      changed: true, 
      groupChanged: false, 
      scheduleChanged: true,
      tomorrowChanged: tomorrowSchedule !== null,
      reason: 'Перший запуск' 
    };
  }

  console.log('🔍 Порівняння станів:');
  console.log('  Стара група:', oldState.group);
  console.log('  Нова група:', newState.group);
  
  // Перевіряємо зміну групи
  const groupChanged = oldState.group !== newState.group;
  
  // Порівнюємо повний графік (всі 24 години) через JSON для глибокого порівняння
  // ВАЖЛИВО: Якщо є вчорашній tomorrowSchedule, то він має стати сьогоднішнім fullSchedule
  // Тому спочатку перевіряємо, чи новий сьогодні = вчорашньому завтра
  let scheduleChanged = false;
  const newScheduleJson = JSON.stringify(newState.fullSchedule || {});
  
  if (oldState.tomorrowSchedule) {
    // Якщо є вчорашній графік на завтра, порівнюємо його з новим сьогодні
    const oldTomorrowJson = JSON.stringify(oldState.tomorrowSchedule || {});
    scheduleChanged = oldTomorrowJson !== newScheduleJson;
    if (!scheduleChanged) {
      console.log('✅ Сьогоднішній графік співпадає з вчорашнім "завтра"');
    }
  } else {
    // Якщо немає вчорашнього завтра, порівнюємо зі вчорашнім сьогодні
    const oldScheduleJson = JSON.stringify(oldState.fullSchedule || {});
    scheduleChanged = oldScheduleJson !== newScheduleJson;
  }
  
  // Порівнюємо графік на завтра
  let tomorrowChanged = false;
  if (tomorrowSchedule !== null && oldTomorrowSchedule !== null) {
    const oldTomorrowJson = JSON.stringify(oldTomorrowSchedule || {});
    const newTomorrowJson = JSON.stringify(tomorrowSchedule || {});
    tomorrowChanged = oldTomorrowJson !== newTomorrowJson;
    if (tomorrowChanged) {
      console.log('⚠️  Графік на завтра змінився!');
    }
  }
  
  if (groupChanged) {
    console.log('⚠️  Група змінилась!');
  }
  
  if (scheduleChanged) {
    console.log('⚠️  Графіки відрізняються!');
    // Знаходимо різницю для логування
    const oldSchedule = oldState.tomorrowSchedule || oldState.fullSchedule || {};
    const newSchedule = newState.fullSchedule || {};
    const differences = [];
    for (let hour = 1; hour <= 24; hour++) {
      const h = String(hour);
      if (oldSchedule[h] !== newSchedule[h]) {
        differences.push(`Година ${h}: "${oldSchedule[h]}" → "${newSchedule[h]}"`);
      }
    }
    if (differences.length > 0) {
      console.log('  Різниці:', differences.join(', '));
    }
  }

  if (!groupChanged && !scheduleChanged && !tomorrowChanged) {
    console.log('✅ Ні група, ні графік не змінилися');
    return { 
      changed: false, 
      groupChanged: false, 
      scheduleChanged: false,
      tomorrowChanged: false,
      reason: 'Змін немає' 
    };
  }

  // Визначаємо заголовок повідомлення
  let title = '';
  if (groupChanged && scheduleChanged) {
    title = '🔌 Графік оновлено на сьогодні (групу змінено)';
  } else if (groupChanged) {
    title = '🔌 Група змінена';
  } else if (!scheduleChanged && tomorrowChanged) {
    title = '🔌 Графік оновлено на завтра';
  } else {
    title = '🔌 Графік оновлено на сьогодні';
  }

  return { 
    changed: true, 
    groupChanged, 
    scheduleChanged,
    tomorrowChanged,
    title,
    reason: groupChanged && scheduleChanged ? 'Змінилась група і графік' : 
            groupChanged ? 'Змінилась група' : 
            tomorrowChanged ? 'Змінився графік на завтра' : 'Змінився графік відключень' 
  };
}

module.exports = {
  getLastKnownState,
  saveState,
  compareStates,
};

