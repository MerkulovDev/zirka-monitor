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

// Функція для порівняння станів з РОЗУМНОЮ ПЕРЕВІРКОЮ ДАТИ ОНОВЛЕННЯ
function compareStates(oldState, newState, tomorrowSchedule = null, oldTomorrowSchedule = null) {
  if (!oldState) {
    console.log('🔍 Порівняння: Немає попереднього стану (перший запуск)');
    return { 
      changed: true, 
      groupChanged: false, 
      scheduleChanged: true,
      tomorrowChanged: tomorrowSchedule !== null,
      changedHours: [],
      changedTomorrowHours: [],
      reason: 'Перший запуск' 
    };
  }

  console.log('🔍 Порівняння станів:');
  console.log('  Стара дата оновлення:', oldState.update);
  console.log('  Нова дата оновлення:', newState.update);
  console.log('  Стара група:', oldState.group);
  console.log('  Нова група:', newState.group);
  
  // ===== КРОК 1: ПЕРЕВІРЯЄМО ДАТУ ОНОВЛЕННЯ =====
  // Якщо дата не змінилась - графік точно не оновлювався на сайті
  const updateChanged = oldState.update !== newState.update;
  
  // Перевіряємо зміну групи ОКРЕМО (група може змінитись навіть якщо дата не змінилась)
  const groupChanged = oldState.group !== newState.group;
  
  if (!updateChanged && !groupChanged) {
    console.log('✅ Дата оновлення і група не змінились - жодних змін на сайті');
    return { 
      changed: false, 
      groupChanged: false, 
      scheduleChanged: false,
      tomorrowChanged: false,
      changedHours: [],
      changedTomorrowHours: [],
      reason: 'Дата оновлення і група не змінились' 
    };
  }
  
  if (groupChanged && !updateChanged) {
    console.log('⚠️  Група змінилась, але дата оновлення та не змінилась');
    return {
      changed: true,
      groupChanged: true,
      scheduleChanged: false,
      tomorrowChanged: false,
      changedHours: [],
      changedTomorrowHours: [],
      title: '🔌 Група змінена',
      reason: 'Змінилась група'
    };
  }
  
  console.log('⚠️  Дата оновлення змінилась! Перевіряємо що саме змінилось...');
  
  // ===== КРОК 2: ЯКЩО ДАТА ЗМІНИЛАСЬ - ПЕРЕВІРЯЄМО ЩО САМЕ =====
  
  // Порівнюємо повний графік (всі 24 години) через JSON для глибокого порівняння
  const oldScheduleJson = JSON.stringify(oldState.fullSchedule || {});
  const newScheduleJson = JSON.stringify(newState.fullSchedule || {});
  const scheduleChanged = oldScheduleJson !== newScheduleJson;
  
  // Порівнюємо графік на завтра
  let tomorrowChanged = false;
  if (tomorrowSchedule !== null && oldTomorrowSchedule !== null) {
    const oldTomorrowJson = JSON.stringify(oldTomorrowSchedule || {});
    const newTomorrowJson = JSON.stringify(tomorrowSchedule || {});
    tomorrowChanged = oldTomorrowJson !== newTomorrowJson;
    if (tomorrowChanged) {
      console.log('  ⚠️  Графік на завтра змінився!');
    }
  }
  
  if (groupChanged) {
    console.log('  ⚠️  Група змінилась!');
  }
  
  // Знаходимо які години змінились (для виділення тільки змінених періодів)
  const changedHours = [];
  if (scheduleChanged) {
    console.log('  ⚠️  Графік на сьогодні змінився!');
    const oldSchedule = oldState.fullSchedule || {};
    const newSchedule = newState.fullSchedule || {};
    const differences = [];
    for (let hour = 1; hour <= 24; hour++) {
      const h = String(hour);
      if (oldSchedule[h] !== newSchedule[h]) {
        differences.push(`Година ${h}: "${oldSchedule[h]}" → "${newSchedule[h]}"`);
        changedHours.push(hour); // Зберігаємо змінені години
      }
    }
    if (differences.length > 0) {
      console.log('    Різниці:', differences.join(', '));
    }
  }
  
  // Знаходимо які години змінились в завтрашньому графіку
  const changedTomorrowHours = [];
  if (tomorrowChanged && tomorrowSchedule && oldTomorrowSchedule) {
    const differences = [];
    for (let hour = 1; hour <= 24; hour++) {
      const h = String(hour);
      if (oldTomorrowSchedule[h] !== tomorrowSchedule[h]) {
        differences.push(`Година ${h}: "${oldTomorrowSchedule[h]}" → "${tomorrowSchedule[h]}"`);
        changedTomorrowHours.push(hour);
      }
    }
    if (differences.length > 0) {
      console.log('    Різниці в завтра:', differences.join(', '));
    }
  }

  if (!groupChanged && !scheduleChanged && !tomorrowChanged) {
    console.log('✅ Дата оновилась, але графіки не змінились (можливо технічне оновлення)');
    return { 
      changed: false, 
      groupChanged: false, 
      scheduleChanged: false,
      tomorrowChanged: false,
      changedHours: [],
      changedTomorrowHours: [],
      reason: 'Дата оновилась, але зміст графіків не змінився' 
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
  } else if (scheduleChanged && tomorrowChanged) {
    title = '🔌 Графік оновлено на сьогодні і завтра';
  } else {
    title = '🔌 Графік оновлено на сьогодні';
  }

  return { 
    changed: true, 
    groupChanged, 
    scheduleChanged,
    tomorrowChanged,
    changedHours: changedHours, // Які години змінились на сьогодні
    changedTomorrowHours: changedTomorrowHours, // Які години змінились на завтра
    title,
    reason: groupChanged && scheduleChanged ? 'Змінилась група і графік' : 
            groupChanged ? 'Змінилась група' : 
            tomorrowChanged && scheduleChanged ? 'Змінився графік на сьогодні і завтра' :
            tomorrowChanged ? 'Змінився графік на завтра' : 'Змінився графік відключень' 
  };
}

module.exports = {
  getLastKnownState,
  saveState,
  compareStates,
};

